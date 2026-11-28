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

/**
 * Failure injection points for end-to-end verification of critical workflows.
 * Each point names a location in a workflow where a failure can be forced.
 * Injection is only honored when explicitly enabled via `FailureInjector`,
 * so production behavior is unchanged by default.
 */
export type FailureInjectionPoint =
  | "BEFORE_STEP"
  | "AFTER_STEP"
  | "ONCHAIN_BROADCAST"
  | "AUTHORIZATION";

export interface FailureInjectionRule {
  point: FailureInjectionPoint;
  stepName?: string;
  /** Number of times the rule fires before becoming inert. Defaults to 1. */
  times?: number;
  error?: string;
}

export class InjectedFailureError extends Error {
  readonly point: FailureInjectionPoint;
  readonly stepName?: string;

  constructor(point: FailureInjectionPoint, stepName?: string, message?: string) {
    super(message ?? `Injected failure at ${point}${stepName ? ` (${stepName})` : ""}`);
    this.name = "InjectedFailureError";
    this.point = point;
    this.stepName = stepName;
  }
}

/**
 * Deterministic, opt-in failure injector used by end-to-end tests.
 * Rules are consumed in order; each rule fires up to `times` times.
 */
export class FailureInjector {
  private static rules: Array<FailureInjectionRule & { remaining: number }> = [];

  static configure(rules: FailureInjectionRule[]): void {
    this.rules = rules.map((r) => ({ ...r, remaining: r.times ?? 1 }));
  }

  static reset(): void {
    this.rules = [];
  }

  static pendingRuleCount(): number {
    return this.rules.filter((r) => r.remaining > 0).length;
  }

  /**
   * Throws an InjectedFailureError if a matching rule remains active.
   * No-op when no rules are configured.
   */
  static maybeFail(point: FailureInjectionPoint, stepName?: string): void {
    for (const rule of this.rules) {
      if (rule.remaining <= 0) continue;
      if (rule.point !== point) continue;
      if (rule.stepName !== undefined && rule.stepName !== stepName) continue;
      rule.remaining -= 1;
      throw new InjectedFailureError(point, stepName, rule.error);
    }
  }
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
   * Honors injected failures at BEFORE_STEP and AFTER_STEP points so that
   * recovery paths can be exercised end-to-end.
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
    FailureInjector.maybeFail("BEFORE_STEP", stepName);

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

    FailureInjector.maybeFail("AFTER_STEP", stepName);

    return checkpoint;
  }

  /**
   * Evaluates an operation and produces a deterministic recovery plan.
   *
   * Edge cases:
   * - RESOLVED / FAILED operations are terminal and require manual review.
   * - Exhausted retries transition to MANUALLY_REVIEWED.
   * - If any step was broadcast on-chain, resume verifies status first to
   *   avoid duplicating side effects.
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
   * Authorization failures are raised before any state mutation.
   */
  static async userRetry(operationId: string, userWallet: string): Promise<IOperationCheckpoint> {
    FailureInjector.maybeFail("AUTHORIZATION");

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

    const nextState: OperationStepState =
      action === "RESOLVE"
        ? "RESOLVED"
        : action === "FAIL"
          ? "FAILED"
          : action === "RETRY"
            ? "RETRYABLE"
            : "MANUALLY_REVIEWED";

    checkpoint.overallState = nextState;
    checkpoint.nextRecoveryAction =
      action === "RESOLVE"
        ? "COMPLETED"
        : action === "FAIL"
          ? "TERMINATED"
          : action === "RETRY"
            ? `RETRY_${checkpoint.currentStep.toUpperCase()}`
            : "AWAITING_MAINTAINER_REVIEW";

    checkpoint.steps.push({
      stepName: `MAINTAINER_${action}`,
      state: nextState,
      timestamp: new Date(),
      data: { maintainerId, reason, priorState },
    });

    await checkpoint.save();

    try {
      await recordAccessOrOwnershipChange({
        action: "operation_recovery",
        result: "success",
        actor: maintainerId.toLowerCase(),
        target: operationId,
        targetType: "system",
        beforeState: { priorState },
        afterState: { newState: nextState, action },
        reason,
      });
    } catch (err) {
      logger.warn("Could not audit maintainer operation recovery", { error: err });
    }

    return checkpoint;
  }
}
