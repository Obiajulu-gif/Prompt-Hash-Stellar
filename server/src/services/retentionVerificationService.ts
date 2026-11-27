/**
 * Retention enforcement and deletion verification (#1181).
 *
 * Bridges the gap between retention policy definitions (`retentionPolicy.ts`),
 * background archival (`retentionCleanup.ts`), and verifiable compliance proof:
 *
 *   1. Post-scrub & deletion verification (`verifyCollectionDeletion`,
 *      `verifyRetentionDeletion`, `verifyArchivedRecordScrubbed`):
 *      - Confirms that archived records in `inboundWebhookEvents`,
 *        `quarantinedEvents`, `exports` (`JobRecord`), and `supportEvidence`
 *        (`Report`) have actually had their sensitive payload fields removed
 *        (no residual `rawBody`, `rawHeaders`, `rawXdr`, `reporterAddress`,
 *        evidence attachments, or unredacted export payloads).
 *      - Confirms that no unheld eligible records remain past their retention
 *        cutoff (`overdueUnheldCount === 0`) and no expired terminal
 *        `ExportRecord` artifacts remain unpurged (`expiredExportsRemaining === 0`).
 *      - Produces a deterministic SHA-256 `attestationHash` over the
 *        verification report so audits and compliance checks can prove
 *        deletion/scrubbing took place without exposing any record content.
 *
 *   2. End-to-end retention enforcement (`enforceAndVerifyRetention`):
 *      - Runs hold-aware retention cleanup (`runRetentionCleanup`), purges
 *        expired terminal `ExportRecord` artifacts (`cleanupExpiredExports`)
 *        when not in `dryRun`, and executes deletion/scrub verification.
 *      - Automatically repairs any incomplete scrub on already-archived rows
 *        when `repairIncompleteScrubs` is enabled (idempotent retry recovery).
 *      - Records tamper-evident audit events (`retention_enforcement_executed`
 *        and `retention_deletion_verified`) with `result: "success" | "failure"`.
 *      - Fails closed when the hold ledger is unavailable or when residual
 *        unscrubbed data is detected.
 *
 * All I/O is injectable via `RetentionVerificationDeps` for deterministic unit
 * testing as well as live MongoDB execution.
 */

import { createHash } from "crypto";
import InboundWebhookEvent from "../models/InboundWebhookEvent";
import QuarantinedEvent from "../models/QuarantinedEvent";
import JobRecord from "../models/JobRecord";
import Report from "../models/Report";
import { ExportRecord } from "../models/ExportRecord";
import { HOLDABLE_COLLECTIONS, type HoldableCollection } from "../models/RetentionHold";
import { getRetentionCutoff, RETENTION_POLICIES } from "../jobs/retentionPolicy";
import { runRetentionCleanup } from "../jobs/handlers/retentionCleanup";
import { getActiveHeldRecordIds } from "./retentionHoldService";
import { recordAuditEvent, type AuditEventParams } from "./auditTrail";
import { logger } from "./structuredLogger";

export type VerifiableCollection = HoldableCollection;

export interface ResidualScrubViolation {
  collection: VerifiableCollection;
  recordId: string;
  residualFields: string[];
}

export interface CollectionVerificationSummary {
  collection: VerifiableCollection;
  cutoff: string;
  archivedChecked: number;
  properlyScrubbed: number;
  residualViolationCount: number;
  overdueUnheldCount: number;
  repairedCount: number;
  violations: ResidualScrubViolation[];
}

export interface DeletionVerificationReport {
  verified: boolean;
  checkedAt: string;
  sampleLimit: number;
  collections: Record<VerifiableCollection, CollectionVerificationSummary>;
  expiredExportArtifactsRemaining: number;
  totalArchivedChecked: number;
  totalResidualViolations: number;
  totalOverdueUnheld: number;
  totalRepaired: number;
  attestationHash: string;
}

export interface RetentionEnforcementReport {
  dryRun: boolean;
  batchSize: number;
  executedAt: string;
  cleanup: Awaited<ReturnType<typeof runRetentionCleanup>>;
  expiredExportArtifactsPurged: number;
  verification: DeletionVerificationReport;
}

