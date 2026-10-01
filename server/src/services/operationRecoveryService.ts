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

export const DEFAULT_STUCK_THRESHOLD_MINUTES = 15;

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
    }

    await checkpoint.save();
    return checkpoint;
  }

  /**
   * Evaluates an operation and produces a deterministic recovery plan.
   */
  static async evaluateRecovery(operationId: string): Promise<RecoveryPlan> {
    const checkpoint = await OperationCheckpoint.findOne({ operationId });
    if (!checkpoint) {
      throw new Error(`Operation not found: ${operationId}`);
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
      instructions: `Safe to re-execute step ${checkpoint.currentStep}; no external on-chain side effects were recorded.`,
    };
  }

  /**
   * User-triggered deterministic retry for a stuck or retryable operation.
   */
  static async userRetry(operationId: string, userWallet: string): Promise<IOperationCheckpoint> {
    const checkpoint = await OperationCheckpoint.findOne({ operationId });
    if (!checkpoint) {
      throw new Error(`Operation not found: ${operationId}`);
    }

    if (checkpoint.userId.toLowerCase() !== userWallet.toLowerCase()) {
      throw new Error("Unauthorized: Only the initiator of this operation can retry it.");
    }

    const plan = await this.evaluateRecovery(operationId);

    if (!plan.canResume) {
      if (checkpoint.retryCount >= checkpoint.maxRetries) {
        checkpoint.overallState = "MANUALLY_REVIEWED";
        await checkpoint.save();
      }
      throw new Error(`Cannot resume operation: ${plan.instructions}`);
    }

    const priorState = checkpoint.overallState;
    checkpoint.retryCount += 1;
    checkpoint.overallState = "RETRYABLE";
    checkpoint.nextRecoveryAction = `RESUMING_${plan.resumeStep}`;

    checkpoint.steps.push({
      stepName: `USER_RETRY_${checkpoint.retryCount}`,
      state: "RETRYABLE",
      timestamp: new Date(),
      data: { plan, resumeStep: plan.resumeStep },
    });

    await checkpoint.save();

    // Audit recovery action
    try {
      await recordAccessOrOwnershipChange({
        action: "operation_recovery",
        result: "success",
        actor: userWallet.toLowerCase(),
        target: operationId,
        targetType: "system",
        beforeState: { priorState, retryCount: checkpoint.retryCount - 1 },
        afterState: { newState: "RETRYABLE", retryCount: checkpoint.retryCount, resumeStep: plan.resumeStep },
        reason: "User retry initiated",
      });
    } catch (err) {
      logger.warn("Could not audit user operation recovery", { error: err });
    }

    return checkpoint;
  }

  /**
   * Maintainer-triggered resolution or manual intervention for stuck operations.
   */
  static async maintainerResolve(
    operationId: string,
    action: "RESOLVE" | "FAIL" | "RETRY" | "MANUAL_REVIEW",
    maintainerId: string,
    reason: string
  ): Promise<IOperationCheckpoint> {
    if (!reason || reason.trim().length === 0) {
      throw new Error("A justification reason is required for maintainer recovery actions.");
    }

    const checkpoint = await OperationCheckpoint.findOne({ operationId });
    if (!checkpoint) {
      throw new Error(`Operation not found: ${operationId}`);
    }

    const priorState = checkpoint.overallState;
    const targetStateMap: Record<string, OperationStepState> = {
      RESOLVE: "RESOLVED",
      FAIL: "FAILED",
      RETRY: "RETRYABLE",
      MANUAL_REVIEW: "MANUALLY_REVIEWED",
    };

    const newState = targetStateMap[action];
    checkpoint.overallState = newState;
    checkpoint.nextRecoveryAction = `MAINTAINER_${action}`;

    checkpoint.steps.push({
      stepName: `MAINTAINER_ACTION_${action}`,
      state: newState,
      timestamp: new Date(),
      data: { maintainerId, reason, priorStep: checkpoint.currentStep },
    });

    await checkpoint.save();

    // Audit maintainer recovery action
    try {
      await recordAccessOrOwnershipChange({
        action: "operation_recovery",
        result: "success",
        actor: maintainerId,
        target: operationId,
        targetType: "system",
        beforeState: { priorState, action },
        afterState: { newState, maintainerId },
        reason,
      });
    } catch (err) {
      logger.warn("Could not audit maintainer operation recovery", { error: err });
    }

    return checkpoint;
  }

  /**
   * Expose diagnostics for stuck pending operations exceeding a configured threshold.
   */
  static async getStuckOperationsDiagnostics(
    thresholdMinutes: number = DEFAULT_STUCK_THRESHOLD_MINUTES
  ): Promise<{
    thresholdMinutes: number;
    totalStuck: number;
    diagnostics: StuckOperationDiagnostic[];
  }> {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const stuckList = await OperationCheckpoint.find({
      overallState: {
        $in: [
          "PENDING",
          "INITIALIZED",
          "PREVALIDATED",
          "ONCHAIN_SUBMITTED",
          "RETRYABLE",
          "RECOVERABLE",
          "MANUALLY_REVIEWED",
        ],
      },
      updatedAt: { $lt: cutoff },
    }).sort({ updatedAt: 1 });

    const now = Date.now();
    const diagnostics: StuckOperationDiagnostic[] = stuckList.map((doc: any) => {
      const minutesStale = Math.round((now - new Date(doc.updatedAt).getTime()) / (60 * 1000));
      const hasOnchainBroadcast = doc.steps.some(
        (s: ICheckpointStep) => s.state === "ONCHAIN_SUBMITTED" || !!s.txHash
      );
      const onchainStep = doc.steps.find((s: ICheckpointStep) => !!s.txHash);

      const canonicalState = this.normalizeState(doc.overallState);

      let recommendedAction: "RETRY" | "ROLLBACK" | "MANUAL_REVIEW" = "RETRY";
      if (doc.retryCount >= doc.maxRetries || canonicalState === "MANUALLY_REVIEWED") {
        recommendedAction = "MANUAL_REVIEW";
      } else if (canonicalState === "FAILED") {
        recommendedAction = "ROLLBACK";
      }

      return {
        operationId: doc.operationId,
        operationType: doc.operationType,
        userId: doc.userId,
        currentStep: doc.currentStep,
        overallState: doc.overallState,
        canonicalState,
        minutesStale,
        retryCount: doc.retryCount,
        maxRetries: doc.maxRetries,
        lastError: doc.lastError,
        recommendedAction,
        hasOnchainBroadcast,
        onchainTxHash: onchainStep?.txHash,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    });

    return {
      thresholdMinutes,
      totalStuck: diagnostics.length,
      diagnostics,
    };
  }

  /**
   * Diagnostic query to find stuck operations (legacy helper).
   */
  static async findStuckOperations(olderThanMinutes: number = 30): Promise<IOperationCheckpoint[]> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    return OperationCheckpoint.find({
      overallState: {
        $in: [
          "PENDING",
          "INITIALIZED",
          "PREVALIDATED",
          "ONCHAIN_SUBMITTED",
          "RETRYABLE",
          "RECOVERABLE",
        ],
      },
      updatedAt: { $lt: cutoff },
    }).sort({ updatedAt: 1 });
  }

  /**
   * Maintainer action to forcefully resolve or abandon an abandoned operation (legacy helper).
   */
  static async forceResolveOperation(
    operationId: string,
    action: "MARK_CONFIRMED" | "ABANDON" | "FORCE_RETRY",
    maintainerId: string,
    reason: string
  ): Promise<IOperationCheckpoint> {
    const actionMap: Record<string, "RESOLVE" | "FAIL" | "RETRY"> = {
      MARK_CONFIRMED: "RESOLVE",
      ABANDON: "FAIL",
      FORCE_RETRY: "RETRY",
    };
    return this.maintainerResolve(operationId, actionMap[action] || "RETRY", maintainerId, reason);
  }
}
