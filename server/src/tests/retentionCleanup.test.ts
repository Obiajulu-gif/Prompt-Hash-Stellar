import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inboundWebhookEvent: {
    countDocuments: vi.fn(),
    find: vi.fn(),
    updateMany: vi.fn(),
  },
  quarantinedEvent: {
    countDocuments: vi.fn(),
    find: vi.fn(),
    updateMany: vi.fn(),
  },
  jobRecord: {
    countDocuments: vi.fn(),
    find: vi.fn(),
    updateMany: vi.fn(),
  },
  report: {
    countDocuments: vi.fn(),
    find: vi.fn(),
    updateMany: vi.fn(),
  },
  logger: { info: vi.fn(), error: vi.fn() },
  getActiveHeldRecordIds: vi.fn(),
}));

vi.mock("../models/InboundWebhookEvent", () => ({
  default: mocks.inboundWebhookEvent,
}));
vi.mock("../models/QuarantinedEvent", () => ({
  default: mocks.quarantinedEvent,
}));
vi.mock("../models/JobRecord", () => ({
  default: mocks.jobRecord,
}));
vi.mock("../models/Report", () => ({
  default: mocks.report,
}));
vi.mock("../services/retentionHoldService", () => ({
  getActiveHeldRecordIds: mocks.getActiveHeldRecordIds,
}));
vi.mock("../services/structuredLogger", () => ({
  logger: mocks.logger,
}));

import {
  handleRetentionCleanup,
  runRetentionCleanup,
} from "../jobs/handlers/retentionCleanup";
import { getHandler } from "../jobs/worker";

const modelMocks = [
  mocks.inboundWebhookEvent,
  mocks.quarantinedEvent,
  mocks.jobRecord,
  mocks.report,
];

