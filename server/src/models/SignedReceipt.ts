import mongoose, { Document, Schema } from "mongoose";

export type CriticalOperationType =
  | "PROMPT_PURCHASE"
  | "PROMPT_PUBLISH"
  | "OWNERSHIP_TRANSFER"
  | "DISPUTE_RAISED"
  | "REFUND_SETTLED"
  | "ESCROW_RELEASE";

export interface IExternalReferences {
  promptId?: string;
  txHash?: string;
  ledgerSequence?: number;
  contractId?: string;
  idempotencyKey?: string;
}

export interface ISignedReceipt extends Document {
  receiptId: string;
  operationType: CriticalOperationType;
  actor: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  timestamp: string;
  nonce: string;
  externalReferences: IExternalReferences;
  payload: Record<string, unknown>;
  payloadDigest: string;
  signature: string;
  signatureAlgorithm: "HMAC-SHA256";
  issuedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const signedReceiptSchema = new Schema(
  {
    receiptId: { type: String, required: true, unique: true, index: true },
    operationType: {
      type: String,
      enum: [
        "PROMPT_PURCHASE",
        "PROMPT_PUBLISH",
        "OWNERSHIP_TRANSFER",
        "DISPUTE_RAISED",
        "REFUND_SETTLED",
        "ESCROW_RELEASE",
      ],
      required: true,
      index: true,
    },
    actor: { type: String, required: true, lowercase: true, index: true },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED", "PENDING"],
      required: true,
      index: true,
    },
    timestamp: { type: String, required: true },
    nonce: { type: String, required: true, unique: true },
    externalReferences: {
      promptId: { type: String, index: true },
      txHash: { type: String, index: true },
      ledgerSequence: { type: Number },
      contractId: { type: String },
      idempotencyKey: { type: String, index: true },
    },
    payload: { type: Schema.Types.Mixed, required: true },
    payloadDigest: { type: String, required: true },
    signature: { type: String, required: true },
    signatureAlgorithm: { type: String, default: "HMAC-SHA256" },
    issuedBy: { type: String, default: "prompt-hash-stellar" },
  },
  { timestamps: true }
);

// Compound indexes for user receipt queries
signedReceiptSchema.index({ actor: 1, createdAt: -1 });
signedReceiptSchema.index({ "externalReferences.idempotencyKey": 1 }, { sparse: true });
signedReceiptSchema.index({ "externalReferences.promptId": 1, actor: 1 });

export const SignedReceipt =
  mongoose.models.SignedReceipt ||
  mongoose.model<ISignedReceipt>("SignedReceipt", signedReceiptSchema);
