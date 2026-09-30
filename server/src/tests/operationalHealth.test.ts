import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  operationalHealthService,
  sanitizeSensitiveData,
} from "../services/operationalHealthService.js";
import InboundWebhookEvent from "../models/InboundWebhookEvent.js";
import QuarantinedEvent from "../models/QuarantinedEvent.js";
import JobRecord from "../models/JobRecord.js";
import Report from "../models/Report.js";
import SupportCase from "../models/SupportCase.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { IndexerState } from "../models/IndexerState.js";


describe("OperationalHealthService (Issue #814)", () => {
  const NOW = new Date("2026-09-27T00:00:00.000Z");

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default safe mocks for all Mongoose models
    vi.spyOn(InboundWebhookEvent, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    } as any);
    vi.spyOn(QuarantinedEvent, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    } as any);
    vi.spyOn(JobRecord, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    } as any);
    vi.spyOn(Report, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    } as any);
    vi.spyOn(SupportCase, "find").mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    } as any);
    vi.spyOn(LedgerEntry, "find").mockReturnValue({
      lean: async () => [],
    } as any);
    vi.spyOn(IndexerState, "findOne").mockReturnValue({
      lean: async () => null,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sanitizeSensitiveData", () => {
    it("redacts secret keys, auth tokens, passwords, and sensitive keys", () => {
      const sensitiveInput = {
        secretSeed: "SDJFWKLJ234KJL234KJL234KJL234KJL234KJL234KJL234KJL234",
        authHeader: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz",
        password: "super_secret_password",
        nested: {
          userApiKey: "key_live_1234567890",
          publicWallet: "GABC1234567890",
        },
      };

      const sanitized = sanitizeSensitiveData(sensitiveInput);

      expect(sanitized.secretSeed).toBe("[REDACTED]");
      expect(sanitized.authHeader).toBe("[REDACTED]");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.nested.userApiKey).toBe("[REDACTED]");
      expect(sanitized.nested.publicWallet).toBe("GABC1234567890");
    });
  });

  describe("generateHealthReport", () => {
    it("reports HEALTHY when no failures, stale jobs, drift, or incidents exist", async () => {
      vi.spyOn(InboundWebhookEvent, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(QuarantinedEvent, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(JobRecord, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(Report, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(SupportCase, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(LedgerEntry, "find").mockReturnValue({
        lean: async () => [],
      } as any);
      vi.spyOn(IndexerState, "findOne").mockReturnValue({
        lean: async () => ({ lastIndexedLedger: 1000 }),
      } as any);

      const report = await operationalHealthService.generateHealthReport(NOW);

      expect(report.status).toBe("HEALTHY");
      expect(report.summary.totalUnresolvedExceptions).toBe(0);
      expect(report.summary.staleJobsCount).toBe(0);
      expect(report.summary.reconciliationDriftCount).toBe(0);
      expect(report.summary.activeIncidentsCount).toBe(0);
      expect(report.categories.reconciliationDrift.status).toBe("in_sync");
      expect(report.categories.reconciliationDrift.lastIndexedLedger).toBe(1000);
    });

    it("aggregates unresolved webhook failures and redacts sensitive error fields", async () => {
      vi.spyOn(InboundWebhookEvent, "find").mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: async () => [
              {
                _id: "evt-1",
                eventId: "wh_fail_1",
                eventType: "payment_received",
                status: "failed",
                error: "Authentication failed for Bearer secret_token_xyz with seed SABC1234567890123456789012345678901234567890123456789012",
                retryCount: 3,
                createdAt: new Date("2026-09-26T23:30:00.000Z"),
              },
            ],
          }),
        }),
      } as any);
      vi.spyOn(QuarantinedEvent, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(JobRecord, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(Report, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(SupportCase, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(LedgerEntry, "find").mockReturnValue({
        lean: async () => [],
      } as any);

      const report = await operationalHealthService.generateHealthReport(NOW);

      expect(report.status).toBe("DEGRADED");
      expect(report.summary.totalUnresolvedExceptions).toBe(1);
      expect(report.categories.unresolvedExceptions[0].category).toBe("webhook_failure");
      expect(report.categories.unresolvedExceptions[0].message).not.toContain("SABC1234");
      expect(report.categories.unresolvedExceptions[0].investigationLink).toBe("/api/webhooks/events/wh_fail_1");
    });

    it("detects dead-letter and stale jobs (>15 mins)", async () => {
      vi.spyOn(InboundWebhookEvent, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(QuarantinedEvent, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(JobRecord, "find")
        .mockReturnValueOnce({
          sort: () => ({
            limit: () => ({
              lean: async () => [
                {
                  id: "dlq-job-1",
                  type: "export_generation",
                  status: "dead_letter",
                  attempts: 5,
                  lastError: "Storage bucket access denied",
                  updatedAt: new Date("2026-09-26T22:00:00.000Z"),
                },
              ],
            }),
          }),
        } as any)
        .mockReturnValueOnce({
          sort: () => ({
            limit: () => ({
              lean: async () => [
                {
                  id: "stuck-job-2",
                  type: "retention_cleanup",
                  status: "processing",
                  attempts: 1,
                  updatedAt: new Date("2026-09-26T23:00:00.000Z"), // 1 hour ago
                  createdAt: new Date("2026-09-26T23:00:00.000Z"),
                },
              ],
            }),
          }),
        } as any);
      vi.spyOn(Report, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(SupportCase, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(LedgerEntry, "find").mockReturnValue({
        lean: async () => [],
      } as any);

      const report = await operationalHealthService.generateHealthReport(NOW);

      expect(report.status).toBe("CRITICAL"); // DLQ job escalates to CRITICAL
      expect(report.summary.staleJobsCount).toBe(1);
      expect(report.categories.staleJobs[0].id).toBe("stuck-job-2");
      expect(report.categories.staleJobs[0].stuckDurationMinutes).toBe(60);
    });

    it("detects reconciliation drift with unsettled ledger entries", async () => {
      vi.spyOn(InboundWebhookEvent, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(QuarantinedEvent, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(JobRecord, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(Report, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(SupportCase, "find").mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as any);
      vi.spyOn(LedgerEntry, "find").mockReturnValue({
        lean: async () => [
          { entryType: "payout", amount: 150.5, stellarTxRef: null },
          { entryType: "payout", amount: 200.0, stellarTxRef: "" },
        ],
      } as any);

      const report = await operationalHealthService.generateHealthReport(NOW);

      expect(report.summary.reconciliationDriftCount).toBe(2);
      expect(report.categories.reconciliationDrift.status).toBe("drift_detected");
      expect(report.categories.reconciliationDrift.unsettledAmountSum).toBe(350.5);
    });
  });
});
