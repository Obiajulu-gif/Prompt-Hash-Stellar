import {
  OperationCheckpoint,
  IOperationCheckpoint,
  OperationType,
  OperationStepState,
  ICheckpointStep,
} from "../models/OperationCheckpoint";
import { recordAccessOrOwnershipChange } from "./auditTrail";
import { logger } from "./structuredLogger";

export type CanonicalRecoveryState =
  | "PENDING"
  | "RETRYABLE"
  | "FAILED"
  | "RESOLVED"
  | "MANUALLY_REVIEWED";

export interface InitiateOperationParams {
  operationType: OperationType;
  userId: string;
  idempotencyKey: string;
  initialStep: string;
  payload?: Record<string, unknown>;
  maxRetries?: number;
}

export interface RecoveryPlan {
  operationId: string;
  canResume: boolean;
  resumeStep: string;
  canonicalState: CanonicalRecoveryState;
  recommendedAction: "RETRY" | "ROLLBACK" | "MANUAL_REVIEW";
  instructions: string;
}

export interface StuckOperationDiagnostic {
  operationId: string;
  operationType: OperationType;
  userId: string;
  currentStep: string;
  overallState: OperationStepState;
  canonicalState: CanonicalRecoveryState;
  minutesStale: number;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  recommendedAction: "RETRY" | "ROLLBACK" | "MANUAL_REVIEW";
  hasOnchainBroadcast: boolean;
  onchainTxHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CancelOperationResult {
  checkpoint: IOperationCheckpoint;
  /** True when the operation was already cancelled (idempotent no-op). */
  alreadyCancelled: boolean;
  /** True when an on-chain transaction was broadcast, so cancellation only halts local work. */
  onchainBroadcastPresent: boolean;
  /** Recommended follow-up for operators/users. */
  recoveryGuidance: string;
}

export const DEFAULT_STUCK_THRESHOLD_MINUTES = 15;

/** Overall states from which an operation may be cancelled. */
const CANCELLABLE_STATES: ReadonlySet<OperationStepState> = new Set<OperationStepState>([
  "PENDING",
  "INITIALIZED",
  "PREVALIDATED",
  "RETRYABLE",
  "RECOVERABLE",
  "MANUALLY_REVIEWED",
]);

/** Overall states that are terminal and must never transition again via cancellation. */
const TERMINAL_STATES: ReadonlySet<OperationStepState> = new Set<OperationStepState>([
  "RESOLVED",
  "CONFIRMED",
  "FAILED",
  "ABANDONED",
]);

export class OperationRecoveryService {
  /**
   * Normalizes internal step/checkpoint states to the 5 canonical recovery states.
   */
  static normalizeState(state: OperationStepState): CanonicalRecoveryState {
    switch (state) {
      case "RESOLVED":
      case "CONFIRMED":
        return "RESOLVED";
      case "RETRYABLE":
      case "RECOVERABLE":
        return "RETRYABLE";
      case "FAILED":
      case "ABANDONED":
        return "FAILED";
      case "MANUALLY_REVIEWED":
        return "MANUALLY_REVIEWED";
      case "PENDING":
      case "INITIALIZED":
      case "PREVALIDATED":
      case "ONCHAIN_SUBMITTED":
      default:
        return "PENDING";
    }
  }

  /**
   * Initializes or fetches an existing idempotent operation.
   */
  static async initiateOperation(
    params: InitiateOperationParams
  ): Promise<{ checkpoint: IOperationCheckpoint; isNew: boolean }> {
    const existing = await OperationCheckpoint.findOne({
      idempotencyKey: params.idempotencyKey,
    });

    if (existing) {
      return { checkpoint: existing, isNew: false };
    }

    const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const checkpoint = await OperationCheckpoint.create({
      operationId,
      operationType: params.operationType,
      userId: params.userId.toLowerCase(),
      idempotencyKey: params.idempotencyKey,
      currentStep: params.initialStep,
      overallState: "PENDING",
      steps: [
        {
          stepName: params.initialStep,
          state: "PENDING",
          timestamp: new Date(),
          data: params.payload,
        },
      ],
      payload: params.payload || {},
      maxRetries: params.maxRetries ?? 3,
      nextRecoveryAction: `PROCEED_${params.initialStep.toUpperCase()}`,
    });

    return { checkpoint, isNew: true };
  }

