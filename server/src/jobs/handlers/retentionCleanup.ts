import type { Model } from "mongoose";
import InboundWebhookEvent from "../../models/InboundWebhookEvent";
import JobRecord from "../../models/JobRecord";
import QuarantinedEvent from "../../models/QuarantinedEvent";
import Report from "../../models/Report";
import { logger } from "../../services/structuredLogger";
import { getRetentionCutoff } from "../retentionPolicy";
import type { JobRecordDTO, RetentionCleanupPayload } from "../types";

type ArchiveResult = {
  archived: number;
  dryRun: boolean;
};

type RetentionCleanupResult = {
  inboundWebhookEvents: ArchiveResult;
  quarantinedEvents: ArchiveResult;
  exports: ArchiveResult;
  supportEvidence: ArchiveResult;
};

type RetentionModel = Model<unknown>;

function requiredCutoff(
  dataType: "promptEvents" | "exports" | "supportEvidence",
  now: Date,
): Date {
  const cutoff = getRetentionCutoff(dataType, now);
  if (cutoff === null) {
    throw new Error(`retention_cleanup requires a finite ${dataType} policy`);
  }
  return cutoff;
}

async function archiveEligible(
  model: RetentionModel,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  options: { dryRun: boolean; batchSize: number },
): Promise<number> {
  if (options.dryRun) {
    return model.countDocuments(filter);
  }

  let totalArchived = 0;
  for (;;) {
    const documents = await model
      .find(filter, { _id: 1 })
      .limit(options.batchSize)
      .lean();
    if (documents.length === 0) break;

    const result = await model.updateMany(
      {
        $and: [
          filter,
          {
            _id: { $in: documents.map((document) => document._id) },
            retentionHold: { $ne: true },
            archivedAt: null,
          },
        ],
      },
      update,
    );
    totalArchived += result.modifiedCount;

    if (documents.length < options.batchSize || result.modifiedCount === 0) {
      break;
    }
  }
  return totalArchived;
}

export async function runRetentionCleanup(
  options: {
    now?: Date;
    dryRun?: boolean;
    batchSize?: number;
  } = {},
): Promise<RetentionCleanupResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? 500;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new Error(
      "retention_cleanup batchSize must be an integer between 1 and 5000",
    );
  }

  const eventCutoff = requiredCutoff("promptEvents", now);
  const exportCutoff = requiredCutoff("exports", now);
  const supportCutoff = requiredCutoff("supportEvidence", now);
  const commonEligibility = {
    retentionHold: { $ne: true },
    archivedAt: null,
  };

  const result: RetentionCleanupResult = {
    inboundWebhookEvents: {
      archived: await archiveEligible(
        InboundWebhookEvent,
        {
          ...commonEligibility,
          processingStatus: { $in: ["processed", "skipped"] },
          createdAt: { $lt: eventCutoff },
        },
        {
          $set: { archivedAt: now, rawBody: "", rawHeaders: {} },
        },
        { dryRun, batchSize },
      ),
      dryRun,
    },
    quarantinedEvents: {
      archived: await archiveEligible(
        QuarantinedEvent,
        {
          ...commonEligibility,
          status: { $in: ["replayed", "discarded"] },
          updatedAt: { $lt: eventCutoff },
        },
        {
          $set: { archivedAt: now },
          $unset: {
            rawTopic: "",
            rawValue: "",
            rawXdr: "",
            errorDetails: "",
          },
        },
        { dryRun, batchSize },
      ),
      dryRun,
    },
    exports: {
      archived: await archiveEligible(
        JobRecord,
        {
          ...commonEligibility,
          type: "export_csv",
          status: { $in: ["completed", "failed", "dead_letter"] },
          $or: [
            { completedAt: { $lt: exportCutoff } },
            { completedAt: null, updatedAt: { $lt: exportCutoff } },
          ],
        },
        {
          $set: {
            archivedAt: now,
            payload: { version: 1, archived: true },
            lastError: null,
            attemptHistory: [],
          },
        },
        { dryRun, batchSize },
      ),
      dryRun,
    },
    supportEvidence: {
      archived: await archiveEligible(
        Report,
        {
          ...commonEligibility,
          status: { $in: ["resolved", "dismissed"] },
          $or: [
            { resolvedAt: { $lt: supportCutoff } },
            { resolvedAt: null, updatedAt: { $lt: supportCutoff } },
          ],
        },
        {
          $set: {
            archivedAt: now,
            reporterAddress: "[REDACTED]",
            description: "",
            adminNotes: "",
            evidence: [],
          },
        },
        { dryRun, batchSize },
      ),
      dryRun,
    },
  };

  logger.info("Retention cleanup completed", {
    action: "retentionCleanup",
    dryRun,
    batchSize,
    ...result,
  });
  return result;
}

export async function handleRetentionCleanup(job: JobRecordDTO): Promise<void> {
  if (job.type !== "retention_cleanup") {
    throw new Error("retention_cleanup handler received a different job type");
  }
  const payload = job.payload as RetentionCleanupPayload;
  if (payload.version !== 1) {
    throw new Error(
      "retention_cleanup requires a version 1 retention cleanup payload",
    );
  }

  try {
    await runRetentionCleanup({ dryRun: payload.dryRun });
  } catch (error) {
    logger.error("Retention cleanup failed", {
      action: "retentionCleanup",
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
