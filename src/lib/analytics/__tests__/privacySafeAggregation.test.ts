import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeEventData,
  hashIdentifier,
  MetricsAggregator,
  AnalyticsMetrics,
  DEFAULT_PRIVACY_POLICY,
} from '../privacySafeAggregation';
import type { AnalyticsEvent } from '../privacySafeAggregation';

describe('Privacy-Safe Analytics', () => {
  describe('sanitizeEventData', () => {
    it('should remove forbidden fields', () => {
      const data = {
        promptId: '123',
        walletAddress: 'GCREATOR123...',
        privateKey: 'secret-key',
        apiKey: 'api-key-value',
      };
      
      const sanitized = sanitizeEventData(data);
      
      expect(sanitized.promptId).toBe('123');
      expect(sanitized.walletAddress).toBeUndefined();
      expect(sanitized.privateKey).toBeUndefined();
      expect(sanitized.apiKey).toBeUndefined();
    });
    
    it('should truncate long strings', () => {
      const longString = 'a'.repeat(500);
      const data = { shortField: 'ok', longField: longString };
      
      const sanitized = sanitizeEventData(data);
      
      expect(sanitized.shortField).toBe('ok');
      expect(String(sanitized.longField)).toContain('[redacted');
    });
    
    it('should recursively sanitize nested objects', () => {
      const data = {
        user: {
          id: '123',
          email: 'user@example.com',
          profile: {
            name: 'Test',
            password: 'secret',
          },
        },
      };
      
      const sanitized = sanitizeEventData(data) as any;
      
      expect(sanitized.user.id).toBe('123');
      expect(sanitized.user.email).toBeUndefined();
      expect(sanitized.user.profile.name).toBe('Test');
      expect(sanitized.user.profile.password).toBeUndefined();
    });
    
    it('should use custom privacy policy', () => {
      const data = {
        userId: '123',
        customSecret: 'value',
      };
      
      const customPolicy = {
        ...DEFAULT_PRIVACY_POLICY,
        forbiddenFields: ['customSecret'],
      };
      
      const sanitized = sanitizeEventData(data, customPolicy);
      
      expect(sanitized.userId).toBe('123');
      expect(sanitized.customSecret).toBeUndefined();
    });
  });
  
  describe('hashIdentifier', () => {
    it('should anonymize wallet addresses', () => {
      const wallet = 'GCREATOR1234567890ABCDEFGH';
      const hashed = hashIdentifier(wallet);
      
      expect(hashed).not.toBe(wallet);
      expect(hashed.length).toBeLessThan(wallet.length);
      expect(hashed).toContain('...');
    });
    
    it('should redact short identifiers', () => {
      const short = 'ABC';
      const hashed = hashIdentifier(short);
      
      expect(hashed).toBe('[redacted]');
    });
  });
  
  describe('MetricsAggregator', () => {
    let aggregator: MetricsAggregator;
    
    beforeEach(() => {
      aggregator = new MetricsAggregator();
    });
    
    it('should aggregate events by time window', () => {
      const event1: AnalyticsEvent = {
        eventType: 'unlock_attempt',
        timestamp: new Date(),
        dimensions: {
          eventType: 'unlock_attempt',
          statusCode: '200',
        } as any,
        metrics: { attempts: 1, successes: 1 },
      };
      
      const event2: AnalyticsEvent = {
        ...event1,
        timestamp: new Date(),
      };
      
      aggregator.recordEvent(event1);
      aggregator.recordEvent(event2);
      
      const metrics = aggregator.getAggregatedMetrics(0);
      
      expect(metrics.length).toBeGreaterThan(0);
      const attemptsMetric = metrics.find(m => m.metricName === 'attempts');
      expect(attemptsMetric?.count).toBe(2);
    });
    
    it('should enforce minimum aggregation size', () => {
      const minSize = 5;
      
      for (let i = 0; i < 3; i++) {
        aggregator.recordEvent({
          eventType: 'test',
          timestamp: new Date(),
          dimensions: { eventType: 'test' } as any,
          metrics: { count: 1 },
        });
      }
      
      const metrics = aggregator.getAggregatedMetrics(minSize);
      
      expect(metrics).toHaveLength(0); // Below minimum
    });
    
    it('should flush and clear buffer', () => {
      for (let i = 0; i < 10; i++) {
        aggregator.recordEvent({
          eventType: 'test',
          timestamp: new Date(),
          dimensions: { eventType: 'test' } as any,
          metrics: { count: 1 },
        });
      }
      
      const metrics = aggregator.flush();
      
      expect(metrics.length).toBeGreaterThan(0);
      expect(aggregator.getAggregatedMetrics(0)).toHaveLength(0);
    });
    
    it('should group by dimensions', () => {
      const categories = ['text', 'image', 'code'];
      
      for (const category of categories) {
        aggregator.recordEvent({
          eventType: 'purchase',
          timestamp: new Date(),
          dimensions: { eventType: 'purchase', category } as any,
          metrics: { purchases: 1 },
        });
      }
      
      const metrics = aggregator.getAggregatedMetrics(0);
      
      const textMetrics = metrics.filter(m => m.dimensions.category === 'text');
      const imageMetrics = metrics.filter(m => m.dimensions.category === 'image');
      const codeMetrics = metrics.filter(m => m.dimensions.category === 'code');
      
      expect(textMetrics.length).toBeGreaterThan(0);
      expect(imageMetrics.length).toBeGreaterThan(0);
      expect(codeMetrics.length).toBeGreaterThan(0);
    });
  });
  
  describe('AnalyticsMetrics', () => {
    it('should create unlock attempt metrics', () => {
      const successMetric = AnalyticsMetrics.unlockAttempts(true);
      const failureMetric = AnalyticsMetrics.unlockAttempts(false);
      
      expect(successMetric.eventType).toBe('unlock_attempt');
      expect(successMetric.metrics.successes).toBe(1);
      expect(successMetric.metrics.failures).toBe(0);
      
      expect(failureMetric.metrics.successes).toBe(0);
      expect(failureMetric.metrics.failures).toBe(1);
    });
    
    it('should create purchase metrics with category', () => {
      const metric = AnalyticsMetrics.purchaseAttempt('code', true);
      
      expect(metric.eventType).toBe('purchase_attempt');
      expect(metric.dimensions.category).toBe('code');
      expect(metric.metrics.successes).toBe(1);
    });
    
    it('should create webhook delivery metrics with latency', () => {
      const latency = 150;
      const metric = AnalyticsMetrics.webhookDelivery(true, latency);
      
      expect(metric.eventType).toBe('webhook_delivery');
      expect(metric.metrics.latencyMs).toBe(latency);
    });
    
    it('should create error metrics with codes', () => {
      const metric = AnalyticsMetrics.errorOccurred('AUTH_001', 'high');
      
      expect(metric.eventType).toBe('error');
      expect(metric.dimensions.errorCode).toBe('AUTH_001');
      expect(metric.dimensions.severity).toBe('high');
    });
  });
  
  describe('Privacy Compliance', () => {
    it('should never log wallet addresses', () => {
      const event: AnalyticsEvent = {
        eventType: 'unlock',
        timestamp: new Date(),
        dimensions: { eventType: 'unlock' } as any,
        metrics: { count: 1 },
        metadata: {
          walletAddress: 'GCREATOR123...',
          promptId: '123',
        },
      };
      
      const aggregator = new MetricsAggregator();
      aggregator.recordEvent(event);
      
      const metrics = aggregator.getAggregatedMetrics(0);
      
      // Ensure no wallet address in aggregated data
      for (const metric of metrics) {
        const jsonString = JSON.stringify(metric);
        expect(jsonString).not.toContain('GCREATOR');
      }
    });
    
    it('should never log plaintext content', () => {
      const sensitiveData = {
        promptId: '123',
        plaintextContent: 'This is the secret prompt content',
        title: 'Public Title',
      };
      
      const sanitized = sanitizeEventData(sensitiveData);
      
      expect(sanitized.plaintextContent).toBeUndefined();
      expect(sanitized.title).toBe('Public Title');
    });
  });
});
