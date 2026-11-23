import { describe, it, expect, vi, beforeEach } from "vitest";
import WebhookOutboxEvent from "../models/WebhookOutboxEvent";
import WebhookSubscription from "../models/WebhookSubscription";
import {
  quarantineWebhookEvent,
  replayAllDeadLetters,
  getWebhookOperationalMetrics,
  listDeadLetters,
} from "../services/webhookOutbox";
import {
  pauseWebhookWorker,
  resumeWebhookWorker,
  isWebhookWorkerPaused,
  claimRow,
} from "../services/webhookOutboxWorker";
import { WebhookRecoveryDrillRunner } from "../services/webhookRecoveryDrill";

vi.mock("../models/WebhookOutboxEvent", () => ({
  default: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    updateMany: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock("../models/WebhookSubscription", () => ({
  default: {
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

describe("Issue #1099 - Webhook Backlog, Poison Quarantine & Dead-Letter Recovery Drill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resumeWebhookWorker(); // Ensure clean worker state
  });

  describe("Operator Controls: Pause and Resume Dispatcher", () => {
    it("pauses dispatcher and prevents claimRow from accessing database", async () => {
      pauseWebhookWorker();
      expect(isWebhookWorkerPaused()).toBe(true);

      const claimed = await claimRow(new Date());
      expect(claimed).toBeNull();
      // Outbox query must NOT be invoked when worker is paused
      expect(WebhookOutboxEvent.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("resumes dispatcher and allows claimRow to poll for eligible rows", async () => {
      pauseWebhookWorker();
      expect(isWebhookWorkerPaused()).toBe(true);

      resumeWebhookWorker();
      expect(isWebhookWorkerPaused()).toBe(false);

      (WebhookOutboxEvent.findOneAndUpdate as any).mockResolvedValue({
        _id: "row-123",
        status: "pending",
        attempts: 1,
      });

      const claimed = await claimRow(new Date());
      expect(claimed).not.toBeNull();
      expect(WebhookOutboxEvent.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe("Poison Message Quarantine", () => {
    it("transitions poison message to dead_letter with recorded audit reason", async () => {
      (WebhookOutboxEvent.findByIdAndUpdate as any).mockResolvedValue({
        _id: "row-poison",
        status: "dead_letter",
        lastError: "Quarantined: Malformed JSON payload",
      });

      const quarantined = await quarantineWebhookEvent("row-poison", "Malformed JSON payload");
      expect(quarantined).toBe(true);
      expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
        "row-poison",
        expect.objectContaining({
          $set: expect.objectContaining({
            status: "dead_letter",
            lastError: "Quarantined: Malformed JSON payload",
            leaseHolder: null,
            leaseExpiresAt: null,
          }),
        }),
      );
    });

    it("returns false when target poison event does not exist", async () => {
      (WebhookOutboxEvent.findByIdAndUpdate as any).mockResolvedValue(null);

      const quarantined = await quarantineWebhookEvent("non-existent-id", "Malformed event");
      expect(quarantined).toBe(false);
    });
  });

  describe("Dead-Letter Queue Visibility and Batch Replay", () => {
    it("queries dead-letter queue with bounded limit", async () => {
      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          { _id: "dl-1", status: "dead_letter", lastError: "Timeout" },
          { _id: "dl-2", status: "dead_letter", lastError: "500 Internal Error" },
        ]),
      };
      (WebhookOutboxEvent.find as any).mockReturnValue(mockQuery);

      const deadLetters = await listDeadLetters({ limit: 10 });
      expect(deadLetters.length).toBe(2);
      expect(WebhookOutboxEvent.find).toHaveBeenCalledWith({ status: "dead_letter" });
      expect(mockQuery.limit).toHaveBeenCalledWith(10);
    });

    it("replays all dead letters by resetting state to pending", async () => {
      (WebhookOutboxEvent.updateMany as any).mockResolvedValue({ modifiedCount: 5 });

      const replayedCount = await replayAllDeadLetters();
      expect(replayedCount).toBe(5);
      expect(WebhookOutboxEvent.updateMany).toHaveBeenCalledWith(
        { status: "dead_letter" },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: "pending",
            attempts: 0,
            lastError: null,
            leaseHolder: null,
            leaseExpiresAt: null,
          }),
        }),
      );
    });

    it("replays dead letters scoped to a specific subscriptionId", async () => {
      (WebhookOutboxEvent.updateMany as any).mockResolvedValue({ modifiedCount: 2 });

      const replayedCount = await replayAllDeadLetters({ subscriptionId: "sub-alpha" });
      expect(replayedCount).toBe(2);
      expect(WebhookOutboxEvent.updateMany).toHaveBeenCalledWith(
        { status: "dead_letter", subscriptionId: "sub-alpha" },
        expect.any(Object),
      );
    });
  });

  describe("Operational Metrics Collection", () => {
    it("collects accurate counts for pending, dead-letter, and delivered events", async () => {
      (WebhookOutboxEvent.countDocuments as any)
        .mockResolvedValueOnce(12) // pending
        .mockResolvedValueOnce(3)  // dead_letter
        .mockResolvedValueOnce(95) // delivered
        .mockResolvedValueOnce(110); // total

      const metrics = await getWebhookOperationalMetrics();
      expect(metrics).toEqual({
        pendingCount: 12,
        deadLetterCount: 3,
        deliveredCount: 95,
        totalOutboxCount: 110,
      });
    });
  });

  describe("Executable Webhook Recovery Drill Suite", () => {
    it("executes full 5-scenario drill successfully and reports evidence", async () => {
      // Mock subscriptions for duplicate check
      (WebhookSubscription.find as any).mockResolvedValue([{ _id: "sub-drill" }]);
      (WebhookOutboxEvent.findOne as any)
        .mockResolvedValueOnce(null) // first enqueue finds no duplicate
        .mockResolvedValueOnce({ _id: "existing-row" }); // second enqueue finds duplicate
      (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({ nextDeliverySequence: 1 });
      (WebhookOutboxEvent.create as any).mockResolvedValue({ _id: "row-1" });

      // Mock quarantine
      (WebhookOutboxEvent.findByIdAndUpdate as any).mockResolvedValue({ _id: "poison-1" });

      // Mock dead letter list
      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ _id: "dl-drill", status: "dead_letter" }]),
      };
      (WebhookOutboxEvent.find as any).mockReturnValue(mockQuery);

      // Mock count documents for operational metrics
      (WebhookOutboxEvent.countDocuments as any)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(26);

      const report = await WebhookRecoveryDrillRunner.runFullDrill();

      expect(report.passed).toBe(true);
      expect(report.totalScenarios).toBe(5);
      expect(report.passedCount).toBe(5);
      expect(report.failedCount).toBe(0);
      expect(report.results.map((r) => r.scenarioId)).toEqual([
        "SCENARIO_1_OUTAGE_BACKLOG_AND_RESUME",
        "SCENARIO_2_DUPLICATE_DELIVERY_DEDUPLICATION",
        "SCENARIO_3_POISON_MESSAGE_QUARANTINE",
        "SCENARIO_4_DEAD_LETTER_VISIBILITY_AND_REPLAY",
        "SCENARIO_5_RETRY_LIMITS_AND_BACKOFF",
      ]);

      // Worker should be left in resumed state
      expect(isWebhookWorkerPaused()).toBe(false);
    });
  });
});