  /**
   * Records execution of a step checkpoint.
   */
  static async recordStep(
    operationId: string,
    stepName: string,
    state: OperationStepState,
    options?: {
      txHash?: string;
      error?: string;
      data?: Record<string, unknown>;
    }
  ): Promise<IOperationCheckpoint> {
    const checkpoint = await OperationCheckpoint.findOne({ operationId });
    if (!checkpoint) {
      throw new Error(`Operation checkpoint not found: ${operationId}`);
    }

    // A cancelled operation must not be advanced by late-arriving workers.
    if (checkpoint.overallState === "CANCELLED" && state !== "CANCELLED") {
      throw new Error(
        `Operation ${operationId} is cancelled; refusing to record step ${stepName} as ${state}.`
      );
    }

    checkpoint.currentStep = stepName;
    checkpoint.overallState = state;
    if (options?.error) {
      checkpoint.lastError = options.error;
    }

    checkpoint.steps.push({
      stepName,
      state,
      timestamp: new Date(),
      txHash: options?.txHash,
      error: options?.error,
      data: options?.data,
    });

    const canonical = this.normalizeState(state);
    if (canonical === "RESOLVED") {
      checkpoint.nextRecoveryAction = "COMPLETED";
    } else if (canonical === "RETRYABLE") {
      checkpoint.nextRecoveryAction = `RETRY_${stepName.toUpperCase()}`;
    } else if (canonical === "FAILED") {
      checkpoint.nextRecoveryAction = "TERMINATED";
    } else if (state === "CANCELLED") {
      checkpoint.nextRecoveryAction = "CANCELLED";
    }

    await checkpoint.save();
    return checkpoint;
  }

  /**
   * Cancels a long-running operation and performs local cleanup.
   *
   * Authorization: only the initiating user may cancel their own operation.
   *
   * Semantics:
   * - Idempotent: cancelling an already-cancelled operation returns it unchanged.
   * - Terminal operations (RESOLVED/CONFIRMED/FAILED/ABANDONED) cannot be cancelled.
   * - If an on-chain transaction was already broadcast (any step with a txHash or
   *   ONCHAIN_SUBMITTED state), cancellation cannot reverse it. The checkpoint is
   *   still moved to CANCELLED to halt further local side effects, and the result
   *   flags `onchainBroadcastPresent` so callers verify on-chain status.
   * - Cleanup clears transient retry bookkeeping (`nextRecoveryAction`) so no
   *   automated retry can resume the operation.
   * - The cancellation is audited on success.
   */
  static async cancelOperation(
    operationId: string,
    actorWallet: string,
    reason?: string
  ): Promise<CancelOperationResult> {
    const checkpoint = await OperationCheckpoint.findOne({ operationId });
    if (!checkpoint) {
      throw new Error(`Operation not found: ${operationId}`);
    }

    if (checkpoint.userId.toLowerCase() !== actorWallet.toLowerCase()) {
      throw new Error("Unauthorized: Only the initiator of this operation can cancel it.");
    }

    const onchainBroadcastPresent = checkpoint.steps.some(
      (s: ICheckpointStep) => s.state === "ONCHAIN_SUBMITTED" || !!s.txHash
    );

    if (checkpoint.overallState === "CANCELLED") {
      return {
        checkpoint,
        alreadyCancelled: true,
        onchainBroadcastPresent,
        recoveryGuidance: onchainBroadcastPresent
          ? "Operation was already cancelled. A transaction was broadcast; verify its on-chain status."
          : "Operation was already cancelled. No further action required.",
      };
    }

    if (TERMINAL_STATES.has(checkpoint.overallState)) {
      throw new Error(
        `Cannot cancel operation in terminal state ${checkpoint.overallState}.`
      );
    }

    if (!CANCELLABLE_STATES.has(checkpoint.overallState)) {
      throw new Error(
        `Cannot cancel operation in state ${checkpoint.overallState}.`
      );
    }

    const priorState = checkpoint.overallState;
    const priorStep = checkpoint.currentStep;

    checkpoint.overallState = "CANCELLED";
    checkpoint.nextRecoveryAction = "CANCELLED";
    checkpoint.lastError = reason
      ? `Cancelled by user: ${reason}`
      : "Cancelled by user";

    checkpoint.steps.push({
      stepName: `USER_CANCEL_${priorStep}`,
      state: "CANCELLED",
      timestamp: new Date(),
      data: { reason: reason ?? null, priorState, onchainBroadcastPresent },
    });

    await checkpoint.save();

    const recoveryGuidance = onchainBroadcastPresent
      ? "A transaction was already broadcast before cancellation; cancellation only halted local processing. Verify the transaction's on-chain status before taking any further action."
      : "No on-chain side effects were recorded; the operation was fully cancelled and may be re-initiated with a new idempotency key.";

    try {
      await recordAccessOrOwnershipChange({
        action: "operation_recovery",
        result: "success",
        actor: actorWallet.toLowerCase(),
        target: operationId,
        targetType: "system",
        beforeState: { priorState, priorStep },
        afterState: { newState: "CANCELLED", onchainBroadcastPresent },
        reason: reason ?? "User cancellation",
      });
    } catch (err) {
      logger.warn("Could not audit user operation cancellation", { error: err });
    }

    return {
      checkpoint,
      alreadyCancelled: false,
      onchainBroadcastPresent,
      recoveryGuidance,
    };
  }

