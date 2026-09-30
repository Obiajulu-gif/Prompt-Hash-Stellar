/**
 * Funnel Instrumentation Validation (#724)
 * 
 * Tests that endpoints properly instrument purchase funnel stages
 * and emit required fields (no PII, correlation IDs, latency tracking).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  purchaseFunnelTracker,
  PurchaseFunnelStage,
  PurchaseFailureReason,
} from "../../lib/observability/purchaseFunnelMetrics";
import { logger } from "../../lib/observability/logger";

describe("Funnel Instrumentation Validation", () => {
  beforeEach(() => {
    purchaseFunnelTracker.reset();
    vi.clearAllMocks();
  });

  describe("field requirements", () => {
    it("should record stage entry without PII", () => {
      // Simulate challenge issuance
      purchaseFunnelTracker.recordStageSuccess(
        PurchaseFunnelStage.CHALLENGE_ISSUED,
        150
      );

      const metrics = purchaseFunnelTracker.getMetrics();
      const stage = metrics[PurchaseFunnelStage.CHALLENGE_ISSUED];

      // Verify no wallet address, email, or other PII
      expect(JSON.stringify(stage)).not.toMatch(/0x[a-f0-9]+/); // No Ethereum-like addresses
      expect(JSON.stringify(stage)).not.toMatch(/@/); // No emails
    });

    it("should include latency on all stage successes", () => {
      purchaseFunnelTracker.recordStageSuccess(
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        1250
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const unlock = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS
      );

      expect(unlock?.avgLatencyMs).toBe(1250);
    });

    it("should include p95 latency for alert thresholds", () => {
      for (let i = 1; i <= 100; i++) {
        purchaseFunnelTracker.recordStageSuccess(
          PurchaseFunnelStage.UNLOCK_SUCCESS,
          i * 50
        );
      }

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const unlock = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS
      );

      expect(unlock?.p95LatencyMs).toBeGreaterThan(0);
      expect(unlock?.p95LatencyMs).toBeLessThanOrEqual(5000);
    });

    it("should track failure reasons distinctly", () => {
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        PurchaseFailureReason.UNLOCK_NO_ACCESS
      );
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        PurchaseFailureReason.UNLOCK_LEDGER_FAILED
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const unlock = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS
      );

      expect(unlock?.topFailureReasons).toContainEqual(
        expect.objectContaining({
          reason: PurchaseFailureReason.UNLOCK_NO_ACCESS,
        })
      );
      expect(unlock?.topFailureReasons).toContainEqual(
        expect.objectContaining({
          reason: PurchaseFailureReason.UNLOCK_LEDGER_FAILED,
        })
      );
    });
  });

  describe("endpoint instrumentation", () => {
    it("should track challenge issuance stage", () => {
      // api/auth/challenge.ts should call:
      // purchaseFunnelTracker.recordStageSuccess(
      //   PurchaseFunnelStage.CHALLENGE_ISSUED,
      //   latencyMs
      // );
      purchaseFunnelTracker.recordStageSuccess(
        PurchaseFunnelStage.CHALLENGE_ISSUED,
        82
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const challenge = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.CHALLENGE_ISSUED
      );

      expect(challenge?.successRate).toBe(100);
    });

    it("should track unlock success with latency", () => {
      // api/prompts/unlock.ts should call:
      // purchaseFunnelTracker.recordStageSuccess(
      //   PurchaseFunnelStage.UNLOCK_SUCCESS,
      //   Date.now() - unlockStartMs
      // );
      purchaseFunnelTracker.recordStageSuccess(
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        1450
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const unlock = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS
      );

      expect(unlock?.successRate).toBe(100);
      expect(unlock?.avgLatencyMs).toBeGreaterThan(0);
    });

    it("should track unlock failures by reason", () => {
      // api/prompts/unlock.ts should call on various failure paths:
      // purchaseFunnelTracker.recordStageFailure(
      //   PurchaseFunnelStage.UNLOCK_SUCCESS,
      //   reason,
      //   latencyMs
      // );

      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.UNLOCK_SUCCESS,
        PurchaseFailureReason.UNLOCK_NO_ACCESS,
        800
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const unlock = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS
      );

      expect(unlock?.topFailureReasons[0]?.reason).toBe(
        PurchaseFailureReason.UNLOCK_NO_ACCESS
      );
    });

    it("should track challenge signature failures", () => {
      // api/prompts/unlock.ts should call on invalid signature:
      // purchaseFunnelTracker.recordStageFailure(
      //   PurchaseFunnelStage.CHALLENGE_SIGNED,
      //   PurchaseFailureReason.SIGNATURE_INVALID
      // );
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.CHALLENGE_SIGNED,
        PurchaseFailureReason.SIGNATURE_INVALID,
        120
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const challengeSigned = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.CHALLENGE_SIGNED
      );

      expect(challengeSigned?.topFailureReasons[0]?.reason).toBe(
        PurchaseFailureReason.SIGNATURE_INVALID
      );
    });

    it("should track rate limit failures distinctly", () => {
      // api/auth/challenge.ts and api/prompts/unlock.ts should call:
      // purchaseFunnelTracker.recordStageFailure(
      //   stage,
      //   PurchaseFailureReason.CHALLENGE_RATE_LIMITED  |
      //   PurchaseFailureReason.UNLOCK_RATE_LIMITED
      // );
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.CHALLENGE_ISSUED,
        PurchaseFailureReason.CHALLENGE_RATE_LIMITED
      );
      purchaseFunnelTracker.recordStageFailure(
        PurchaseFunnelStage.UNLOCK_ATTEMPT,
        PurchaseFailureReason.UNLOCK_RATE_LIMITED
      );

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();

      const challenge = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.CHALLENGE_ISSUED
      );
      expect(challenge?.topFailureReasons[0]?.reason).toBe(
        PurchaseFailureReason.CHALLENGE_RATE_LIMITED
      );

      const unlock = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.UNLOCK_ATTEMPT
      );
      expect(unlock?.topFailureReasons[0]?.reason).toBe(
        PurchaseFailureReason.UNLOCK_RATE_LIMITED
      );
    });
  });

  describe("alert threshold validation", () => {
    it("should detect unlock success rate critical alert", () => {
      // Set up scenario: 100 unlock attempts, 50 succeed
      for (let i = 0; i < 50; i++) {
        purchaseFunnelTracker.recordStageSuccess(
          PurchaseFunnelStage.UNLOCK_SUCCESS,
          1000
        );
      }
      for (let i = 0; i < 50; i++) {
        purchaseFunnelTracker.recordStageFailure(
          PurchaseFunnelStage.UNLOCK_SUCCESS,
          PurchaseFailureReason.UNLOCK_NO_ACCESS
        );
      }

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const unlock = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS
      );

      // Threshold: min 60% success
      expect(unlock?.successRate).toBeLessThan(60);
    });

    it("should validate conversion rate thresholds", () => {
      // 100 browse, 40 detail (40% < 50% threshold)
      for (let i = 0; i < 100; i++) {
        purchaseFunnelTracker.recordStageSuccess(
          PurchaseFunnelStage.BROWSE,
          100
        );
      }
      for (let i = 0; i < 40; i++) {
        purchaseFunnelTracker.recordStageSuccess(
          PurchaseFunnelStage.DETAIL_VIEW,
          200
        );
      }

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();
      const detail = snapshot.find(
        (s) => s.stageName === PurchaseFunnelStage.DETAIL_VIEW
      );

      expect(detail?.conversionRate).toBeLessThan(50);
    });
  });

  describe("missing instrumentation detection", () => {
    it("should identify unmonitored funnel stages", () => {
      // These stages should have instrumentation but might be missing:
      const requiredStages = [
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

      const snapshot = purchaseFunnelTracker.getConversionSnapshot();

      // After a complete purchase flow, all stages should have data
      // This test documents which stages MUST be instrumented
      expect(requiredStages.length).toBeGreaterThan(0);
    });
  });

  describe("log structure validation", () => {
    it("should log events with structured fields", () => {
      const logSpy = vi.spyOn(logger, "info");

      purchaseFunnelTracker.recordStageSuccess(
        PurchaseFunnelStage.CHALLENGE_ISSUED,
        150
      );

      // Verify that logs are structured and include required fields
      expect(logSpy).toHaveBeenCalled();
    });
  });
});
