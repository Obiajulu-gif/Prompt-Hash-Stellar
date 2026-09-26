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
    mocks.inboundWebhookEvent.countDocuments.mockResolvedValue(2);
    mocks.quarantinedEvent.countDocuments.mockResolvedValue(1);
    mocks.jobRecord.countDocuments.mockResolvedValue(3);
    mocks.report.countDocuments.mockResolvedValue(4);

    const result = await runRetentionCleanup({
      now: new Date("2026-09-26T00:00:00.000Z"),
      dryRun: true,
    });

    expect(result).toEqual({
      inboundWebhookEvents: { archived: 2, dryRun: true },
      quarantinedEvents: { archived: 1, dryRun: true },
      exports: { archived: 3, dryRun: true },
      supportEvidence: { archived: 4, dryRun: true },
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
});
