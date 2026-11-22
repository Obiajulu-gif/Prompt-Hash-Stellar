import mongoose, { Document, Schema } from "mongoose";

/**
 * Retention hold ledger — one document per dispute / investigation / legal
 * matter, linking the specific records that cleanup jobs must not archive.
 *
 * Several holds may cover the same record; the record is only released to
 * normal retention once the last active hold covering it is released.
 */

export const HOLD_CASE_TYPES = ["dispute", "investigation", "legal"] as const;
export type HoldCaseType = (typeof HOLD_CASE_TYPES)[number];

/**
 * Collections that retention cleanup can archive, keyed by the same names the
 * cleanup result uses. Anything else (AuditLog, LedgerEntry, Purchase, ...) is
 * never archived, so it needs no hold.
 */
export const HOLDABLE_COLLECTIONS = [
  "inboundWebhookEvents",
  "quarantinedEvents",
  "exports",
  "supportEvidence",
] as const;
export type HoldableCollection = (typeof HOLDABLE_COLLECTIONS)[number];

export interface RetentionHoldLink {
  collection: HoldableCollection;
  recordId: string;
}

/**
 * Persisted shape of a link. The field is `store`, not `collection`:
 * `collection` is a reserved Mongoose path name. The service maps it back to
 * `RetentionHoldLink.collection` at the persistence boundary.
 */
export interface StoredRetentionHoldLink {
  store: HoldableCollection;
  recordId: string;
}

export interface IRetentionHold extends Document {
  caseType: HoldCaseType;
  caseRef: string;
  reason: string;
  status: "active" | "released";
  links: StoredRetentionHoldLink[];
  alreadyArchived: string[];
  createdBy: string;
  reviewBy: Date;
  releasedBy: string | null;
  releasedAt: Date | null;
  releaseReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const linkSchema = new Schema(
  {
    store: { type: String, enum: HOLDABLE_COLLECTIONS, required: true },
    recordId: { type: String, required: true },
  },
  { _id: false },
);

const retentionHoldSchema = new Schema<IRetentionHold>(
  {
    caseType: { type: String, enum: HOLD_CASE_TYPES, required: true, index: true },
    caseRef: { type: String, required: true, index: true },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ["active", "released"], default: "active", index: true },
    links: { type: [linkSchema], default: [] },
    alreadyArchived: { type: [String], default: [] },
    createdBy: { type: String, required: true },
    reviewBy: { type: Date, required: true, index: true },
    releasedBy: { type: String, default: null },
    releasedAt: { type: Date, default: null },
    releaseReason: { type: String, default: null },
  },
  { timestamps: true },
);

retentionHoldSchema.index({ status: 1, "links.store": 1 });
retentionHoldSchema.index({ caseType: 1, caseRef: 1, status: 1 });

/**
 * Deletion verification + retention enforcement helpers.
 *
 * These are pure functions over the persisted shape so they can be used by
 * cleanup jobs and covered by unit tests without a database. They do not mutate
 * the input documents.
 */

export interface HoldCoverage {
  collection: HoldableCollection;
  recordId: string;
}

export interface DeletionVerificationResult {
  /** True when every requested record is covered by at least one active hold. */
  allowed: boolean;
  /** Records that are blocked by an active hold. */
  blocked: HoldCoverage[];
  /** Records that have no active hold and may be deleted/archived. */
  allowed2ecords: HoldCoverage[];
  /** Hold document ids that contributed to a block. */
  blockingHoldIds: string[];
}

export interface DeletionVerificationOptions {
  /** When true, already-archived links do not block deletion. Defaults to false. */
  ignoreAlreadyArchived?: boolean;
}

function coverageKey(coverage: HoldCoverage): string {
  return `${coverage.collection}:${coverage.recordId}`;
}

function isActiveHold(hold: IRetentionHold): boolean {
  return hold.status === "active";
}

