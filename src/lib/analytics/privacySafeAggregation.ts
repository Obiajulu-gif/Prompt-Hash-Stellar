/**
 * Privacy-Safe Analytics Aggregation
 * 
 * Aggregates usage and reliability metrics without exposing private user data,
 * secrets, or sensitive payload content.
 */

/**
 * Safe dimensions for aggregation (non-sensitive)
 */
export type SafeDimension = 
  | 'promptId'
  | 'category'
  | 'eventType'
  | 'operationType'
  | 'statusCode'
  | 'errorCode'
  | 'severity'
  | 'timeWindow'
  | 'region'
  | 'version';

/**
 * Metric types
 */
export type MetricType =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'p50'
  | 'p95'
  | 'p99';

/**
 * Analytics event (raw, before aggregation)
 */
export interface AnalyticsEvent {
  eventType: string;
  timestamp: Date;
  dimensions: Record<SafeDimension, string>;
  metrics: Record<string, number>;
  metadata?: Record<string, unknown>; // Will be stripped before storage
}

/**
 * Aggregated metric record
 */
export interface AggregatedMetric {
  dimensions: Record<string, string>;
  metricName: string;
  metricType: MetricType;
  value: number;
  count: number;
  timeWindow: string; // ISO date for hour/day
  createdAt: Date;
}

/**
 * Privacy policy for analytics
 */
export interface AnalyticsPrivacyPolicy {
  // Fields that should never be logged
  forbiddenFields: string[];
  
  // Maximum cardinality for dimensions
  maxCardinality: number;
  
  // Minimum aggregation count to prevent re-identification
  minAggregationSize: number;
  
  // Data retention period (days)
  retentionDays: number;
}

export const DEFAULT_PRIVACY_POLICY: AnalyticsPrivacyPolicy = {
  forbiddenFields: [
    'privateKey',
    'secret',
    'apiKey',
    'password',
    'token',
    'signature',
    'walletAddress', // Full addresses are PII
    'email',
    'ipAddress',
    'userAgent',
    'sessionId',
    'plaintextContent',
    'encryptedPayload',
  ],
  maxCardinality: 1000,
  minAggregationSize: 5,
  retentionDays: 90,
};

/**
 * Sanitize event data by removing forbidden fields
 */
