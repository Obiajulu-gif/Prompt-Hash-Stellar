import type { Model } from "mongoose";
import InboundWebhookEvent from "../../models/InboundWebhookEvent";
import JobRecord from "../../models/JobRecord";
import QuarantinedEvent from "../../models/QuarantinedEvent";
import Report from "../../models/Report";
import { logger } from "../../services/structuredLogger";
import { getActiveHeldRecordIds } from "../../services/retentionHoldService";
import { getRetentionCutoff } from "../retentionPolicy";
import type { JobRecordDTO, RetentionCleanupPayload } from "../types";

type ArchiveResult = {
  eligible: number;
  skipped: number;
  held: number;
  failed: number;
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

export type DeletionVerificationResult = {
  collection: string;
  remainingSensitiveFields: number;
  remainingUnarchived: number;
  verified: boolean;
};

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
  options: { dryRun: boolean; batchSize: number; heldIds?: string[] },
): Promise<ArchiveResult> {
  // Records covered by an active retention hold (disputes, investigations) are
  // excluded from every query below, independent of their per-record flag.
  const heldIds = options.heldIds ?? [];
  const heldGuard = heldIds.length > 0 ? { _id: { $nin: heldIds } } : {};
  const eligibleFilter = { ...filter, ...heldGuard, retentionHold: { $ne: true }, archivedAt: null };

  const eligible = await model.countDocuments({
    ...eligibleFilter,
    retentionHold: { $ne: true },
    archivedAt: null,
  });

  const flagHeld = await model.countDocuments({
    ...filter,
    retentionHold: true,
  });
  // Ledger-held records whose flag is missing are still held; count them too.
  const ledgerOnlyHeld =
    heldIds.length > 0
      ? await model.countDocuments({
          ...filter,
          _id: { $in: heldIds },
          retentionHold: { $ne: true },
        })
      : 0;
  const held = flagHeld + ledgerOnlyHeld;

  const skipped = await model.countDocuments({
    ...filter,
    archivedAt: { $ne: null },
  });

  if (options.dryRun) {
    return { eligible, held, skipped, archived: 0, failed: 0, dryRun: true };
  }

  let totalArchived = 0;
  let totalFailed = 0;
  for (;;) {
    const documents = await model
      .find(eligibleFilter, { _id: 1 })
      .limit(options.batchSize)
      .lean();
    if (documents.length === 0) break;

    try {
      const result = await model.updateMany(
        {
          $and: [
            eligibleFilter,
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
      if (result.modifiedCount < documents.length) {
        totalFailed += documents.length - result.modifiedCount;
      }

      if (documents.length < options.batchSize || result.modifiedCount === 0) {
        break;
      }
    } catch (error) {
      totalFailed += documents.length;
      break;
    }
  }
  return {
    eligible,
    held,
    skipped,
    archived: totalArchived,
    failed: totalFailed,
    dryRun: false,
  };
}

/**
 * Verifies that archived records actually carry the scrubbed shape and that no
 * eligible record remains unarchived. Runs after the live pass so that a
 * silently failed update (result.failed > 0) or a partial scrub is surfaced
 * instead of being reported as success.
 */
export async function verifyRetentionDeletion(
  options: { now?: Date } = {},
): Promise<DeletionVerificationResult[]> {
  const now = options.now ?? new Date();
  const eventCutoff = requiredCutoff("promptEvents", now);
  const exportCutoff = requiredCutoff("exports", now);
  const supportCutoff = requiredCutoff("supportEvidence", now);
  const held = await getActiveHeldRecordIds();

  const checks: Array<{
    collection: string;
    model: RetentionModel;
    filter: Record<string, unknown>;
    sensitiveFilter: Record<string, unknown>;
    heldIds: string[];
  }> = [
    {
      collection: "inboundWebhookEvents",
      model: InboundWebhookEvent,
      filter: {
        processingStatus: { $in: ["processed", "skipped"] },
        createdAt: { $lt: eventCutoff },
      },
      sensitiveFilter: { rawBody: { $nin: ["", null] } },
      heldIds: held.inboundWebhookEvents,
    },
    {
      collection: "quarantinedEvents",
      model: QuarantinedEvent,
      filter: {
        status: { $in: ["replayed", "discarded"] },
        updatedAt: { $lt: eventCutoff },
      },
      sensitiveFilter: { rawTopic: { $nin: ["", null] } },
      heldIds: held.quarantinedEvents,
    },
    {
      collection: "exports",
      model: JobRecord,
      filter: {
        type: "export_csv",
        status: { $in: ["completed", "failed", "dead_letter"] },
        $or: [
          { completedAt: { $lt: exportCutoff } },
          { completedAt: null, updatedAt: { $lt: exportCutoff } },
        ],
      },
      sensitiveFilter: {
        $or: [
          { "payload.archived": { $ne: true } },
          { "payload.version": { $ne: 1 } },
        ],
      },
      heldIds: held.exports,
    },
    {
      collection: "supportEvidence",
      model: Report,
      filter: {
        status: { $in: ["resolved", "dismissed"] },
        $or: [
          { resolvedAt: { $lt: supportCutoff } },
          { resolvedAt: null, updatedAt: { $lt: supportCutoff } },
        ],
      },
      sensitiveFilter: {
        $or: [
          { reporterAddress: { $nin: ["[REDACTED]", null] } },
          { description: { $nin: ["", null] } },
          { adminNotes: { $nin: ["", null] } },
          { evidence: { $exists: true, $not: { $size: 0 } } },
        ],
      },
      heldIds: held.supportEvidence,
    },
  ];

  const results: DeletionVerificationResult[] = [];
  for (const check of checks) {
    const heldGuard =
      check.heldIds.length > 0 ? { _id: { $nin: check.heldIds } } : {};
    const archivedFilter = {
      ...check.filter,
      ...heldGuard,
      retentionHold: { $ne: true },
      archivedAt: { $ne: null },
    };
    const remainingUnarchived = await check.model.countDocuments({
      ...check.filter,
      ...heldGuard,
      retentionHold: { $ne: true },
      archivedAt: null,
    });
    const remainingSensitiveFields = await check.model.countDocuments({
      ...archivedFilter,
      ...check.sensitiveFilter,
    });
    results.push({
      collection: check.collection,
      remainingSensitiveFields: remainingSensitiveFields,
      remainingUnarchived: remainingUnarchived,
      verified: remainingSensitiveFields === 0 && remainingUnarchived === 0,
    });
  }

  const failed = results.filter((result) => !result.verified);
  if (failed.length > 0) {
    logger.error("Retention deletion verification failed", {
      action: "retentionDeletionVerification",
      failed,
    });
    throw new Error(
      `Retention deletion verification failed for ${failed.map((r) => r.collection).join(", ")}`,
    );
  }

  logger.info("Retention deletion verified", {
    action: "retentionDeletionVerification",
    results,
  });
  return results;
}

export async function runRetentionCleanup(
  options: {
    now?: Date;
    dryRun?: boolean;
    batchSize?: number;
    verify?: boolean;
  } = {},
): Promise<RetentionCleanupResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? 500;
  const verify = options.verify ?? !dryRun;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new Error(
      "retention_cleanup batchSize must be an integer between 1 and 5000",
    );
  }

  const eventCutoff = requiredCutoff("promptEvents", now);
  const exportCutoff = requiredCutoff("exports", now);
  const supportCutoff = requiredCutoff("supportEvidence", now);
  // Fail closed: if the hold ledger cannot be read this throws, the job is
  // retried by the worker, and nothing is archived in the meantime.
  const held = await getActiveHeldRecordIds();

  const result: RetentionCleanupResult = {
    inboundWebhookEvents: await archiveEligible(
        InboundWebhookEvent,
        {
          processingStatus: { $in: ["processed", "skipped"] },
          createdAt: { $lt: eventCutoff },
        },
        {
          $set: { archivedAt: now, rawBody: "", rawHeaders: {}, errorMessage: null },
        },
        { dryRun, batchSize, heldIds: held.inboundWebhookEvents },
      ),
    quarantinedEvents: await archiveEligible(
        QuarantinedEvent,
        {
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
        { dryRun, batchSize, heldIds: held.quarantinedEvents },
      ),
    exports: await archiveEligible(
        JobRecord,
        {
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
        { dryRun, batchSize, heldIds: held.exports },
      ),
    supportEvidence: await archiveEligible(
        Report,
        {
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
        { dryRun, batchSize, heldIds: held.supportEvidence },
      ),
  };

  logger.info("Retention cleanup completed", {
    action: "retentionCleanup",
    dryRun,
    batchSize,
    ledgerHolds: {
      inboundWebhookEvents: held.inboundWebhookEvents.length,
      quarantinedEvents: held.quarantinedEvents.length,
      exports: held.exports.length,
      supportEvidence: held.supportEvidence.length,
    },
    ...result,
  });

  // Verification is run after the live pass so that a silently failed update
  // or a partial scrub surfaces as a job failure and is retried.
  if (verify && !dryRun) {
    await verifyRetentionDeletion({ now });
  }

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
