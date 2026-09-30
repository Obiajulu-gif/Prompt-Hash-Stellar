/**
 * Webhook Signature Verification
 * 
 * Cryptographic verification for inbound webhooks and integration callbacks.
 * Prevents replay attacks using timestamp windows and event deduplication.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookVerificationOptions {
  secret: string;
  maxTimestampAge?: number; // seconds, default 300 (5 minutes)
  algorithm?: 'sha256' | 'sha512';
}

export interface WebhookPayload {
  timestamp: number;
  eventId: string;
  eventType: string;
  data: Record<string, unknown>;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  eventId?: string;
}

/**
 * Compute HMAC signature for webhook payload
 */
export function computeWebhookSignature(
  payload: string | Buffer,
  secret: string,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): string {
  const hmac = createHmac(algorithm, secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

/**
 * Verify webhook signature using timing-safe comparison
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  receivedSignature: string,
  secret: string,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): boolean {
  const expectedSignature = computeWebhookSignature(payload, secret, algorithm);
  
  // Convert to buffers for timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');
  
  // Ensure same length before comparison
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Verify webhook timestamp is within acceptable window
 */
export function verifyWebhookTimestamp(
  timestamp: number,
  maxAge: number = 300 // 5 minutes default
): VerificationResult {
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;
  
  if (age < 0) {
    return {
      valid: false,
      reason: 'Timestamp is in the future',
    };
  }
  
  if (age > maxAge) {
    return {
      valid: false,
      reason: `Timestamp is too old (${age}s > ${maxAge}s)`,
    };
  }
  
  return { valid: true };
}

/**
 * Parse and validate webhook payload structure
 */
export function parseWebhookPayload(rawPayload: string): WebhookPayload | null {
  try {
    const parsed = JSON.parse(rawPayload);
    
    if (typeof parsed.timestamp !== 'number') {
      return null;
    }
    
    if (typeof parsed.eventId !== 'string' || !parsed.eventId.trim()) {
      return null;
    }
    
    if (typeof parsed.eventType !== 'string' || !parsed.eventType.trim()) {
      return null;
    }
    
    if (typeof parsed.data !== 'object' || parsed.data === null) {
      return null;
    }
    
    return {
      timestamp: parsed.timestamp,
      eventId: parsed.eventId.trim(),
      eventType: parsed.eventType.trim(),
      data: parsed.data,
    };
  } catch {
    return null;
  }
}

/**
 * Verify complete webhook request
 */
export function verifyWebhookRequest(
  rawPayload: string,
  receivedSignature: string,
  options: WebhookVerificationOptions
): VerificationResult {
  const { secret, maxTimestampAge = 300, algorithm = 'sha256' } = options;
  
  // Parse payload
  const payload = parseWebhookPayload(rawPayload);
  
  if (!payload) {
    return {
      valid: false,
      reason: 'Invalid payload structure',
    };
  }
  
  // Verify signature
  const signatureValid = verifyWebhookSignature(
    rawPayload,
    receivedSignature,
    secret,
    algorithm
  );
  
  if (!signatureValid) {
    return {
      valid: false,
      reason: 'Invalid signature',
      eventId: payload.eventId,
    };
  }
  
  // Verify timestamp
  const timestampResult = verifyWebhookTimestamp(payload.timestamp, maxTimestampAge);
  
  if (!timestampResult.valid) {
    return {
      valid: false,
      reason: timestampResult.reason,
      eventId: payload.eventId,
    };
  }
  
  return {
    valid: true,
    eventId: payload.eventId,
  };
}

/**
 * Generate webhook signature for outbound webhooks
 */
export function signWebhookPayload(
  payload: WebhookPayload,
  secret: string,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): { payload: string; signature: string } {
  const payloadString = JSON.stringify(payload);
  const signature = computeWebhookSignature(payloadString, secret, algorithm);
  
  return {
    payload: payloadString,
    signature,
  };
}