  /**
   * Evaluates an operation and produces a deterministic recovery plan.
   */
  static async evaluateRecovery(operationId: string): Promise<RecoveryPlan> {
    const checkpoint = await OperationCheckpoint.findOne({ operationId });
    if (!checkpoint) {
      throw new Error(`Operation not found: ${operationId}`);
    }

    if (checkpoint.overallState === "CANCELLED") {
      return {
        operationId,
        canResume: false,
        resumeStep: checkpoint.currentStep,
        canonicalState: "FAILED",
        recommendedAction: "MANUAL_REVIEW",
        instructions: "Operation was cancelled by the user and cannot be resumed.",
      };
    }

    const canonicalState = this.normalizeState(checkpoint.overallState);

    const hasOnchainSubmission = checkpoint.steps.some(
      (s: ICheckpointStep) => s.state === "ONCHAIN_SUBMITTED" || !!s.txHash
    );

    if (canonicalState === "RESOLVED") {
      return {
        operationId,
        canResume: false,
        resumeStep: checkpoint.currentStep,
        canonicalState,
        recommendedAction: "MANUAL_REVIEW",
        instructions: "Operation has already been confirmed and resolved.",
      };
    }

    if (canonicalState === "FAILED") {
      return {
        operationId,
        canResume: false,
        resumeStep: checkpoint.currentStep,
        canonicalState,
        recommendedAction: "MANUAL_REVIEW",
        instructions: `Operation marked as failed: ${checkpoint.lastError || "Unknown error"}. Manual review required.`,
      };
    }

    if (checkpoint.retryCount >= checkpoint.maxRetries) {
      return {
        operationId,
        canResume: false,
        resumeStep: checkpoint.currentStep,
        canonicalState: "MANUALLY_REVIEWED",
        recommendedAction: "MANUAL_REVIEW",
        instructions: "Max retry limit reached. Maintainer diagnostic review required.",
      };
    }

    if (hasOnchainSubmission) {
      const onchainStep = checkpoint.steps.find((s: ICheckpointStep) => s.state === "ONCHAIN_SUBMITTED" || !!s.txHash);
      return {
        operationId,
        canResume: true,
        resumeStep: "VERIFY_ONCHAIN_STATUS",
        canonicalState: "RETRYABLE",
        recommendedAction: "RETRY",
        instructions: `Transaction broadcasted with txHash: ${onchainStep?.txHash || "unknown"}. Verify status on-chain before retrying side effects.`,
      };
    }

    return {
      operationId,
      canResume: true,
      resumeStep: checkpoint.currentStep,
      canonicalState: "RETRYABLE",
      recommendedAction: "RETRY",
      instructions: "Operation is eligible for retry from the current step.",
    };
  }
}
