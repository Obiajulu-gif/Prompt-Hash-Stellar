/**
 * Purchase funnel metrics and business intelligence (#724)
 * 
 * Tracks conversion rates, latency, and failures across purchase stages:
 * 1. Browse → Listing view
 * 2. Listing → Prompt detail
 * 3. Detail → Buy click
 * 4. Buy → Challenge issued
 * 5. Challenge → Wallet sign
 * 6. Sign → Purchase transaction
 * 7. Transaction → Unlock success
 * 8. Unlock → Receipt view
 */

import { logger } from './logger';

export enum PurchaseFunnelStage {
  BROWSE = 'browse',              // User views marketplace listing
  DETAIL_VIEW = 'detail_view',    // User opens prompt detail
  BUY_INITIATED = 'buy_initiated', // User clicks buy button
  CHALLENGE_ISSUED = 'challenge_issued',
  CHALLENGE_SIGNED = 'challenge_signed',
  PURCHASE_TX_SUBMITTED = 'purchase_tx_submitted',
  PURCHASE_TX_CONFIRMED = 'purchase_tx_confirmed',
  UNLOCK_ATTEMPT = 'unlock_attempt',
  UNLOCK_SUCCESS = 'unlock_success',
  RECEIPT_VIEWED = 'receipt_viewed',
}

export enum PurchaseFailureReason {
  // Pre-purchase
  BROWSE_LOAD_ERROR = 'browse_load_error',
  DETAIL_NOT_FOUND = 'detail_not_found',
  MODERATION_RESTRICTED = 'moderation_restricted',
  WALLET_CONNECT_FAILED = 'wallet_connect_failed',
  WALLET_WRONG_NETWORK = 'wallet_wrong_network',
  
  // Challenge
  CHALLENGE_RATE_LIMITED = 'challenge_rate_limited',
  CHALLENGE_EXPIRED = 'challenge_expired',
  
  // Signing
  SIGNATURE_FAILED = 'signature_failed',
  SIGNATURE_INVALID = 'signature_invalid',
  SIGNATURE_TIMEOUT = 'signature_timeout',
  USER_REJECTED = 'user_rejected',
  
  // Purchase transaction
  TX_SUBMISSION_FAILED = 'tx_submission_failed',
  TX_INSUFFICIENT_BALANCE = 'tx_insufficient_balance',
  TX_NETWORK_ERROR = 'tx_network_error',
  TX_CONFIRMATION_TIMEOUT = 'tx_confirmation_timeout',
  
  // Unlock
  UNLOCK_RATE_LIMITED = 'unlock_rate_limited',
  UNLOCK_NO_ACCESS = 'unlock_no_access',
  UNLOCK_LEDGER_FAILED = 'unlock_ledger_failed',
  UNLOCK_INTEGRITY_FAILED = 'unlock_integrity_failed',
  UNLOCK_STALE_TERMS = 'unlock_stale_terms',
  
  // Other
  UNKNOWN_ERROR = 'unknown_error',
}

interface FunnelMetric {
  stage: PurchaseFunnelStage;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  failuresByReason: Record<string, number>;
}

interface FunnelMetrics {
  [stage: string]: FunnelMetric;
}

interface ConversionSnapshot {
  timestamp: Date;
  stageName: PurchaseFunnelStage;
  conversionRate: number;           // % of users reaching this stage
  successRate: number;              // % of attempts that succeed at this stage
  avgLatencyMs: number;
  p95LatencyMs: number;
  topFailureReasons: Array<{ reason: string; count: number; pct: number }>;
}

// In-memory metrics (in production, would be backed by time-series DB)
class PurchaseFunnelTracker {
  private metrics: FunnelMetrics = {};
  private latencySamples: Map<PurchaseFunnelStage, number[]> = new Map();
  private totalFunnelStarts = 0;

  recordStageEntry(stage: PurchaseFunnelStage): void {
    if (!this.metrics[stage]) {
      this.metrics[stage] = {
        stage,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        failuresByReason: {},
      };
    }
    
    if (stage === PurchaseFunnelStage.BROWSE) {
      this.totalFunnelStarts++;
    }
  }

  recordStageSuccess(stage: PurchaseFunnelStage, latencyMs: number): void {
    this.recordStageEntry(stage);
    
    const metric = this.metrics[stage]!;
    metric.successCount++;
    metric.totalLatencyMs += latencyMs;
    
    if (!this.latencySamples.has(stage)) {
      this.latencySamples.set(stage, []);
    }
    this.latencySamples.get(stage)!.push(latencyMs);
    
    logger.info({
      event: 'purchase_stage_success',
      stage,
      latencyMs,
    }, `Purchase stage succeeded: ${stage}`);
  }

  recordStageFailure(
    stage: PurchaseFunnelStage,
    reason: PurchaseFailureReason,
    latencyMs?: number
  ): void {
    this.recordStageEntry(stage);
    
    const metric = this.metrics[stage]!;
    metric.failureCount++;
    
    if (latencyMs) {
      metric.totalLatencyMs += latencyMs;
      
      if (!this.latencySamples.has(stage)) {
        this.latencySamples.set(stage, []);
      }
      this.latencySamples.get(stage)!.push(latencyMs);
    }
    
    metric.failuresByReason[reason] = (metric.failuresByReason[reason] || 0) + 1;
    
    logger.warn({
      event: 'purchase_stage_failure',
      stage,
      reason,
      latencyMs,
    }, `Purchase stage failed: ${stage} - ${reason}`);
  }

