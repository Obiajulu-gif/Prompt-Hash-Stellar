import mongoose, { Document, Schema } from "mongoose";

export type OperationType =
  | "PROMPT_PURCHASE"
  | "PROMPT_PUBLISH"
  | "ESCROW_RELEASE"
  | "PAYOUT_DISTRIBUTION"
  | "NFT_MINT";

export type OperationStepState =
  | "PENDING"
  | "RETRYABLE"
  | "FAILED"
  | "RESOLVED"
  | "MANUALLY_REVIEWED"
  | "INITIALIZED"
  | "PREVALIDATED"
  | "ONCHAIN_SUBMITTED"
  | "CONFIRMED"
  | "RECOVERABLE"
  | "ABANDONED";

export interface ICheckpointStep {
  stepName: string;
  state: OperationStepState;
  timestamp: Date;
  txHash?: string;
  error?: string;
  data?: Record<string, unknown>;
}

export interface IOperationCheckpoint extends Document {
  operationId: string;
  operationType: OperationType;
  userId: string;
  idempotencyKey: string;
  currentStep: string;
  overallState: OperationStepState;
  steps: ICheckpointStep[];
  payload: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  nextRecoveryAction: string;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const checkpointStepSchema = new Schema({
  stepName: { type: String, required: true },
  state: {
    type: String,
    enum: [
      "PENDING",
      "RETRYABLE",
      "FAILED",
      "RESOLVED",
      "MANUALLY_REVIEWED",
      "INITIALIZED",
      "PREVALIDATED",
      "ONCHAIN_SUBMITTED",
      "CONFIRMED",
      "RECOVERABLE",
      "ABANDONED",
    ],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
  txHash: { type: String },
  error: { type: String },
  data: { type: Schema.Types.Mixed },
});

const operationCheckpointSchema = new Schema(
  {
    operationId: { type: String, required: true, unique: true, index: true },
    operationType: {
      type: String,
      enum: [
        "PROMPT_PURCHASE",
        "PROMPT_PUBLISH",
        "ESCROW_RELEASE",
        "PAYOUT_DISTRIBUTION",
        "NFT_MINT",
      ],
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    currentStep: { type: String, required: true },
    overallState: {
      type: String,
      enum: [
        "PENDING",
        "RETRYABLE",
        "FAILED",
        "RESOLVED",
        "MANUALLY_REVIEWED",
        "INITIALIZED",
        "PREVALIDATED",
        "ONCHAIN_SUBMITTED",
        "CONFIRMED",
        "RECOVERABLE",
        "ABANDONED",
      ],
      default: "PENDING",
      index: true,
    },
    steps: [checkpointStepSchema],
    payload: { type: Schema.Types.Mixed, default: {} },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    nextRecoveryAction: { type: String, default: "AWAITING_STEP" },
    lastError: { type: String },
  },
  { timestamps: true }
);

export const OperationCheckpoint =
  mongoose.models.OperationCheckpoint ||
  mongoose.model<IOperationCheckpoint>(
    "OperationCheckpoint",
    operationCheckpointSchema
  );
