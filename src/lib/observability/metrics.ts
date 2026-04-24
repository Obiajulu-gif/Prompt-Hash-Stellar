import { logger } from "./logger";

type MetricType = "counter" | "histogram";

interface Metric {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string | number>;
}

export const metrics = {
  emit(name: string, value: number = 1, labels: Record<string, string | number> = {}) {
    // In a real production app, this might go to Prometheus or CloudWatch
    // For now, we emit as structured logs which can be parsed
    logger.info({ metric: { name, value, labels } }, `Metric: ${name}`);
  },

  // Specific helpers for this project
  trackUnlockSuccess(wallet: string, promptId: string) {
    this.emit("unlock_success_total", 1, { wallet, promptId });
  },

  trackUnlockFailure(wallet: string, promptId: string, reason: string) {
    this.emit("unlock_failure_total", 1, { wallet, promptId, reason });
  },

  trackChallengeIssued(wallet: string, promptId: string) {
    this.emit("challenge_issued_total", 1, { wallet, promptId });
  },

  trackRateLimitHit(type: string, identifier: string) {
    this.emit("rate_limit_hit_total", 1, { type, identifier });
  }
};