function isAlreadyArchived(hold: IRetentionHold, key: string): boolean {
  return Array.isArray(	hold.alreadyArchived) && hold.alreadyArchived.includes(key);
}

/**
 * Returns the subset of corresponding holds that are currently active and
 * cover the given collection/recordId. Holds that were released are ignored,
 * as are links marked already archived when the caller opts in.
 */
export function findActiveHolds(
  holds: IRetentionHold[],
  collection: HoldableCollection,
  recordId: string,
  options: DeletionVerificationOptions = {},
): IRetentionHold[] {
  const key = coverageKey({ collection, recordId });
  return holds.filter((hold) => {
    if (!isActiveHold(hold)) return false;
    const covers = (hold.links || []).some(
      (link) => link.store === collection && link.recordId === recordId,
    );
    if (!covers) return false;
    if (options.ignoreAlreadyArchived && isAlreadyArchived(hold, key)) {
      return false;
    }
    return true;
  });
}

/**
 * Verifies that a deletion/archive request is permitted by retention holds.
 *
 * A deletion is allowed only when every requested record has no active hold.
 * The result is deterministic and includes the blocking hold ids so the caller
 * can record an audit trail or return a 409/423 response.
 */
export function verifyDeletionAllowed(
  holds: IRetentionHold[],
  records: HoldCoverage[],
  options: DeletionVerificationOptions = {},
): DeletionVerificationResult {
  const blocked: HoldCoverage[] = [];
  const allowed2ecords: HoldCoverage[] = [];
  const blockingHoldIds = new Set<string>();

  for (const record of records) {
    const covering = findActiveHolds(holds, record.collection, record.recordId, options);
    if (covering.length > 0) {
      blocked.push({ collection: record.collection, recordId: record.recordId });
      for (const hold of covering) {
        blockingHoldIds.add(String(hold._id));
      }
    } else {
      allowed2ecords.push({ collection: record.collection, recordId: record.recordId });
    }
  }

  return {
    allowed: blocked.length === 0,
    blocked,
    allowed2ecords,
    blockingHoldIds: Array.from(blockingHoldIds),
  };
}

/**
 * Marks a link as already archived on the hold and returns a new hold object.
 * This is idempotent: repeated calls do not duplicate the key. The caller is responsible
 * for persisting the returned document (or applying the same $addToSet update).
 */
export function markLinkArchived(
  hold: IRetentionHold,
  collection: HoldableCollection,
  recordId: string,
): IRetentionHold {
  const key = coverageKey({ collection, recordId });
  const existing = Array.isArray(	hold.alreadyArchived) ? hold.alreadyArchived : [];
  if (existing.includes(key)) return hold;
  return {
    ...hold,
    alreadyArchived: [...existing, key],
  } as IRetentionHold;
}

/**
 * Releases a hold. Returns a new hold object with status "released" and the
 * release metadata populated. Releasing an already-released hold is a no-op that
 * returns the input document unchanged, preserving the original release audit trail.
 */
export function releaseHold(
  hold: IRetentionHold,
  releasedBy: string,
  releaseReason: string,
  releasedAt: Date = new Date(),
): IRetentionHold {
  if (hold.status === "released") return hold;
  return {
    ...hold,
    status: "released",
    releasedBy,
    releaseReason,
    releasedAt,
  } as IRetentionHold;
}

/**
 * Returns true when the hold's review date has passed and it is still active.
 * Used by cleanup jobs to surface holds that need review before release.
 */
export function isHoldOverdue(hold: IRetentionHold, now: Date = new Date()): boolean {
  return isActiveHold(hold) && hold.reviewBy instanceof Date && hold.reviewBy.getTime() < now.getTime();
}

const RetentionHold =
  (mongoose.models.RetentionHold as mongoose.Model<IRetentionHold>) ||
  mongoose.model<IRetentionHold>("RetentionHold", retentionHoldSchema);
export default RetentionHold;