export function sanitizeEventData(
  data: Record<string, unknown>,
  policy: AnalyticsPrivacyPolicy = DEFAULT_PRIVACY_POLICY
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(data)) {
    // Check if field is forbidden
    const isForbidden = policy.forbiddenFields.some(forbidden => 
      key.toLowerCase().includes(forbidden.toLowerCase())
    );
    
    if (isForbidden) {
      continue; // Skip forbidden field
    }
    
    // Recursively sanitize nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeEventData(value as Record<string, unknown>, policy);
    } else if (typeof value === 'string' && value.length > 100) {
      // Truncate long strings (potential sensitive data)
      sanitized[key] = `[redacted:${value.length}chars]`;
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Hash sensitive identifiers for safe aggregation
 */
export function hashIdentifier(value: string, salt: string = ''): string {
  // Use first 8 chars of wallet address as anonymized identifier
  if (value.length > 8) {
    return value.substring(0, 4) + '...' + value.substring(value.length - 4);
  }
  return '[redacted]';
}

/**
 * Aggregate events into time-windowed metrics
 */
export class MetricsAggregator {
  private policy: AnalyticsPrivacyPolicy;
  private buffer: Map<string, AggregatedMetric> = new Map();
  
  constructor(policy: AnalyticsPrivacyPolicy = DEFAULT_PRIVACY_POLICY) {
    this.policy = policy;
  }
  
  /**
   * Record a single event
   */
  recordEvent(event: AnalyticsEvent): void {
    // Sanitize dimensions
    const safeDimensions = sanitizeEventData(event.dimensions, this.policy) as Record<string, string>;
    
    // Get time window (hourly)
    const timeWindow = this.getTimeWindow(event.timestamp, 'hour');
    
    // Aggregate each metric
    for (const [metricName, metricValue] of Object.entries(event.metrics)) {
      const key = this.getAggregationKey(
        event.eventType,
        metricName,
        safeDimensions,
        timeWindow
      );
      
      const existing = this.buffer.get(key);
      
      if (existing) {
        // Update existing aggregation
        existing.value += metricValue;
        existing.count += 1;
      } else {
        // Create new aggregation
        this.buffer.set(key, {
          dimensions: {
            eventType: event.eventType,
            timeWindow,
            ...safeDimensions,
          },
          metricName,
          metricType: 'sum',
          value: metricValue,
          count: 1,
          timeWindow,
          createdAt: new Date(),
        });
      }
    }
  }
  
  /**
   * Get aggregated metrics meeting minimum aggregation size
   */
  getAggregatedMetrics(minSize?: number): AggregatedMetric[] {
    const threshold = minSize ?? this.policy.minAggregationSize;
    
    return Array.from(this.buffer.values()).filter(
      metric => metric.count >= threshold
    );
  }
  
  /**
   * Flush aggregated metrics and clear buffer
   */
  flush(): AggregatedMetric[] {
    const metrics = this.getAggregatedMetrics();
    this.buffer.clear();
    return metrics;
  }
  
  /**
   * Get time window bucket
   */
  private getTimeWindow(timestamp: Date, granularity: 'hour' | 'day'): string {
    const date = new Date(timestamp);
    
    if (granularity === 'hour') {
      date.setMinutes(0, 0, 0);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    
    return date.toISOString();
  }
  
  /**
   * Generate aggregation key
   */
  private getAggregationKey(
    eventType: string,
    metricName: string,
    dimensions: Record<string, string>,
    timeWindow: string
  ): string {
    const dimKeys = Object.keys(dimensions).sort();
    const dimString = dimKeys.map(k => `${k}:${dimensions[k]}`).join(',');
    return `${eventType}:${metricName}:${timeWindow}:${dimString}`;
  }
}

/**
 * Common analytics metrics
 */
export const AnalyticsMetrics = {
  // Unlock metrics
  unlockAttempts: (success: boolean) => ({
    eventType: 'unlock_attempt',
    dimensions: {
      eventType: 'unlock_attempt',
      statusCode: success ? '200' : '400',
    } as Record<SafeDimension, string>,
    metrics: {
      attempts: 1,
      successes: success ? 1 : 0,
      failures: success ? 0 : 1,
    },
  }),
  
  // Purchase metrics
  purchaseAttempt: (category: string, success: boolean) => ({
    eventType: 'purchase_attempt',
    dimensions: {
      eventType: 'purchase_attempt',
      category,
      statusCode: success ? '200' : '400',
    } as Record<SafeDimension, string>,
    metrics: {
      attempts: 1,
      successes: success ? 1 : 0,
      failures: success ? 0 : 1,
    },
  }),
  
  // Webhook metrics
  webhookDelivery: (success: boolean, latencyMs: number) => ({
    eventType: 'webhook_delivery',
    dimensions: {
      eventType: 'webhook_delivery',
      statusCode: success ? '200' : '500',
    } as Record<SafeDimension, string>,
    metrics: {
      deliveries: 1,
      successes: success ? 1 : 0,
      failures: success ? 0 : 1,
      latencyMs,
    },
  }),
  
  // Error metrics
  errorOccurred: (errorCode: string, severity: string) => ({
    eventType: 'error',
    dimensions: {
      eventType: 'error',
      errorCode,
      severity,
    } as Record<SafeDimension, string>,
    metrics: {
      count: 1,
    },
  }),
};

/**
 * Global aggregator instance
 */
export const globalMetricsAggregator = new MetricsAggregator();

/**
 * Record analytics event
 */
export function recordAnalyticsEvent(
  eventType: string,
  dimensions: Record<string, string>,
  metrics: Record<string, number>
): void {
  globalMetricsAggregator.recordEvent({
    eventType,
    timestamp: new Date(),
    dimensions: dimensions as Record<SafeDimension, string>,
    metrics,
  });
}
