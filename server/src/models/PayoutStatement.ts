import mongoose from "mongoose";

/**
 * Payout statement schema (#716).
 *
 * A payout statement reconciles a creator's purchase, fee, refund, and
 * settlement events into balanced statement lines. Statements always satisfy:
 *
 *   grossAmount - platformFee - refunds === netSettlement
 *
 * where `platformFee` is the net platform fee after refund fee credits and
 * `netSettlement` is the sum of per-line `creatorAmount` values.
 */
export const STATEMENT_LINE_KIND = ["sale", "refund"] as const;
export const SETTLEMENT_STATUS = ["settled", "pending", "failed"] as const;

export type StatementLineKind = (typeof STATEMENT_LINE_KIND)[number];
export type SettlementStatus = (typeof SETTLEMENT_STATUS)[number];

const statementLineSchema = new mongoose.Schema(
  {
    purchaseId: { type: String, required: true },
    kind: { type: String, enum: STATEMENT_LINE_KIND, required: true },
    saleDate: { type: Date, required: true },
    promptTitle: { type: String, default: "Prompt" },
    promptId: { type: String, required: true },
    buyerAddress: { type: String, required: true, lowercase: true },
    grossAmount: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    creatorAmount: { type: Number, required: true },
    txHash: { type: String, default: "" },
    settlementStatus: { type: String, enum: SETTLEMENT_STATUS, required: true },
  },
  { _id: false },
);

const statementSummarySchema = new mongoose.Schema(
  {
    grossAmount: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    refunds: { type: Number, required: true },
    netSettlement: { type: Number, required: true },
    settlementStatus: { type: String, enum: SETTLEMENT_STATUS, required: true },
  },
  { _id: false },
);

const payoutStatementSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    status: { type: String, enum: SETTLEMENT_STATUS, default: "settled" },
    balanced: { type: Boolean, default: true },
    summary: { type: statementSummarySchema, required: true },
    lines: { type: [statementLineSchema], default: [] },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

payoutStatementSchema.index({ walletAddress: 1, periodStart: 1, periodEnd: 1 });

const PayoutStatement =
  mongoose.models.PayoutStatement ||
  mongoose.model("PayoutStatement", payoutStatementSchema);

export default PayoutStatement;