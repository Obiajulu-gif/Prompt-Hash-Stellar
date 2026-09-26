import mongoose, { Schema, Document } from "mongoose";

export type LedgerEntryType = "sale" | "fee" | "refund" | "adjustment" | "payout";

export interface ILedgerEntry extends Document {
  entryType: LedgerEntryType;
  creatorAddress: string;
  promptId?: string;
  amount: number; // In XLM (positive for credits to creator like sales/adjustments, negative for debits like fees/refunds/payouts)
  currency: string;
  stellarTxRef?: string;
  referenceId: string;
  description: string;
  metadata?: Record<string, unknown>;
  reconciled: boolean;
  createdAt: Date;
}

const LedgerEntrySchema: Schema = new Schema(
  {
    entryType: {
      type: String,
      required: true,
      enum: ["sale", "fee", "refund", "adjustment", "payout"],
      index: true,
    },
    creatorAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    promptId: {
      type: String,
      required: false,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "XLM",
      required: true,
    },
    stellarTxRef: {
      type: String,
      required: false,
      index: true,
    },
    referenceId: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    reconciled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Immutable append-only record
  },
);

// Prevent updating entries once created (immutable ledger guarantee)
LedgerEntrySchema.pre("updateOne", function () {
  throw new Error("Ledger entries are append-only and cannot be modified.");
});
LedgerEntrySchema.pre("findOneAndUpdate", function () {
  throw new Error("Ledger entries are append-only and cannot be modified.");
});
LedgerEntrySchema.pre("updateMany", function () {
  throw new Error("Ledger entries are append-only and cannot be modified.");
});

export const LedgerEntry = mongoose.model<ILedgerEntry>("LedgerEntry", LedgerEntrySchema);