describe("retention cleanup job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveHeldRecordIds.mockResolvedValue({
      inboundWebhookEvents: [],
      quarantinedEvents: [],
      exports: [],
      supportEvidence: [],
    });
    for (const model of modelMocks) {
      model.countDocuments.mockResolvedValue(0);
      model.find.mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      });
      model.updateMany.mockResolvedValue({ modifiedCount: 0 });
    }
  });

  it("dry-runs all eligible categories without modifying records", async () => {
    const setupMock = (modelMock: any, eligibleCount: number) => {
      modelMock.countDocuments.mockImplementation(async (filter: any) => {
        if (filter.retentionHold === true) return 1;
        if (filter.archivedAt && filter.archivedAt.$ne !== undefined) return 2;
        return eligibleCount;
      });
    };
    setupMock(mocks.inboundWebhookEvent, 2);
    setupMock(mocks.quarantinedEvent, 1);
    setupMock(mocks.jobRecord, 3);
    setupMock(mocks.report, 4);

    const result = await runRetentionCleanup({
      now: new Date("2026-09-26T00:00:00.000Z"),
      dryRun: true,
    });

    expect(result).toEqual({
      inboundWebhookEvents: { eligible: 2, held: 1, skipped: 2, archived: 0, failed: 0, dryRun: true },
      quarantinedEvents: { eligible: 1, held: 1, skipped: 2, archived: 0, failed: 0, dryRun: true },
      exports: { eligible: 3, held: 1, skipped: 2, archived: 0, failed: 0, dryRun: true },
      supportEvidence: { eligible: 4, held: 1, skipped: 2, archived: 0, failed: 0, dryRun: true },
    });
    expect(mocks.inboundWebhookEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.quarantinedEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.jobRecord.updateMany).not.toHaveBeenCalled();
    expect(mocks.report.updateMany).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "Retention cleanup completed",
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("archives and scrubs expired data without deleting or bypassing holds", async () => {
    const now = new Date("2026-09-26T00:00:00.000Z");
    mocks.inboundWebhookEvent.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: "event-1" }]),
      }),
    });
    mocks.inboundWebhookEvent.updateMany.mockResolvedValue({
      modifiedCount: 1,
    });

    const result = await runRetentionCleanup({ now, batchSize: 10 });

    expect(result.inboundWebhookEvents.archived).toBe(1);
    expect(mocks.inboundWebhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            retentionHold: { $ne: true },
            archivedAt: null,
          }),
          expect.objectContaining({
            _id: { $in: ["event-1"] },
            retentionHold: { $ne: true },
            archivedAt: null,
          }),
        ]),
      }),
      {
        $set: {
          archivedAt: now,
          rawBody: "",
          rawHeaders: {},
          errorMessage: null,
        },
      },
    );
    expect(mocks.quarantinedEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.jobRecord.updateMany).not.toHaveBeenCalled();
    expect(mocks.report.updateMany).not.toHaveBeenCalled();
  });

  it("scrubs support evidence and export metadata when archiving those records", async () => {
    mocks.jobRecord.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: "export-1" }]),
      }),
    });
    mocks.jobRecord.updateMany.mockResolvedValue({ modifiedCount: 1 });
    mocks.report.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: "report-1" }]),
      }),
    });
    mocks.report.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await runRetentionCleanup({ now: new Date("2026-09-26T00:00:00.000Z") });

    expect(mocks.jobRecord.updateMany).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          payload: { version: 1, archived: true },
          lastError: null,
          attemptHistory: [],
        }),
      }),
    );
    expect(mocks.report.updateMany).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          reporterAddress: "[REDACTED]",
          description: "",
          adminNotes: "",
          evidence: [],
        }),
      }),
    );
  });

  it("excludes ledger-held records from counts and archive queries", async () => {
    const heldId = "64b7f0f0f0f0f0f0f0f0f0f0";
    mocks.getActiveHeldRecordIds.mockResolvedValue({
      inboundWebhookEvents: [],
      quarantinedEvents: [],
      exports: [],
      supportEvidence: [heldId],
    });
    mocks.report.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: "report-2" }]),
      }),
    });
    mocks.report.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await runRetentionCleanup({ now: new Date("2026-09-26T00:00:00.000Z") });

    // Candidate lookup and update both carry the $nin guard.
    expect(mocks.report.find).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $nin: [heldId] } }),
      { _id: 1 },
    );
    expect(mocks.report.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([expect.objectContaining({ _id: { $nin: [heldId] } })]),
      }),
      expect.any(Object),
    );
    // Categories without holds are unguarded.
    expect(mocks.inboundWebhookEvent.find).toHaveBeenCalledWith(
      expect.not.objectContaining({ _id: expect.anything() }),
      { _id: 1 },
    );
  });

  it("counts ledger-held records whose per-record flag is missing as held", async () => {
    const heldId = "64b7f0f0f0f0f0f0f0f0f0f0";
    mocks.getActiveHeldRecordIds.mockResolvedValue({
      inboundWebhookEvents: [],
      quarantinedEvents: [],
      exports: [heldId],
      supportEvidence: [],
    });
    mocks.jobRecord.countDocuments.mockImplementation(async (filter: any) => {
      if (filter._id?.$in) return 1; // ledger-only held
      return 0;
    });

    const result = await runRetentionCleanup({ dryRun: true });
    expect(result.exports.held).toBe(1);
    expect(result.exports.archived).toBe(0);
  });

  it("fails closed and archives nothing when the hold ledger is unreadable", async () => {
    mocks.getActiveHeldRecordIds.mockRejectedValue(new Error("ledger down"));
    await expect(runRetentionCleanup({})).rejects.toThrow("ledger down");
    for (const model of modelMocks) {
      expect(model.updateMany).not.toHaveBeenCalled();
    }
  });

  it("rejects unsafe batch sizes", async () => {
    await expect(runRetentionCleanup({ batchSize: 0 })).rejects.toThrow(
      /batchSize/,
    );
    await expect(runRetentionCleanup({ batchSize: 5001 })).rejects.toThrow(
      /batchSize/,
    );
  });

  it("logs cleanup failures and rethrows them for worker retry handling", async () => {
    const failure = new Error("database unavailable");
    mocks.inboundWebhookEvent.countDocuments.mockRejectedValue(failure);

    await expect(
      handleRetentionCleanup({
        id: "retention-job-1",
        type: "retention_cleanup",
        status: "processing",
        payload: { version: 1, dryRun: true },
        attempts: 0,
        maxAttempts: 5,
        lastError: null,
        nextRunAt: new Date(),
        createdAt: new Date(),
      }),
    ).rejects.toThrow("database unavailable");
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Retention cleanup failed",
      expect.objectContaining({
        action: "retentionCleanup",
        jobId: "retention-job-1",
      }),
    );
  });

  it("registers the retention handler with the worker", () => {
    expect(getHandler("retention_cleanup")).toBe(handleRetentionCleanup);
  });

  it("verifies deletion by re-querying archived records and reports residual matches", async () => {
    const now = new Date("2026-09-26T00:00:00.000Z");
    mocks.inboundWebhookEvent.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: "event-1" }]),
      }),
    });
    mocks.inboundWebhookEvent.updateMany.mockResolvedValue({ modifiedCount: 1 });
    // Simulate a record that still matches the archive filter after the update
    // (e.g. a concurrent writer re-populated rawBody).
    mocks.inboundWebhookEvent.countDocuments.mockImplementation(async (filter: any) => {
      if (filter._id?.$in) return 1;
      return 0;
    });

    const result = await runRetentionCleanup({ now, batchSize: 10 });

    expect(result.inboundWebhookEvents.archived).toBe(1);
    expect(result.inboundWebhookEvents.failed).toBe(1);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Retention deletion verification failed",
      expect.objectContaining({
        action: "retentionCleanup",
        category: "inboundWebhookEvents",
        residual: 1,
      }),
    );
  });

  it("retries verification and succeeds once residual records clear", async () => {
    const now = new Date("2026-09-26T00:00:00.000Z");
    mocks.inboundWebhookEvent.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: "event-1" }]),
      }),
    });
    mocks.inboundWebhookEvent.updateMany.mockResolvedValue({ modifiedCount: 1 });
    let verifyCalls = 0;
    mocks.inboundWebhookEvent.countDocuments.mockImplementation(async (filter: any) => {
      if (filter._id?.$in) {
        verifyCalls += 1;
        return verifyCalls === 1 ? 1 : 0;
      }
      return 0;
    });

    const result = await runRetentionCleanup({ now, batchSize: 10 });

    expect(result.inboundWebhookEvents.archived).toBe(1);
    expect(result.inboundWebhookEvents.failed).toBe(0);
    expect(verifyCalls).toBeGreaterThanOrEqual(2);
  });

  it("does not verify deletion for held or skipped records", async () => {
    const now = new Date("2026-09-26T00:00:00.000Z");
    mocks.inboundWebhookEvent.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });

    await runRetentionCleanup({ now, batchSize: 10 });

    expect(mocks.inboundWebhookEvent.updateMany).not.toHaveBeenCalled();
    expect(mocks.inboundWebhookEvent.countDocuments).not.toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.anything() }),
    );
  });

  it("rejects unauthorized callers before touching any model", async () => {
    await expect(
      runRetentionCleanup({
        now: new Date("2026-09-26T00:00:00.000Z"),
        actor: { id: "user-1", role: "viewer" },
      }),
    ).rejects.toThrow(/authoriz/i);
    for (const model of modelMocks) {
      expect(model.countDocuments).not.toHaveBeenCalled();
      expect(model.find).not.toHaveBeenCalled();
      expect(model.updateMany).not.toHaveBeenCalled();
    }
  });

  it("allows authorized operators to run cleanup", async () => {
    const result = await runRetentionCleanup({
      now: new Date("2026-09-26T00:00:00.000Z"),
      dryRun: true,
      actor: { id: "admin-1", role: "admin" },
    });
    expect(result.inboundWebhookEvents.dryRun).toBe(true);
  });
});