export type RetentionEnforcementErrorCode =
  | "invalid_request"
  | "hold_ledger_unavailable"
  | "verification_failed"
  | "enforcement_failed";

export class RetentionEnforcementError extends Error {
  public readonly code: RetentionEnforcementErrorCode;
  public readonly details: string[];

  constructor(
    code: RetentionEnforcementErrorCode,
    message: string,
    details: string[] = [],
  ) {
    super(message);
    this.name = "RetentionEnforcementError";
    this.code = code;
    this.details = details;
  }
}

// ─── Pure Record-Level Scrub Verification ────────────────────────────────────

/**
 * Pure check that an archived document in `collection` has no residual
 * sensitive fields left behind after `archivedAt` was set.
 * Returns the list of field names that still carry sensitive data (empty = clean).
 */
export function findResidualScrubFields(
  collection: VerifiableCollection,
  doc: Record<string, unknown>,
): string[] {
  const residual: string[] = [];

  switch (collection) {
    case "inboundWebhookEvents": {
      if (typeof doc.rawBody === "string" && doc.rawBody.length > 0) {
        residual.push("rawBody");
      }
      if (
        doc.rawHeaders &&
        typeof doc.rawHeaders === "object" &&
        Object.keys(doc.rawHeaders as Record<string, unknown>).length > 0
      ) {
        residual.push("rawHeaders");
      }
      if (doc.errorMessage !== null && doc.errorMessage !== undefined && doc.errorMessage !== "") {
        residual.push("errorMessage");
      }
      break;
    }
    case "quarantinedEvents": {
      for (const field of ["rawTopic", "rawValue", "rawXdr", "errorDetails"] as const) {
        if (doc[field] !== undefined && doc[field] !== null && doc[field] !== "") {
          residual.push(field);
        }
      }
      break;
    }
    case "exports": {
      const payload = doc.payload as Record<string, unknown> | null | undefined;
      const keys = payload && typeof payload === "object" ? Object.keys(payload) : [];
      const isArchivedMarker =
        payload &&
        typeof payload === "object" &&
        payload.archived === true &&
        keys.every((k) => k === "version" || k === "archived");
      if (!isArchivedMarker) {
        residual.push("payload");
      }
      if (doc.lastError !== null && doc.lastError !== undefined && doc.lastError !== "") {
        residual.push("lastError");
      }
      if (Array.isArray(doc.attemptHistory) && doc.attemptHistory.length > 0) {
        residual.push("attemptHistory");
      }
      break;
    }
    case "supportEvidence": {
      const reporter = typeof doc.reporterAddress === "string" ? doc.reporterAddress.toLowerCase() : "";
      if (reporter !== "[redacted]") {
        residual.push("reporterAddress");
      }
      if (typeof doc.description === "string" && doc.description.length > 0) {
        residual.push("description");
      }
      if (typeof doc.adminNotes === "string" && doc.adminNotes.length > 0) {
        residual.push("adminNotes");
      }
      if (Array.isArray(doc.evidence) && doc.evidence.length > 0) {
        residual.push("evidence");
      }
      break;
    }
  }

  return residual;
}

/**
 * Deterministic SHA-256 attestation digest over a deletion verification summary.
 * Only counts, timestamps, cutoffs, and record IDs enter the digest — never raw content.
 */
