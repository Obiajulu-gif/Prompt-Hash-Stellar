import mongoose, { Schema, Document } from "mongoose";

/**
 * Critical domain records whose changes affect ownership, money,
 * permissions, or user access (#830).
 */
export const CRITICAL_RECORD_TYPES = [
  "prompt",
  "ownership_transfer",
  "entitlement",
  "api_key",
  "payout_statement",
  "ledger_entry",
] as const;

export type CriticalRecordType = (typeof CRITICAL_RECORD_TYPES)[number];

export const CHANGE_OPERATIONS = [
  "create",
  "update",
  "transfer",
  "revoke",
  "delete",
] as const;

export type ChangeOperation = (typeof CHANGE_OPERATIONS)[number];

export interface IChangeHistoryEntry extends Document {
  recordType: CriticalRecordType;
  recordId: string;
  sequence: number;
  operation: ChangeOperation;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
  changedFields: string[];
  actor: string;
  reason: string;
  metadata?: Record<string, unknown>;
  previousHash: string;
  recordHash: string;
  createdAt: Date;
}

const changeHistoryEntrySchema = new Schema(
  {
    recordType: {
      type: String,
      required: true,
      enum: CRITICAL_RECORD_TYPES,
      index: true,
    },
    recordId: {
      type: String,
      required: true,
      index: true,
    },
    sequence: {
      type: Number,
      required: true,
      min: 1,
    },
    operation: {
      type: String,
      required: true,
      enum: CHANGE_OPERATIONS,
    },
    beforeState: {
      type: Schema.Types.Mixed,
      default: null,
    },
    afterState: {
      type: Schema.Types.Mixed,
      required: true,
    },
    changedFields: {
      type: [String],
      default: [],
    },
    actor: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    previousHash: {
      type: String,
      required: true,
    },
    recordHash: {
      type: String,
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: false, // Explicit createdAt to match cryptographic hash
  },
);

// Ensure strict uniqueness per (recordType, recordId, sequence)
changeHistoryEntrySchema.index(
  { recordType: 1, recordId: 1, sequence: 1 },
  { unique: true },
);

// Optimize sequential history lookups and actor audit trails
changeHistoryEntrySchema.index({ recordType: 1, recordId: 1, createdAt: 1 });
changeHistoryEntrySchema.index({ actor: 1, createdAt: -1 });

// Guarantee append-only immutability
const rejectMutation = function () {
  throw new Error("Change history records are immutable and append-only.");
};

changeHistoryEntrySchema.pre("updateOne", rejectMutation);
changeHistoryEntrySchema.pre("findOneAndUpdate", rejectMutation);
changeHistoryEntrySchema.pre("updateMany", rejectMutation);
changeHistoryEntrySchema.pre("deleteOne", rejectMutation);
changeHistoryEntrySchema.pre("findOneAndDelete", rejectMutation);
changeHistoryEntrySchema.pre("deleteMany", rejectMutation);

export const ChangeHistoryEntry =
  mongoose.models.ChangeHistoryEntry ||
  mongoose.model<IChangeHistoryEntry>(
    "ChangeHistoryEntry",
    changeHistoryEntrySchema,
  );

export default ChangeHistoryEntry;
