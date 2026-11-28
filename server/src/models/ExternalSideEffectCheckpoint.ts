import mongoose, { Document, Schema } from "mongoose";

/**
 * Durable checkpoint for a single external side effect (issue #1175).
 *
 * Every row is one logical effect, identified by `(operationId, effectKey)`.
 * The row is written before the effect leaves the process, so a retry can
 * tell the difference between "never dispatched" and "dispatched, outcome
 * unknown" instead of guessing. Payload content is never stored: only a
 * canonical request hash and a deterministic external reference.
 */
export type ExternalSideEffectState =
  | "IN_PROGRESS"
  | "COMMITTED"
  | "FAILED"
  | "AMBIGUOUS"
  | "ROLLED_BACK"
  | "DENIED";

export type SideEffectOperationType =
  | "PROMPT_PURCHASE"
  | "PROMPT_PUBLISH"
  | "ESCROW_RELEASE"
  | "PAYOUT_DISTRIBUTION"
  | "NFT_MINT"
  | "WEBHOOK_DELIVERY"
  | "EXPORT";

export type CheckpointTransition = {
  state: ExternalSideEffectState;
  at: Date;
  note?: string;
};

export interface IExternalSideEffectCheckpoint extends Document {
  operationType: SideEffectOperationType;
  operationId: string;
  effectKey: string;
  actorId: string;
  externalReference: string;
  requestHash: string;
  state: ExternalSideEffectState;
  /** UUID of the attempt allowed to finalize the current dispatch. */
  attemptToken: string | null;
  attemptCount: number;
  maxAttempts: number;
  leasedUntil: Date | null;
  lastError?: string;
  resultSummary?: Record<string, unknown>;
  txHash?: string;
  reconciledBy?: string;
  reconciledAt?: Date;
  reconciliationReason?: string;
  rolledBackAt?: Date;
  rollbackError?: string;
  history: CheckpointTransition[];
  createdAt: Date;
  updatedAt: Date;
}

const transitionSchema = new Schema<CheckpointTransition>(
  {
    state: {
      type: String,
      enum: ["IN_PROGRESS", "COMMITTED", "FAILED", "AMBIGUOUS", "ROLLED_BACK", "DENIED"],
      required: true,
    },
    at: { type: Date, default: Date.now, required: true },
    note: { type: String },
  },
  { _id: false },
);

const externalSideEffectCheckpointSchema = new Schema(
  {
    operationType: {
      type: String,
      enum: [
        "PROMPT_PURCHASE",
        "PROMPT_PUBLISH",
        "ESCROW_RELEASE",
        "PAYOUT_DISTRIBUTION",
        "NFT_MINT",
        "WEBHOOK_DELIVERY",
        "EXPORT",
      ],
      required: true,
      index: true,
    },
    operationId: { type: String, required: true, index: true },
    effectKey: { type: String, required: true },
    actorId: { type: String, required: true, index: true },
    externalReference: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: {
      type: String,
      enum: ["IN_PROGRESS", "COMMITTED", "FAILED", "AMBIGUOUS", "ROLLED_BACK", "DENIED"],
      required: true,
      index: true,
    },
    attemptToken: { type: String, default: null },
    attemptCount: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1 },
    leasedUntil: { type: Date, default: null },
    lastError: { type: String },
    resultSummary: { type: Schema.Types.Mixed },
    txHash: { type: String },
    reconciledBy: { type: String },
    reconciledAt: { type: Date },
    reconciliationReason: { type: String },
    rolledBackAt: { type: Date },
    rollbackError: { type: String },
    history: { type: [transitionSchema], default: [] },
  },
  { timestamps: true },
);

// One durable checkpoint per logical external effect. This is the gate that
// makes "at most one successful dispatch per effect key" enforceable.
externalSideEffectCheckpointSchema.index(
  { operationId: 1, effectKey: 1 },
  { unique: true },
);
externalSideEffectCheckpointSchema.index({ state: 1, updatedAt: 1 });
externalSideEffectCheckpointSchema.index({ externalReference: 1 }, { unique: true });

const ExternalSideEffectCheckpoint =
  mongoose.models.ExternalSideEffectCheckpoint ||
  mongoose.model<IExternalSideEffectCheckpoint>(
    "ExternalSideEffectCheckpoint",
    externalSideEffectCheckpointSchema,
  );

export default ExternalSideEffectCheckpoint;