  getConversionSnapshot(): ConversionSnapshot[] {
    const stages = Object.values(PurchaseFunnelStage);
    const snapshots: ConversionSnapshot[] = [];
    
    for (const stage of stages) {
      const metric = this.metrics[stage];
      if (!metric) continue;
      
      const total = metric.successCount + metric.failureCount;
      const successRate = total > 0 ? (metric.successCount / total) * 100 : 0;
      const conversionRate = this.totalFunnelStarts > 0 
        ? (metric.successCount / this.totalFunnelStarts) * 100 
        : 0;
      
      const samples = this.latencySamples.get(stage) || [];
      const avgLatencyMs = total > 0 ? Math.round(metric.totalLatencyMs / total) : 0;
      const p95LatencyMs = this.percentile(samples, 95);
      
      // Top failure reasons
      const topFailures = Object.entries(metric.failuresByReason)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([reason, count]) => ({
          reason,
          count,
          pct: total > 0 ? (count / total) * 100 : 0,
        }));
      
      snapshots.push({
        timestamp: new Date(),
        stageName: stage,
        conversionRate: Math.round(conversionRate * 100) / 100,
        successRate: Math.round(successRate * 100) / 100,
        avgLatencyMs,
        p95LatencyMs,
        topFailureReasons: topFailures,
      });
    }
    
    return snapshots;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const arraySorted = [...sorted].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * arraySorted.length) - 1;
    return arraySorted[Math.max(0, idx)];
  }

  getMetrics() {
    return this.metrics;
  }

  reset(): void {
    this.metrics = {};
    this.latencySamples.clear();
    this.totalFunnelStarts = 0;
  }
}

export const purchaseFunnelTracker = new PurchaseFunnelTracker();

/**
 * Alert thresholds for purchase funnel
 */
export const PURCHASE_ALERT_THRESHOLDS = {
  // Conversion thresholds (% of users reaching stage)
  min_detail_view_conversion: 50,      // At least 50% click through from browse
  min_buy_initiated_conversion: 20,    // At least 20% proceed to buy
  min_unlock_success_conversion: 60,   // At least 60% of purchase attempts unlock
  
  // Latency thresholds (ms)
  challenge_p95_warn_ms: 1_500,
  challenge_p95_critical_ms: 4_000,
  unlock_p95_warn_ms: 3_000,
  unlock_p95_critical_ms: 8_000,
  
  // Failure rate thresholds (%)
  unlock_failure_rate_warn_pct: 5,
  unlock_failure_rate_critical_pct: 15,
  
  // Stage-specific
  wallet_connect_failure_rate_warn_pct: 10,
} as const;

/**
 * Check conversion and failure metrics against thresholds
 */
export function checkPurchaseFunnelHealth(): {
  alerts: Array<{ severity: 'warn' | 'critical'; message: string }>;
  snapshot: ConversionSnapshot[];
} {
  const snapshot = purchaseFunnelTracker.getConversionSnapshot();
  const alerts: Array<{ severity: 'warn' | 'critical'; message: string }> = [];
  
  // Check conversion rates
  const detailView = snapshot.find(s => s.stageName === PurchaseFunnelStage.DETAIL_VIEW);
  if (detailView && detailView.conversionRate < PURCHASE_ALERT_THRESHOLDS.min_detail_view_conversion) {
    alerts.push({
      severity: 'warn',
      message: `Detail view conversion low: ${detailView.conversionRate}% (threshold: ${PURCHASE_ALERT_THRESHOLDS.min_detail_view_conversion}%)`,
    });
  }
  
  const buyInitiated = snapshot.find(s => s.stageName === PurchaseFunnelStage.BUY_INITIATED);
  if (buyInitiated && buyInitiated.conversionRate < PURCHASE_ALERT_THRESHOLDS.min_buy_initiated_conversion) {
    alerts.push({
      severity: 'warn',
      message: `Buy initiation low: ${buyInitiated.conversionRate}% (threshold: ${PURCHASE_ALERT_THRESHOLDS.min_buy_initiated_conversion}%)`,
    });
  }
  
  const unlockSuccess = snapshot.find(s => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS);
  if (unlockSuccess && unlockSuccess.successRate < PURCHASE_ALERT_THRESHOLDS.min_unlock_success_conversion) {
    alerts.push({
      severity: 'critical',
      message: `Unlock success rate critical: ${unlockSuccess.successRate}% (threshold: ${PURCHASE_ALERT_THRESHOLDS.min_unlock_success_conversion}%)`,
    });
  }
  
  // Check latencies
  const unlock = snapshot.find(s => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS);
  if (unlock) {
    if (unlock.p95LatencyMs > PURCHASE_ALERT_THRESHOLDS.unlock_p95_critical_ms) {
      alerts.push({
        severity: 'critical',
        message: `Unlock p95 latency critical: ${unlock.p95LatencyMs}ms (threshold: ${PURCHASE_ALERT_THRESHOLDS.unlock_p95_critical_ms}ms)`,
      });
    } else if (unlock.p95LatencyMs > PURCHASE_ALERT_THRESHOLDS.unlock_p95_warn_ms) {
      alerts.push({
        severity: 'warn',
        message: `Unlock p95 latency elevated: ${unlock.p95LatencyMs}ms (threshold: ${PURCHASE_ALERT_THRESHOLDS.unlock_p95_warn_ms}ms)`,
      });
    }
  }
  
  return { alerts, snapshot };
}
