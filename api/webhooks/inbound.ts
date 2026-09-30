/**
 * Inbound Webhook Handler
 * 
 * Secure webhook receiver with signature verification and replay protection.
 * Handles webhooks from external integration partners.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyWebhookRequest, parseWebhookPayload } from '../../src/lib/webhooks/signatureVerification';
import { replayProtectionManager, DatabaseReplayProtectionStore } from '../../src/lib/webhooks/replayProtection';
import { apiError, ErrorCode } from '../../src/lib/api/errorCodes';
import connectDb from '../../server/src/db/connectDb';
import ProcessedWebhookEvent from '../../server/src/models/ProcessedWebhookEvent';

// Configure replay protection with database backend
let dbStoreConfigured = false;

async function ensureReplayProtectionStore() {
  if (dbStoreConfigured) return;
  
  await connectDb();
  const dbStore = new DatabaseReplayProtectionStore(ProcessedWebhookEvent);
  replayProtectionManager.setStore(dbStore);
  dbStoreConfigured = true;
}

/**
 * Extract signature from request headers
 * Supports multiple common header formats
 */
function extractSignature(req: VercelRequest): string | null {
  // Common signature header names
  const signatureHeader = 
    req.headers['x-signature'] ||
    req.headers['x-webhook-signature'] ||
    req.headers['x-hub-signature-256'] ||
    req.headers['signature'];
  
  if (!signatureHeader) {
    return null;
  }
  
  const signature = String(signatureHeader);
  
  // Handle "sha256=..." format (GitHub style)
  if (signature.startsWith('sha256=')) {
    return signature.substring(7);
  }
  
  return signature;
}

/**
 * Get webhook secret for source
 */
function getWebhookSecret(source?: string): string | null {
  // Support multiple webhook sources
  if (source === 'github') {
    return process.env.GITHUB_WEBHOOK_SECRET || null;
  }
  
  if (source === 'stripe') {
    return process.env.STRIPE_WEBHOOK_SECRET || null;
  }
  
  // Default webhook secret
  return process.env.WEBHOOK_SECRET || null;
}

/**
 * Process verified webhook event
 */
async function processWebhookEvent(
  eventId: string,
  eventType: string,
  data: Record<string, unknown>,
  source: string
): Promise<void> {
  // TODO: Implement event-specific processing logic
  console.log(`Processing webhook event: ${eventType} from ${source}`, {
    eventId,
    dataKeys: Object.keys(data),
  });
  
  // Example: Handle different event types
  switch (eventType) {
    case 'payment.completed':
      // Handle payment completion
      break;
    
    case 'prompt.reported':
      // Handle prompt report
      break;
    
    case 'user.verified':
      // Handle user verification
      break;
    
    default:
      console.warn(`Unknown webhook event type: ${eventType}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json(
      apiError(ErrorCode.METHOD_NOT_ALLOWED, 'Only POST requests are allowed')
    );
  }
  
  // Extract source from query or headers
  const source = String(req.query.source || req.headers['x-webhook-source'] || 'default');
  
  // Get webhook secret for this source
  const secret = getWebhookSecret(source);
  
  if (!secret) {
    console.error(`Webhook secret not configured for source: ${source}`);
    return res.status(500).json(
      apiError(ErrorCode.CONFIGURATION_ERROR, 'Webhook verification not configured')
    );
  }
  
  // Extract signature
  const signature = extractSignature(req);
  
  if (!signature) {
    return res.status(400).json(
      apiError(ErrorCode.MISSING_FIELDS, 'Webhook signature header is missing')
    );
  }
  
  // Get raw body (Vercel provides req.body as parsed or raw)
  let rawBody: string;
  
  if (typeof req.body === 'string') {
    rawBody = req.body;
  } else {
    rawBody = JSON.stringify(req.body);
  }
  
  // Verify signature and timestamp
  const verification = verifyWebhookRequest(rawBody, signature, {
    secret,
    maxTimestampAge: 300, // 5 minutes
    algorithm: 'sha256',
  });
  
  if (!verification.valid) {
    console.warn(`Webhook verification failed: ${verification.reason}`, {
      source,
      eventId: verification.eventId,
    });
    
    if (verification.reason?.includes('signature')) {
      return res.status(401).json(
        apiError(ErrorCode.INVALID_SIGNATURE, 'Invalid webhook signature')
      );
    }
    
    if (verification.reason?.includes('Timestamp')) {
      return res.status(400).json(
        apiError(ErrorCode.STALE_REQUEST, verification.reason)
      );
    }
    
    return res.status(400).json(
      apiError(ErrorCode.VALIDATION_ERROR, verification.reason || 'Webhook verification failed')
    );
  }
  
  // Parse payload
  const payload = parseWebhookPayload(rawBody);
  
  if (!payload) {
    return res.status(400).json(
      apiError(ErrorCode.VALIDATION_ERROR, 'Invalid webhook payload structure')
    );
  }
  
  // Configure replay protection
  await ensureReplayProtectionStore();
  
  // Check for replay attack
  const isNewEvent = await replayProtectionManager.checkAndMarkProcessed(
    payload.eventId,
    86400000 // 24 hour TTL
  );
  
  if (!isNewEvent) {
    console.warn(`Replay attack detected: event ${payload.eventId} already processed`);
    return res.status(409).json(
      apiError(ErrorCode.DUPLICATE_EVENT, 'Event has already been processed')
    );
  }
  
  // Process the webhook event
  try {
    await processWebhookEvent(
      payload.eventId,
      payload.eventType,
      payload.data,
      source
    );
    
    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      eventId: payload.eventId,
    });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    
    // Don't retry the event - it's marked as processed
    return res.status(500).json(
      apiError(ErrorCode.INTERNAL_ERROR, 'Webhook processing failed')
    );
  }
}
