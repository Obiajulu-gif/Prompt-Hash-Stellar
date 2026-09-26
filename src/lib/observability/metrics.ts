import { logger } from "./logger";

/**
 * Alert thresholds for operational monitoring.
 *
 * | Metric                        | Warn    | Critical |
 * |-------------------------------|---------|----------|
 * | unlock_duration_ms (p95)      | > 3 000 | > 8 000  |
 * | challenge_duration_ms (p95)   | > 1 500 | > 4 000  |
 * | unlock_failure_rate (5 min)   | > 5 %   | > 15 %   |
 *
 * Exceeding a threshold should page the on-call engineer.
 */
export const ALERT_THRESHOLDS = {
  unlock_p95_warn_ms: 3_000,
  unlock_p95_critical_ms: 8_000,
  challenge_p95_warn_ms: 1_500,
  challenge_p95_critical_ms: 4_000,
  failure_rate_warn_pct: 5,
  failure_rate_critical_pct: 15,
} as const;

// Rolling window for percentile calculation (last N observations)
const PERCENTILE_WINDOW = 100;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

class LatencyTracker {
  private samples: number[] = [];

  record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > PERCENTILE_WINDOW) {
      this.samples.shift();
    }
  }

  snapshot(): { p50: number; p95: number; p99: number; count: number } {
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      count: sorted.length,
    };
  }
}

const unlockLatency = new LatencyTracker();
const challengeLatency = new LatencyTracker();

// Failure-rate counters (reset on read)
let unlockSuccessCount = 0;
let unlockFailureCount = 0;

export const metrics = {
  emit(name: string, value: number = 1, labels: Record<string, string | number> = {}) {
    // In a real production app, this might go to Prometheus or CloudWatch
    // For now, we emit as structured logs which can be parsed
    logger.info({ metric: { name, value, labels } }, `Metric: ${name}`);
  },

  // Specific helpers for this project
  trackUnlockSuccess(wallet: string, promptId: string) {
    unlockSuccessCount++;
    this.emit("unlock_success_total", 1, { wallet, promptId });
  },

  trackUnlockFailure(wallet: string, promptId: string, reason: string) {
    unlockFailureCount++;
    this.emit("unlock_failure_total", 1, { wallet, promptId, reason });
  },

  trackChallengeIssued(wallet: string, promptId: string) {
    this.emit("challenge_issued_total", 1, { wallet, promptId });
  },

  trackRateLimitHit(type: string, identifier: string) {
    this.emit("rate_limit_hit_total", 1, { type, identifier });
  },

  // ── Latency tracking ─────────────────────────────────────────────────────

  /** Record unlock endpoint latency in milliseconds. */
  trackUnlockLatency(ms: number) {
    unlockLatency.record(ms);
    this.emit("unlock_duration_ms", ms);
  },

  /** Record challenge endpoint latency in milliseconds. */
  trackChallengeLatency(ms: number) {
    challengeLatency.record(ms);
    this.emit("challenge_duration_ms", ms);
  },

  /** Return current latency percentiles for unlock and challenge flows. */
  getLatencySnapshot() {
    return {
      unlock: unlockLatency.snapshot(),
      challenge: challengeLatency.snapshot(),
    };
  },

  /**
   * Return the unlock failure rate as a percentage (0–100) since the last call.
   * Resets the counters so each window is independent.
   */
  getAndResetFailureRate(): { rate: number; total: number } {
    const total = unlockSuccessCount + unlockFailureCount;
    const rate = total === 0 ? 0 : (unlockFailureCount / total) * 100;
    unlockSuccessCount = 0;
    unlockFailureCount = 0;
    return { rate, total };
  },
};
