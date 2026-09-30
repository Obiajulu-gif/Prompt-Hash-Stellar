import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeWebhookSignature,
  verifyWebhookSignature,
  validateWebhookTimestamp,
  verifyWebhook,
  extractEventId,
} from '../security';

describe('Webhook Security', () => {
  const testSecret = 'test-webhook-secret';
  const testPayload = JSON.stringify({ event: 'test', data: 'payload' });

  describe('computeWebhookSignature', () => {
    it('should generate consistent signatures', () => {
      const timestamp = Date.now();
      const sig1 = computeWebhookSignature(testSecret, testPayload, timestamp);
      const sig2 = computeWebhookSignature(testSecret, testPayload, timestamp);
      
      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // SHA256 hex
    });

    it('should generate different signatures for different payloads', () => {
      const timestamp = Date.now();
      const sig1 = computeWebhookSignature(testSecret, testPayload, timestamp);
      const sig2 = computeWebhookSignature(testSecret, 'different', timestamp);
      
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should accept valid signatures', () => {
      const timestamp = Date.now();
      const signature = computeWebhookSignature(testSecret, testPayload, timestamp);
      
      const valid = verifyWebhookSignature(testSecret, testPayload, timestamp, signature);
      expect(valid).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const timestamp = Date.now();
      
      const valid = verifyWebhookSignature(
        testSecret,
        testPayload,
        timestamp,
        'invalid-signature',
      );
      expect(valid).toBe(false);
    });

    it('should reject signatures with tampered payload', () => {
      const timestamp = Date.now();
      const signature = computeWebhookSignature(testSecret, testPayload, timestamp);
      
      const valid = verifyWebhookSignature(
        testSecret,
        'tampered payload',
        timestamp,
        signature,
      );
      expect(valid).toBe(false);
    });
  });

  describe('validateWebhookTimestamp', () => {
    it('should accept recent timestamps', () => {
      const now = Date.now();
      const recent = now - 60_000; // 1 minute ago
      
      expect(validateWebhookTimestamp(recent, now, 5 * 60_000)).toBe(true);
    });

    it('should reject stale timestamps', () => {
      const now = Date.now();
      const stale = now - 10 * 60_000; // 10 minutes ago
      
      expect(validateWebhookTimestamp(stale, now, 5 * 60_000)).toBe(false);
    });

    it('should reject future timestamps outside window', () => {
      const now = Date.now();
      const future = now + 10 * 60_000; // 10 minutes in future
      
      expect(validateWebhookTimestamp(future, now, 5 * 60_000)).toBe(false);
    });
  });

  describe('extractEventId', () => {
    it('should extract event ID from id field', () => {
      const payload = { id: 'evt_123', data: 'test' };
      expect(extractEventId(payload)).toBe('evt_123');
    });

    it('should extract event ID from eventId field', () => {
      const payload = { eventId: 'evt_456', data: 'test' };
      expect(extractEventId(payload)).toBe('evt_456');
    });

    it('should extract event ID from event_id field', () => {
      const payload = { event_id: 'evt_789', data: 'test' };
      expect(extractEventId(payload)).toBe('evt_789');
    });

    it('should return undefined if no event ID found', () => {
      const payload = { data: 'test' };
      expect(extractEventId(payload)).toBeUndefined();
    });
  });

  describe('verifyWebhook', () => {
    it('should accept valid webhook with all checks passing', async () => {
      const timestamp = Date.now();
      const body = { id: 'evt_test', event: 'purchase' };
      const signature = computeWebhookSignature(testSecret, JSON.stringify(body), timestamp);
      
      const processedIds = new Set<string>();
      
      const result = await verifyWebhook(
        {
          body,
          headers: {
            'x-webhook-signature': signature,
            'x-webhook-timestamp': String(timestamp),
          },
        },
        { secret: testSecret },
        processedIds,
      );

      expect(result.valid).toBe(true);
      expect(result.eventId).toBe('evt_test');
    });

    it('should reject webhook without signature', async () => {
      const result = await verifyWebhook(
        {
          body: { event: 'test' },
          headers: {
            'x-webhook-timestamp': String(Date.now()),
          },
        },
        { secret: testSecret },
        new Set(),
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('signature');
    });

    it('should reject duplicate event IDs', async () => {
      const timestamp = Date.now();
      const body = { id: 'evt_duplicate', event: 'test' };
      const signature = computeWebhookSignature(testSecret, JSON.stringify(body), timestamp);
      
      const processedIds = new Set(['evt_duplicate']);
      
      const result = await verifyWebhook(
        {
          body,
          headers: {
            'x-webhook-signature': signature,
            'x-webhook-timestamp': String(timestamp),
          },
        },
        { secret: testSecret },
        processedIds,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('replay');
    });

    it('should reject stale timestamps', async () => {
      const staleTimestamp = Date.now() - 10 * 60_000; // 10 minutes ago
      const body = { event: 'test' };
      const signature = computeWebhookSignature(testSecret, JSON.stringify(body), staleTimestamp);
      
      const result = await verifyWebhook(
        {
          body,
          headers: {
            'x-webhook-signature': signature,
            'x-webhook-timestamp': String(staleTimestamp),
          },
        },
        { secret: testSecret, maxTimestampDrift: 5 * 60_000 },
        new Set(),
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('timestamp');
    });
  });
});
