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

const RetentionHold =
  (mongoose.models.RetentionHold as mongoose.Model<IRetentionHold>) ||
  mongoose.model<IRetentionHold>("RetentionHold", retentionHoldSchema);
export default RetentionHold;
