import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  purchaseFunnelTracker,
  PurchaseFunnelStage,
  PurchaseFailureReason,
  checkPurchaseFunnelHealth,
  PURCHASE_ALERT_THRESHOLDS,
} from "../../lib/observability/purchaseFunnelMetrics";

describe("Purchase Funnel Metrics", () => {
  beforeEach(() => {
    purchaseFunnelTracker.reset();
  });

  describe("recordStageSuccess", () => {
    it("should track successful stage transitions", () => {
      purchaseFunnelTracker.recordStageEntry(PurchaseFunnelStage.BROWSE);
      purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BROWSE, 150);

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const browseStage = snapshot.find((s) => s.stageName === PurchaseFunnelStage.BROWSE);

      expect(browseStage).toBeDefined();
      expect(browseStage?.successRate).toBe(100);
      expect(browseStage?.avgLatencyMs).toBe(150);
    });

    it("should accumulate multiple success records", () => {
      purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.DETAIL_VIEW, 100);
      purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.DETAIL_VIEW, 200);
      purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.DETAIL_VIEW, 300);

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const detailStage = snapshot.find((s) => s.stageName === PurchaseFunnelStage.DETAIL_VIEW);

      expect(detailStage?.avgLatencyMs).toBe(200); // (100 + 200 + 300) / 3
    });

    it("should track latency percentiles", () => {
      for (let i = 1; i <= 100; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.CHALLENGE_SIGNED, i * 10);
      }

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const stage = snapshot.find((s) => s.stageName === PurchaseFunnelStage.CHALLENGE_SIGNED);

      expect(stage?.p95LatencyMs).toBeGreaterThan(0);
      expect(stage?.p95LatencyMs).toBeLessThanOrEqual(1000);
    });
  });

  describe("recordStageFailure", () => {
    it("should track failures by reason", () => {
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.CHALLENGE_ISSUED,
        PurchaseFailureReason.WALLET_CONNECT_FAILED,
        100
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const stage = snapshot.find((s) => s.stageName === PurchaseFunnelStage.CHALLENGE_ISSUED);

      expect(stage?.successRate).toBe(0);
      expect(stage?.topFailureReasons.length).toBeGreaterThan(0);
      expect(stage?.topFailureReasons[0]?.reason).toBe(PurchaseFailureReason.WALLET_CONNECT_FAILED);
    });

    it("should aggregate failure reasons", () => {
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        PurchaseFailureReason.UNLOCK_NO_ACCESS
      );
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        PurchaseFailureReason.UNLOCK_NO_ACCESS
      );
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        PurchaseFailureReason.UNLOCK_LEDGER_FAILED
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const stage = snapshot.find((s) => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS);

      expect(stage?.topFailureReasons).toContainEqual(
        expect.objectContaining({
          reason: PurchaseFailureReason.UNLOCK_NO_ACCESS,
          count: 2,
        })
      );
    });

    it("should calculate failure percentages", () => {
      purchaseFunnelTracker.recordStageSuccess(
        PurchaseFunnelStage.UNLOCK_ATTEMPT,
        100
      );
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.UNLOCK_ATTEMPT,
        PurchaseFailureReason.UNLOCK_NO_ACCESS
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const stage = snapshot.find((s) => s.stageName === PurchaseFunnelStage.UNLOCK_ATTEMPT);

      expect(stage?.successRate).toBe(50);
      expect(stage?.topFailureReasons[0]?.pct).toBe(50);
    });

    it("should handle optional latency", () => {
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.BUY_INITIATED,
        PurchaseFailureReason.WALLET_CONNECT_FAILED
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const stage = snapshot.find((s) => s.stageName === PurchaseFunnelStage.BUY_INITIATED);

      expect(stage).toBeDefined();
      expect(stage?.avgLatencyMs).toBe(0);
    });
  });

  describe("conversion funnel tracking", () => {
    it("should track conversion through entire funnel", () => {
      const stages = [
        PurchaseFunnelStage.BROWSE,
        PurchaseFunnelStage.DETAIL_VIEW,
        PurchaseFunnelStage.BUY_INITIATED,
        PurchaseFunnelStage.CHALLENGE_ISSUED,
        PurchaseFunnelStage.CHALLENGE_SIGNED,
        PurchaseFunnelStage.PURCHASE_TX_SUBMITTED,
        PurchaseFunnelStage.PURCHASE_TX_CONFIRMED,
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        PurchaseFunnelStage.RECEIPT_VIEWED,
      ];

      // 100 users browse
      for (let i = 0; i < 100; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BROWSE, 100);
      }

      // 75 view detail (75%)
      for (let i = 0; i < 75; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.DETAIL_VIEW, 200);
      }

      // 15 initiate buy (15% of browses, 20% of detail viewers)
      for (let i = 0; i < 15; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BUY_INITIATED, 150);
      }

      // 12 get challenge (12% of browses)
      for (let i = 0; i < 12; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.CHALLENGE_ISSUED, 80);
      }

      // 10 sign (10%)
      for (let i = 0; i < 10; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.CHALLENGE_SIGNED, 120);
      }

      // 8 unlock (8%)
      for (let i = 0; i < 8; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.UNLOCK_SUCCESS, 500);
      }

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();

      const browse = snapshot.find((s) => s.stageName === PurchaseFunnelStage.BROWSE);
      const detail = snapshot.find((s) => s.stageName === PurchaseFunnelStage.DETAIL_VIEW);
      const buy = snapshot.find((s) => s.stageName === PurchaseFunnelStage.BUY_INITIATED);

      expect(browse?.conversionRate).toBe(100);
      expect(detail?.conversionRate).toBe(75);
      expect(buy?.conversionRate).toBe(15);
    });

    it("should detect drop-offs between stages", () => {
      // 100 browse
      for (let i = 0; i < 100; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BROWSE, 100);
      }

      // Only 10 make it to detail (massive drop-off)
      for (let i = 0; i < 10; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.DETAIL_VIEW, 200);
      }

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const detail = snapshot.find((s) => s.stageName === PurchaseFunnelStage.DETAIL_VIEW);

      expect(detail?.conversionRate).toBe(10);
    });
  });

  describe("checkPurchaseFunnelHealth", () => {
    it("should alert on low detail view conversion", () => {
      // Set up low conversion: 100 browse, 30 detail (30% < 50% threshold)
      for (let i = 0; i < 100; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BROWSE, 100);
      }
      for (let i = 0; i < 30; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.DETAIL_VIEW, 200);
      }

      const { alerts } = checkPurchaseFunnelHealth();

      expect(alerts.some((a) => a.message.includes("Detail view conversion"))).toBe(true);
      expect(alerts.some((a) => a.severity === "warn")).toBe(true);
    });

    it("should alert on critical unlock success rate", () => {
      // 100 unlock attempts, 50 success (50% < 60% threshold)
      for (let i = 0; i < 50; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.UNLOCK_SUCCESS, 200);
      }
      for (let i = 0; i < 50; i++) {
        purchaseFunnelTracker.recordStageFailure(
          PurchaseFunnelStage.UNLOCK_SUCCESS,
          PurchaseFailureReason.UNLOCK_NO_ACCESS
        );
      }

      const { alerts } = checkPurchaseFunnelHealth();

      expect(alerts.some((a) => a.severity === "critical")).toBe(true);
      expect(alerts.some((a) => a.message.includes("Unlock success rate"))).toBe(true);
    });

    it("should alert on elevated unlock latency", () => {
      // Record unlocks with high latency (> 3s)
      for (let i = 0; i < 50; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.UNLOCK_SUCCESS, 5000);
      }

      const { alerts } = checkPurchaseFunnelHealth();

      expect(alerts.some((a) => a.message.includes("Unlock p95 latency"))).toBe(true);
    });

    it("should return snapshot data", () => {
      purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BROWSE, 100);

      const { snapshot } = checkPurchaseFunnelHealth();

      expect(snapshot.length).toBeGreaterThan(0);
      expect(snapshot[0]).toHaveProperty("timestamp");
      expect(snapshot[0]).toHaveProperty("stageName");
      expect(snapshot[0]).toHaveProperty("conversionRate");
      expect(snapshot[0]).toHaveProperty("successRate");
    });

    it("should not alert on healthy metrics", () => {
      // Set up healthy funnel
      for (let i = 0; i < 100; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BROWSE, 100);
      }
      for (let i = 0; i < 60; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.DETAIL_VIEW, 200);
      }
      for (let i = 0; i < 20; i++) {
        purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BUY_INITIATED, 150);
      }
      for (let i = 0; i < 16; i++) {
        purchaseFunnelTracker.recordStageSuccess(
          PurchaseFunnelStage.UNLOCK_SUCCESS,
          1000
        );
      }

      const { alerts } = checkPurchaseFunnelHealth();

      // Should have no critical or warn alerts in healthy state
      expect(alerts.length).toBe(0);
    });
  });

  describe("alert thresholds", () => {
    it("should expose configurable alert thresholds", () => {
      expect(PURCHASE_ALERT_THRESHOLDS).toHaveProperty(
        "min_detail_view_conversion"
      );
      expect(PURCHASE_ALERT_THRESHOLDS).toHaveProperty("min_buy_initiated_conversion");
      expect(PURCHASE_ALERT_THRESHOLDS).toHaveProperty("min_unlock_success_conversion");
      expect(PURCHASE_ALERT_THRESHOLDS).toHaveProperty("unlock_p95_warn_ms");
      expect(PURCHASE_ALERT_THRESHOLDS).toHaveProperty("unlock_p95_critical_ms");
    });

    it("should enforce reasonable threshold values", () => {
      expect(PURCHASE_ALERT_THRESHOLDS.min_detail_view_conversion).toBeGreaterThan(0);
      expect(PURCHASE_ALERT_THRESHOLDS.min_detail_view_conversion).toBeLessThanOrEqual(100);
      expect(PURCHASE_ALERT_THRESHOLDS.unlock_p95_critical_ms).toBeGreaterThan(
        PURCHASE_ALERT_THRESHOLDS.unlock_p95_warn_ms
      );
    });
  });

  describe("metrics reset", () => {
    it("should clear all metrics on reset", () => {
      purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BROWSE, 100);
      purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.DETAIL_VIEW, 200);

      let snapshot = purchaseFunnelTracker.getConversionSnapshot();
      expect(snapshot.length).toBeGreaterThan(0);

      purchaseFunnelTracker.reset();

      snapshot = purchaseFunnelTracker.getConversionSnapshot();
      expect(snapshot.length).toBe(0);
    });
  });
});