export function computeDeletionAttestationHash(input: {
  checkedAt: string;
  collections: Record<VerifiableCollection, CollectionVerificationSummary>;
  expiredExportArtifactsRemaining: number;
}): string {
  const canonical = JSON.stringify({
    checkedAt: input.checkedAt,
    expiredExportArtifactsRemaining: input.expiredExportArtifactsRemaining,
    collections: Object.fromEntries(
      HOLDABLE_COLLECTIONS.map((col) => {
        const c = input.collections[col];
        return [
          col,
          {
            cutoff: c.cutoff,
            archivedChecked: c.archivedChecked,
            properlyScrubbed: c.properlyScrubbed,
            residualViolationCount: c.residualViolationCount,
            overdueUnheldCount: c.overdueUnheldCount,
            repairedCount: c.repairedCount,
            violationIds: c.violations.map((v) => `${v.recordId}:${v.residualFields.join(",")}`).sort(),
          },
        ];
      }),
    ),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ─── Injectable Dependencies ─────────────────────────────────────────────────

export interface CollectionVerificationAdapter {
  listArchived(limit: number): Promise<Array<Record<string, unknown>>>;
  countOverdueUnheld(cutoff: Date, heldIds: string[]): Promise<number>;
  repairScrub(recordIds: string[], now: Date): Promise<number>;
}

export interface RetentionVerificationDeps {
  collections: Record<VerifiableCollection, CollectionVerificationAdapter>;
  getHeldIds(): Promise<Record<HoldableCollection, string[]>>;
  runCleanup(options: { now: Date; dryRun: boolean; batchSize: number }): Promise<
    Awaited<ReturnType<typeof runRetentionCleanup>>
  >;
  purgeExpiredExportArtifacts(now: Date): Promise<number>;
  countExpiredExportArtifacts(now: Date): Promise<number>;
  audit(params: AuditEventParams): Promise<void>;
  now(): Date;
}

function requiredCutoffForCollection(collection: VerifiableCollection, now: Date): Date {
  const dataType =
    collection === "inboundWebhookEvents" || collection === "quarantinedEvents"
      ? "promptEvents"
      : collection;
  const cutoff = getRetentionCutoff(dataType, now);
  if (!cutoff) {
    throw new RetentionEnforcementError(
      "enforcement_failed",
      `No finite retention cutoff configured for ${collection}.`,
    );
  }
  return cutoff;
}

const MAX_SAMPLE_LIMIT = 5_000;
const DEFAULT_SAMPLE_LIMIT = 500;

export interface VerifyRetentionOptions {
  now?: Date;
  sampleLimit?: number;
  repairIncompleteScrubs?: boolean;
  actor?: string | null;
  requestId?: string | null;
  recordAudit?: boolean;
}

/**
 * Verifies that all archived records across the 4 retention-managed collections
 * have been completely scrubbed of sensitive fields, that no unheld eligible
 * records remain past their cutoff, and that no expired terminal `ExportRecord`
 * rows remain.
 */
export async function verifyRetentionDeletion(
  options: VerifyRetentionOptions = {},
  deps: RetentionVerificationDeps = defaultRetentionVerificationDeps(),
): Promise<DeletionVerificationReport> {
  const now = options.now ?? deps.now();
  const sampleLimit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > MAX_SAMPLE_LIMIT) {
    throw new RetentionEnforcementError(
      "invalid_request",
      `sampleLimit must be an integer between 1 and ${MAX_SAMPLE_LIMIT}.`,
    );
  }

  let heldIds: Record<HoldableCollection, string[]>;
  try {
    heldIds = await deps.getHeldIds();
  } catch (err) {
    throw new RetentionEnforcementError(
      "hold_ledger_unavailable",
      `Cannot verify retention while hold ledger is unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const summaries = {} as Record<VerifiableCollection, CollectionVerificationSummary>;
  let totalArchivedChecked = 0;
  let totalResidualViolations = 0;
  let totalOverdueUnheld = 0;
  let totalRepaired = 0;

  for (const collection of HOLDABLE_COLLECTIONS) {
    const adapter = deps.collections[collection];
    const cutoff = requiredCutoffForCollection(collection, now);
    const archivedDocs = await adapter.listArchived(sampleLimit);
    let violations: ResidualScrubViolation[] = [];

    for (const doc of archivedDocs) {
      const residualFields = findResidualScrubFields(collection, doc);
      if (residualFields.length > 0) {
        violations.push({
          collection,
          recordId: String(doc._id ?? doc.id ?? "unknown"),
          residualFields,
        });
      }
    }

    let repairedCount = 0;
    if (options.repairIncompleteScrubs && violations.length > 0) {
      const idsToRepair = violations.map((v) => v.recordId);
      repairedCount = await adapter.repairScrub(idsToRepair, now);
      // Re-verify after repair to confirm no residual fields remain
      const recheckedDocs = await adapter.listArchived(sampleLimit);
      violations = [];
      for (const doc of recheckedDocs) {
        const residualFields = findResidualScrubFields(collection, doc);
        if (residualFields.length > 0) {
          violations.push({
            collection,
            recordId: String(doc._id ?? doc.id ?? "unknown"),
            residualFields,
          });
        }
      }
    }

    const overdueUnheldCount = await adapter.countOverdueUnheld(cutoff, heldIds[collection] ?? []);
    const archivedChecked = archivedDocs.length;
    const residualViolationCount = violations.length;
    const properlyScrubbed = Math.max(0, archivedChecked - residualViolationCount);

    summaries[collection] = {
      collection,
      cutoff: cutoff.toISOString(),
      archivedChecked,
      properlyScrubbed,
      residualViolationCount,
      overdueUnheldCount,
      repairedCount,
      violations,
    };

    totalArchivedChecked += archivedChecked;
    totalResidualViolations += residualViolationCount;
    totalOverdueUnheld += overdueUnheldCount;
    totalRepaired += repairedCount;
  }

  const expiredExportArtifactsRemaining = await deps.countExpiredExportArtifacts(now);
  const checkedAt = now.toISOString();
  const verified =
    totalResidualViolations === 0 &&
    totalOverdueUnheld === 0 &&
    expiredExportArtifactsRemaining === 0;

  const attestationHash = computeDeletionAttestationHash({
    checkedAt,
    collections: summaries,
    expiredExportArtifactsRemaining,
  });

  const report: DeletionVerificationReport = {
    verified,
    checkedAt,
    sampleLimit,
    collections: summaries,
    expiredExportArtifactsRemaining,
    totalArchivedChecked,
    totalResidualViolations,
    totalOverdueUnheld,
    totalRepaired,
    attestationHash,
  };

  if (options.recordAudit !== false) {
    await deps.audit({
      action: "retention_deletion_verified",
      result: verified ? "success" : "failure",
      actor: options.actor ?? "system",
      requestId: options.requestId ?? null,
      target: `attestation:${attestationHash.slice(0, 16)}`,
      targetType: "retention_verification",
      reason: `verified=${verified} checked=${totalArchivedChecked} violations=${totalResidualViolations} overdue=${totalOverdueUnheld} expiredExports=${expiredExportArtifactsRemaining} repaired=${totalRepaired}`,
      metadata: {
        verified,
        totalArchivedChecked,
        totalResidualViolations,
        totalOverdueUnheld,
        totalRepaired,
        expiredExportArtifactsRemaining,
        attestationHash,
      },
    });
  }

  return report;
}

export interface EnforceAndVerifyOptions {
  now?: Date;
  dryRun?: boolean;
  batchSize?: number;
  sampleLimit?: number;
  repairIncompleteScrubs?: boolean;
  actor?: string | null;
  requestId?: string | null;
}

/**
 * Executes retention cleanup across all operational collections, purges expired
 * terminal `ExportRecord` artifacts (when `dryRun` is false), and runs
 * post-scrub deletion verification with tamper-evident audit logging.
 */
export async function enforceAndVerifyRetention(
  options: EnforceAndVerifyOptions = {},
  deps: RetentionVerificationDeps = defaultRetentionVerificationDeps(),
): Promise<RetentionEnforcementReport> {
  const now = options.now ?? deps.now();
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? 500;
  const sampleLimit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new RetentionEnforcementError(
      "invalid_request",
      "batchSize must be an integer between 1 and 5000.",
    );
  }
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > MAX_SAMPLE_LIMIT) {
    throw new RetentionEnforcementError(
      "invalid_request",
      `sampleLimit must be an integer between 1 and ${MAX_SAMPLE_LIMIT}.`,
    );
  }

  let cleanup: Awaited<ReturnType<typeof runRetentionCleanup>>;
  try {
    cleanup = await deps.runCleanup({ now, dryRun, batchSize });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.audit({
      action: "retention_enforcement_executed",
      result: "failure",
      actor: options.actor ?? "system",
      requestId: options.requestId ?? null,
      target: "retention_cleanup",
      targetType: "retention_enforcement",
      reason: `dryRun=${dryRun} error=${msg.slice(0, 200)}`,
    });
    if (/ledger|hold/i.test(msg)) {
      throw new RetentionEnforcementError("hold_ledger_unavailable", msg);
    }
    throw new RetentionEnforcementError("enforcement_failed", msg);
  }

  const expiredExportArtifactsPurged = dryRun ? 0 : await deps.purgeExpiredExportArtifacts(now);

  const verification = await verifyRetentionDeletion(
    {
      now,
      sampleLimit,
      repairIncompleteScrubs: dryRun ? false : (options.repairIncompleteScrubs ?? true),
      actor: options.actor ?? "system",
      requestId: options.requestId ?? null,
      recordAudit: true,
    },
    deps,
  );

  const totalArchived =
    cleanup.inboundWebhookEvents.archived +
    cleanup.quarantinedEvents.archived +
    cleanup.exports.archived +
    cleanup.supportEvidence.archived;
  const totalFailed =
    cleanup.inboundWebhookEvents.failed +
    cleanup.quarantinedEvents.failed +
    cleanup.exports.failed +
    cleanup.supportEvidence.failed;

  const enforcementSucceeded = totalFailed === 0 && (dryRun || verification.verified);

  await deps.audit({
    action: "retention_enforcement_executed",
    result: enforcementSucceeded ? "success" : "failure",
    actor: options.actor ?? "system",
    requestId: options.requestId ?? null,
    target: `attestation:${verification.attestationHash.slice(0, 16)}`,
    targetType: "retention_enforcement",
    reason: `dryRun=${dryRun} archived=${totalArchived} failed=${totalFailed} purgedExports=${expiredExportArtifactsPurged} verified=${verification.verified}`,
    metadata: {
      dryRun,
      batchSize,
      totalArchived,
      totalFailed,
      expiredExportArtifactsPurged,
      verified: verification.verified,
      attestationHash: verification.attestationHash,
    },
  });

  logger.info("Retention enforcement and verification completed", {
    action: "retentionEnforcement",
    dryRun,
    totalArchived,
    totalFailed,
    expiredExportArtifactsPurged,
    verified: verification.verified,
    attestationHash: verification.attestationHash,
  });

  return {
    dryRun,
    batchSize,
    executedAt: now.toISOString(),
    cleanup,
    expiredExportArtifactsPurged,
    verification,
  };
}

/**
 * Policy overview for operator inspection.
 */
export function describeRetentionEnforcementPolicies(now = new Date()) {
  return {
    checkedAt: now.toISOString(),
    policies: Object.fromEntries(
      Object.entries(RETENTION_POLICIES).map(([key, policy]) => [
        key,
        {
          retentionDays: policy.retentionDays,
          action: policy.action,
          eligibleStatuses: policy.eligibleStatuses,
          cutoff: getRetentionCutoff(key as keyof typeof RETENTION_POLICIES, now)?.toISOString() ?? null,
        },
      ]),
    ),
    verifiableCollections: HOLDABLE_COLLECTIONS,
  };
}

// ─── Default Mongo-Backed Adapter ────────────────────────────────────────────

export function defaultRetentionVerificationDeps(): RetentionVerificationDeps {
  return {
    collections: {
      inboundWebhookEvents: {
        async listArchived(limit) {
          return (await InboundWebhookEvent.find({ archivedAt: { $ne: null } })
            .sort({ archivedAt: -1 })
            .limit(limit)
            .lean()) as unknown as Array<Record<string, unknown>>;
        },
        async countOverdueUnheld(cutoff, heldIds) {
          const heldGuard = heldIds.length > 0 ? { _id: { $nin: heldIds } } : {};
          return InboundWebhookEvent.countDocuments({
            processingStatus: { $in: ["processed", "skipped"] },
            createdAt: { $lt: cutoff },
            retentionHold: { $ne: true },
            archivedAt: null,
            ...heldGuard,
          });
        },
        async repairScrub(recordIds, now) {
          const res = await InboundWebhookEvent.updateMany(
            { _id: { $in: recordIds }, retentionHold: { $ne: true }, archivedAt: { $ne: null } },
            { $set: { archivedAt: now, rawBody: "", rawHeaders: {}, errorMessage: null } },
          );
          return res.modifiedCount;
        },
      },
      quarantinedEvents: {
        async listArchived(limit) {
          return (await QuarantinedEvent.find({ archivedAt: { $ne: null } })
            .sort({ archivedAt: -1 })
            .limit(limit)
            .lean()) as unknown as Array<Record<string, unknown>>;
        },
        async countOverdueUnheld(cutoff, heldIds) {
          const heldGuard = heldIds.length > 0 ? { _id: { $nin: heldIds } } : {};
          return QuarantinedEvent.countDocuments({
            status: { $in: ["replayed", "discarded"] },
            updatedAt: { $lt: cutoff },
            retentionHold: { $ne: true },
            archivedAt: null,
            ...heldGuard,
          });
        },
        async repairScrub(recordIds, now) {
          const res = await QuarantinedEvent.updateMany(
            { _id: { $in: recordIds }, retentionHold: { $ne: true }, archivedAt: { $ne: null } },
            {
              $set: { archivedAt: now },
              $unset: { rawTopic: "", rawValue: "", rawXdr: "", errorDetails: "" },
            },
          );
          return res.modifiedCount;
        },
      },
      exports: {
        async listArchived(limit) {
          return (await JobRecord.find({ type: "export_csv", archivedAt: { $ne: null } })
            .sort({ archivedAt: -1 })
            .limit(limit)
            .lean()) as unknown as Array<Record<string, unknown>>;
        },
        async countOverdueUnheld(cutoff, heldIds) {
          const heldGuard = heldIds.length > 0 ? { _id: { $nin: heldIds } } : {};
          return JobRecord.countDocuments({
            type: "export_csv",
            status: { $in: ["completed", "failed", "dead_letter"] },
            $or: [{ completedAt: { $lt: cutoff } }, { completedAt: null, updatedAt: { $lt: cutoff } }],
            retentionHold: { $ne: true },
            archivedAt: null,
            ...heldGuard,
          });
        },
        async repairScrub(recordIds, now) {
          const res = await JobRecord.updateMany(
            { _id: { $in: recordIds }, type: "export_csv", retentionHold: { $ne: true }, archivedAt: { $ne: null } },
            {
              $set: {
                archivedAt: now,
                payload: { version: 1, archived: true },
                lastError: null,
                attemptHistory: [],
              },
            },
          );
          return res.modifiedCount;
        },
      },
      supportEvidence: {
        async listArchived(limit) {
          return (await Report.find({ archivedAt: { $ne: null } })
            .sort({ archivedAt: -1 })
            .limit(limit)
            .lean()) as unknown as Array<Record<string, unknown>>;
        },
        async countOverdueUnheld(cutoff, heldIds) {
          const heldGuard = heldIds.length > 0 ? { _id: { $nin: heldIds } } : {};
          return Report.countDocuments({
            status: { $in: ["resolved", "dismissed"] },
            $or: [{ resolvedAt: { $lt: cutoff } }, { resolvedAt: null, updatedAt: { $lt: cutoff } }],
            retentionHold: { $ne: true },
            archivedAt: null,
            ...heldGuard,
          });
        },
        async repairScrub(recordIds, now) {
          const res = await Report.updateMany(
            { _id: { $in: recordIds }, retentionHold: { $ne: true }, archivedAt: { $ne: null } },
            {
              $set: {
                archivedAt: now,
                reporterAddress: "[REDACTED]",
                description: "",
                adminNotes: "",
                evidence: [],
              },
            },
          );
          return res.modifiedCount;
        },
      },
    },
    getHeldIds: () => getActiveHeldRecordIds(),
    runCleanup: (opts) => runRetentionCleanup(opts),
    async purgeExpiredExportArtifacts(now) {
      const res = await ExportRecord.deleteMany({
        expiresAt: { $lt: now },
        status: { $in: ["completed", "failed", "cancelled", "expired"] },
      });
      return res.deletedCount;
    },
    async countExpiredExportArtifacts(now) {
      return ExportRecord.countDocuments({
        expiresAt: { $lt: now },
        status: { $in: ["completed", "failed", "cancelled", "expired"] },
      });
    },
    audit: (params) => recordAuditEvent(params),
    now: () => new Date(),
  };
}
