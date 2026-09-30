/**
 * Webhook Security Module
 * 
 * Cryptographic verification and replay protection for inbound webhooks.
 * Enforces signature validation and temporal window checks.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { Buffer } from 'buffer';

export interface WebhookVerificationConfig {
  secret: string;
  maxTimestampDrift?: number; // milliseconds, default 5 minutes
  signatureHeader?: string; // default: 'x-webhook-signature'
  timestampHeader?: string; // default: 'x-webhook-timestamp'
}

export interface WebhookPayload {
  body: string | Record<string, unknown>;
  headers: Record<string, string>;
  timestamp?: number;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  eventId?: string;
}

const DEFAULT_MAX_DRIFT = 5 * 60 * 1000; // 5 minutes

/**
 * Compute HMAC-SHA256 signature for webhook payload.
 */
export function computeWebhookSignature(
  secret: string,
  payload: string,
  timestamp: number,
): string {
  const message = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Verify webhook signature using timing-safe comparison.
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string,
  timestamp: number,
  receivedSignature: string,
): boolean {
  const expected = computeWebhookSignature(secret, payload, timestamp);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Validate webhook timestamp is within acceptable drift window.
 */
export function validateWebhookTimestamp(
  timestamp: number,
  now = Date.now(),
  maxDrift = DEFAULT_MAX_DRIFT,
): boolean {
  const drift = Math.abs(now - timestamp);
  return drift <= maxDrift;
}

/**
 * Extract event ID from webhook payload for replay tracking.
 */
export function extractEventId(payload: Record<string, unknown>): string | undefined {
  // Support common event ID fields
  return (
    (payload.id as string) ??
    (payload.eventId as string) ??
    (payload.event_id as string) ??
    undefined
  );
}

/**
 * Complete webhook verification: signature + timestamp + format.
 */
export async function verifyWebhook(
  payload: WebhookPayload,
  config: WebhookVerificationConfig,
  processedEventIds: Set<string>,
): Promise<VerificationResult> {
  const {
    secret,
    maxTimestampDrift = DEFAULT_MAX_DRIFT,
    signatureHeader = 'x-webhook-signature',
    timestampHeader = 'x-webhook-timestamp',
  } = config;

  // Extract headers (case-insensitive)
  const headers = Object.fromEntries(
    Object.entries(payload.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );

  const signature = headers[signatureHeader.toLowerCase()];
  const timestampStr = headers[timestampHeader.toLowerCase()];

  if (!signature) {
    return {
      valid: false,
      reason: 'Missing signature header',
    };
  }

  if (!timestampStr) {
    return {
      valid: false,
      reason: 'Missing timestamp header',
    };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return {
      valid: false,
      reason: 'Invalid timestamp format',
    };
  }

  // Validate timestamp drift
  if (!validateWebhookTimestamp(timestamp, Date.now(), maxTimestampDrift)) {
    return {
      valid: false,
      reason: 'Timestamp outside acceptable window',
    };
  }

  // Serialize payload for signature verification
  const payloadStr = typeof payload.body === 'string' 
    ? payload.body 
    : JSON.stringify(payload.body);

  // Verify signature
  if (!verifyWebhookSignature(secret, payloadStr, timestamp, signature)) {
    return {
      valid: false,
      reason: 'Invalid signature',
    };
  }

  // Check for replay (duplicate event ID)
  const parsedBody = typeof payload.body === 'string'
    ? JSON.parse(payload.body)
    : payload.body;

  const eventId = extractEventId(parsedBody);

  if (eventId) {
    if (processedEventIds.has(eventId)) {
      return {
        valid: false,
        reason: 'Duplicate event ID (replay detected)',
        eventId,
      };
    }
  }

  return {
    valid: true,
    eventId,
  };
}

/**
 * Generate webhook signature for testing.
 */
export function generateWebhookSignature(
  secret: string,
  payload: Record<string, unknown>,
  timestamp: number = Date.now(),
): { signature: string; timestamp: number } {
  const payloadStr = JSON.stringify(payload);
  const signature = computeWebhookSignature(secret, payloadStr, timestamp);
  return { signature, timestamp };
}
