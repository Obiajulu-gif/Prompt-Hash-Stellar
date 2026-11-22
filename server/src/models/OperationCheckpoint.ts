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

export type OrphanRepairAction =
  | "RESUME_FROM_CHECKPOINT"
  | "RETRY_STEP"
  | "SKIP_TO_NEXT"
  | "MARK_ABANDONED"
  | "AWAIT_MANUAL_REVIEW"
  | "NONE";

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
  repairLeaseOwner?: string;
  repairLeaseExpiresAt?: Date;
  lastRepairAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const STEP_STATES: OperationStepState[] = [
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
];

const checkpointStepSchema = new Schema({
  stepName: { type: String, required: true },
  state: {
    type: String,
    enum: STEP_STATES,
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
      enum: STEP_STATES,
      default: "PENDING",
      index: true,
    },
    steps: [checkpointStepSchema],
    payload: { type: Schema.Types.Mixed, default: {} },
    retryCount: { type: Number, default: 0, min: 0 },
    maxRetries: { type: Number, default: 3, min: 0 },
    nextRecoveryAction: { type: String, default: "AWAITING_STEP" },
    lastError: { type: String },
    repairLeaseOwner: { type: String },
    repairLeaseExpiresAt: { type: Date },
    lastRepairAt: { type: Date },
  },
  { timestamps: true }
);

/**
 * Decide the next orphan-repair action for a checkpoint.
 *
 * Rules (pure, deterministic, no I/O):
 * - Terminal states (CONFIRMED, RESOLVED, ABANDONED) need no repair.
 * - MANUALLY_REVIEWED awaits a human decision.
 * - FAILED / RETRYABLE / RECOVERABLE retry while retryCount < maxRetries; otherwise
 *   the operation is marked for manual review.
 * - Anything else resumes from the last checkpoint.
 */
export function decideOrphanRepairAction(
  cp: Pick<
    IOperationCheckpoint,
    "overallState" | "retryCount" | "maxRetries" | "steps"
  >
): OrphanRepairAction {
  switch (cp.overallState) {
    case "CONFIRMED":
    case "RESOLVED":
    case "ABANDONED":
      return "NONE";
    case "MANUALLY_REVIEWED":
      return "AWAIT_MANUAL_REVIEW";
    case "FAILED":
    case "RETRYABLE":
    case "RECOVERABLE":
      if (cp.retryCount >= cp.maxRetries) {
        return "AWAIT_MANUAL_REVIEW";
      }
      return "RETRY_STEP";
    default:
      return "RESUME_FROM_CHECKPOINT";
  }
}

/**
 * Acquire an exclusive, time-bounded repair lease so that concurrent repair
 * workers cannot double-process the same orphaned operation.
 * Returns true if the lease was acquired by `owner`.
 */
export async function acquireRepairLease(
  operationId: string,
  owner: string,
  ttlMs: number,
  now: Date = new Date()
): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const result = await OperationCheckpoint.updateOne(
    {
      operationId,
      $or: [
        { repairLeaseOwner: { $exists: false } },
        { repairLeaseOwner: null },
        { repairLeaseOwner: owner },
        { repairLeaseExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        repairLeaseOwner: owner,
        repairLeaseExpiresAt: expiresAt,
        lastRepairAt: now,
      },
    }
  );
  return result.modifiedCount === 1;
}

/** Release a repair lease only if it is still held by `owner`. */
export async function releaseRepairLease(
  operationId: string,
  owner: string
): Promise<boolean> {
  const result = await OperationCheckpoint.updateOne(
    { operationId, repairLeaseOwner: owner },
    {
      $unset: { repairLeaseOwner: "", repairLeaseExpiresAt: "" },
    }
  );
  return result.modifiedCount === 1;
}

/**
 * Record a checkpoint step so a resumed repair continues from the last
 * successful step rather than restarting the operation. Increments retryCount
 * when the step is a retry.
 */
export async function recordRepairCheckpoint(
  operationId: string,
  owner: string,
  step: ICheckpointStep,
  isRetry: boolean
): Promise<IOperationCheckpoint | null> {
  const update: Record<string, unknown> = {
    $push: { steps: step },
    $set: {
      currentStep: step.stepName,
      overallState: step.state,
      nextRecoveryAction: "AWAITING_STEP",
    },
  };
  if (step.error) {
    (update.$set as Record<string, unknown>).lastError = step.error;
  }
  if (isRetry) {
    update.$inc = { retryCount: 1 };
  }
  return OperationCheckpoint.findOneAndUpdate(
    { operationId, repairLeaseOwner: owner },
    update,
    { new: true }
  );
}

export const OperationCheckpoint =
  (mongoose.models.OperationCheckpoint as mongoose.Model<IOperationCheckpoint>) ||
  mongoose.model<IOperationCheckpoint>(
    "OperationCheckpoint",
    operationCheckpointSchema
  );
