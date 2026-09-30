import { describe, it, expect } from 'vitest';
import {
  computeWebhookSignature,
  verifyWebhookSignature,
  verifyWebhookTimestamp,
  parseWebhookPayload,
  verifyWebhookRequest,
  signWebhookPayload,
} from '../signatureVerification';

describe('Webhook Signature Verification', () => {
  const testSecret = 'test-webhook-secret-key';
  const testPayload = JSON.stringify({
    timestamp: Math.floor(Date.now() / 1000),
    eventId: 'evt_test_12345',
    eventType: 'payment.completed',
    data: { amount: 100 },
  });
  
  describe('computeWebhookSignature', () => {
    it('should compute consistent signatures', () => {
      const sig1 = computeWebhookSignature(testPayload, testSecret);
      const sig2 = computeWebhookSignature(testPayload, testSecret);
      
      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // SHA-256 hex
    });
    
    it('should produce different signatures for different secrets', () => {
      const sig1 = computeWebhookSignature(testPayload, 'secret1');
      const sig2 = computeWebhookSignature(testPayload, 'secret2');
      
      expect(sig1).not.toBe(sig2);
    });
    
    it('should support SHA-512 algorithm', () => {
      const sig = computeWebhookSignature(testPayload, testSecret, 'sha512');
      expect(sig).toHaveLength(128); // SHA-512 hex
    });
  });
  
  describe('verifyWebhookSignature', () => {
    it('should verify valid signatures', () => {
      const signature = computeWebhookSignature(testPayload, testSecret);
      const valid = verifyWebhookSignature(testPayload, signature, testSecret);
      
      expect(valid).toBe(true);
    });
    
    it('should reject invalid signatures', () => {
      const valid = verifyWebhookSignature(testPayload, 'invalid-signature', testSecret);
      
      expect(valid).toBe(false);
    });
    
    it('should reject signatures with wrong secret', () => {
      const signature = computeWebhookSignature(testPayload, 'wrong-secret');
      const valid = verifyWebhookSignature(testPayload, signature, testSecret);
      
      expect(valid).toBe(false);
    });
    
    it('should handle timing attacks safely', () => {
      const signature = computeWebhookSignature(testPayload, testSecret);
      const tamperedSignature = signature.substring(0, 32) + '0'.repeat(32);
      
      const valid = verifyWebhookSignature(testPayload, tamperedSignature, testSecret);
      
      expect(valid).toBe(false);
    });
  });
  
  describe('verifyWebhookTimestamp', () => {
    it('should accept recent timestamps', () => {
      const now = Math.floor(Date.now() / 1000);
      const result = verifyWebhookTimestamp(now);
      
      expect(result.valid).toBe(true);
    });
    
    it('should reject old timestamps', () => {
      const old = Math.floor(Date.now() / 1000) - 400; // 6+ minutes ago
      const result = verifyWebhookTimestamp(old, 300);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too old');
    });
    
    it('should reject future timestamps', () => {
      const future = Math.floor(Date.now() / 1000) + 100;
      const result = verifyWebhookTimestamp(future);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('future');
    });
    
    it('should accept timestamp at exact boundary', () => {
      const now = Math.floor(Date.now() / 1000);
      const boundary = now - 300; // Exactly 5 minutes
      const result = verifyWebhookTimestamp(boundary, 300);
      
      expect(result.valid).toBe(true);
    });
  });
  
  describe('parseWebhookPayload', () => {
    it('should parse valid webhook payloads', () => {
      const payload = parseWebhookPayload(testPayload);
      
      expect(payload).toBeDefined();
      expect(payload?.eventId).toBe('evt_test_12345');
      expect(payload?.eventType).toBe('payment.completed');
    });
    
    it('should reject payloads without timestamp', () => {
      const invalid = JSON.stringify({
        eventId: 'evt_123',
        eventType: 'test',
        data: {},
      });
      
      const payload = parseWebhookPayload(invalid);
      expect(payload).toBeNull();
    });
    
    it('should reject payloads without eventId', () => {
      const invalid = JSON.stringify({
        timestamp: Date.now(),
        eventType: 'test',
        data: {},
      });
      
      const payload = parseWebhookPayload(invalid);
      expect(payload).toBeNull();
    });
    
    it('should reject malformed JSON', () => {
      const payload = parseWebhookPayload('not-json');
      expect(payload).toBeNull();
    });
  });
  
  describe('verifyWebhookRequest', () => {
    it('should verify complete valid requests', () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        timestamp: now,
        eventId: 'evt_valid_123',
        eventType: 'test.event',
        data: { test: true },
      });
      
      const signature = computeWebhookSignature(payload, testSecret);
      
      const result = verifyWebhookRequest(payload, signature, {
        secret: testSecret,
      });
      
      expect(result.valid).toBe(true);
      expect(result.eventId).toBe('evt_valid_123');
    });
    
    it('should reject requests with invalid signatures', () => {
      const result = verifyWebhookRequest(testPayload, 'bad-signature', {
        secret: testSecret,
      });
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('signature');
    });
    
    it('should reject requests with stale timestamps', () => {
      const old = Math.floor(Date.now() / 1000) - 400;
      const payload = JSON.stringify({
        timestamp: old,
        eventId: 'evt_old_123',
        eventType: 'test.event',
        data: {},
      });
      
      const signature = computeWebhookSignature(payload, testSecret);
      
      const result = verifyWebhookRequest(payload, signature, {
        secret: testSecret,
        maxTimestampAge: 300,
      });
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Timestamp');
    });
  });
  
  describe('signWebhookPayload', () => {
    it('should generate signed payload for outbound webhooks', () => {
      const payload = {
        timestamp: Math.floor(Date.now() / 1000),
        eventId: 'evt_outbound_123',
        eventType: 'prompt.purchased',
        data: { promptId: '123', buyer: 'GBUYER...' },
      };
      
      const signed = signWebhookPayload(payload, testSecret);
      
      expect(signed.payload).toBeDefined();
      expect(signed.signature).toBeDefined();
      
      // Verify the signature
      const valid = verifyWebhookSignature(signed.payload, signed.signature, testSecret);
      expect(valid).toBe(true);
    });
  });
});
