import { createHash, randomUUID } from "node:crypto";
import ExternalSideEffectCheckpoint, {
  type ExternalSideEffectState,
  type IExternalSideEffectCheckpoint,
  type SideEffectOperationType,
} from "../models/ExternalSideEffectCheckpoint";
import { canonicalJson } from "./canonicalSerialization";
import { logger } from "./structuredLogger";

/**
 * Durable checkpoints around external side effects (issue #1175).
 *
 * External calls (Soroban broadcasts, Horizon submissions, outbound webhooks,
 * third-party mints) are not transactional with MongoDB. This module writes a
 * durable checkpoint *before* crossing that boundary and records the outcome
 * after, so callers can distinguish:
 *
 *   - never dispatched        -> FAILED / DENIED, safe to retry
 *   - dispatched, acknowledged -> COMMITTED, replay instead of re-dispatch
 *   - dispatched, unknown      -> AMBIGUOUS, requires reconciliation
 *
 * Every attempt reuses one deterministic `externalReference`, so retries are
 * idempotent even when the remote system deduplicates on the reference rather
 * than on our local state.
 */

export type SideEffectErrorCode =
  | "SIDE_EFFECT_INVALID_INPUT"
  | "SIDE_EFFECT_AUTHORIZATION_DENIED"
  | "SIDE_EFFECT_IN_PROGRESS"
  | "SIDE_EFFECT_AMBIGUOUS"
  | "SIDE_EFFECT_REFERENCE_DRIFT"
  | "SIDE_EFFECT_ATTEMPTS_EXHAUSTED"
  | "SIDE_EFFECT_LEASE_LOST"
  | "SIDE_EFFECT_ROLLED_BACK"
  | "SIDE_EFFECT_RECONCILE_INVALID"
  | "SIDE_EFFECT_ROLLBACK_INVALID"
  | "SIDE_EFFECT_ROLLBACK_FAILED";

export class SideEffectCheckpointError extends Error {
  constructor(
    message: string,
    readonly code: SideEffectErrorCode,
  ) {
    super(message);
    this.name = "SideEffectCheckpointError";
  }
}

export const DEFAULT_SIDE_EFFECT_LEASE_MS = 60_000;
export const DEFAULT_SIDE_EFFECT_MAX_ATTEMPTS = 5;
export const DEFAULT_UNRESOLVED_STALE_MS = 15 * 60 * 1000;

const MAX_ERROR_LENGTH = 500;
const MAX_CLAIM_ROUNDS = 3;

const AMBIGUOUS_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "EAI_AGAIN",
]);

/**
 * Conservative default for classifying a thrown error after dispatch began.
 * Connection resets are treated as unknown because the request may have been
 * applied before the socket broke. Call sites that know their transport can
 * pass a stricter `isAmbiguous` predicate.
 */
export function isAmbiguousSideEffectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof candidate.code === "string" && AMBIGUOUS_ERROR_CODES.has(candidate.code)) {
    return true;
  }
  if (candidate.name === "TimeoutError" || candidate.name === "AbortError") return true;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return /timed?\s?out|timeout|socket hang up|response (?:was )?lost|connection reset/i.test(message);
}

function hashRequest(input: {
  operationType: SideEffectOperationType;
  operationId: string;
  effectKey: string;
  payload: unknown;
}): string {
  return createHash("sha256")
    .update(
      [
        input.operationType,
        input.operationId,
        input.effectKey,
        canonicalJson(input.payload ?? null),
      ].join("\n"),
    )
    .digest("hex");
}

function deterministicReference(input: {
  operationType: SideEffectOperationType;
  operationId: string;
  effectKey: string;
  requestHash: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [input.operationType, input.operationId, input.effectKey, input.requestHash].join("\n"),
    )
    .digest("hex");
  return `se_${digest.slice(0, 32)}`;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > MAX_ERROR_LENGTH ? `${raw.slice(0, MAX_ERROR_LENGTH)}…` : raw;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

export interface RunSideEffectParams<T> {
  operationType: SideEffectOperationType;
  /** Stable identity of the multi-step operation, e.g. a purchase id. */
  operationId: string;
  /** Stable identity of the effect within the operation, e.g. "soroban_payout". */
  effectKey: string;
  /** Principal that owns the effect; a different principal is always denied. */
  actorId: string;
  /** Input that determines the effect. Only its canonical hash is persisted. */
  payload?: unknown;
  /** Optional explicit reference; must stay identical across retries. */
  externalReference?: string;
  /** Authorization gate evaluated before any dispatch or checkpoint reuse. */
  authorize?: (context: {
    actorId: string;
    operationType: SideEffectOperationType;
    operationId: string;
    effectKey: string;
  }) => boolean | Promise<boolean>;
  effect: (context: { externalReference: string; attempt: number }) => Promise<T>;
  /** Overrides the default transport-error classification. */
  isAmbiguous?: (error: unknown) => boolean;
  /** Only this summary and transaction hash are persisted — never the result. */
  describeResult?: (result: T) => {
    txHash?: string;
    summary?: Record<string, unknown>;
  };
  leaseMs?: number;
  maxAttempts?: number;
}

export type DurableSideEffectResult<T> = {
  outcome: "executed" | "replayed";
  checkpoint: IExternalSideEffectCheckpoint;
  /** Absent when the effect was replayed from a committed checkpoint. */
  result?: T;
};

async function recordDenial(input: {
  operationType: SideEffectOperationType;
  operationId: string;
  effectKey: string;
  actorId: string;
  requestHash: string;
  externalReference: string;
  reason: string;
}): Promise<void> {
  const note = input.reason;
  try {
    await ExternalSideEffectCheckpoint.create({
      operationType: input.operationType,
      operationId: input.operationId,
      effectKey: input.effectKey,
      actorId: input.actorId,
      externalReference: input.externalReference,
      requestHash: input.requestHash,
      state: "DENIED",
      attemptToken: null,
      attemptCount: 0,
      history: [{ state: "DENIED", at: new Date(), note }],
    });
    return;
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      logger.warn("Could not persist denied side-effect checkpoint", {
        error: errorMessage(error),
      });
      return;
    }
  }
  // A checkpoint already exists: keep its committed/ambiguous state intact and
  // append the denial to the audit history only.
  await ExternalSideEffectCheckpoint.updateOne(
    { operationId: input.operationId, effectKey: input.effectKey },
    { $push: { history: { state: "DENIED", at: new Date(), note } } },
  ).catch((error: unknown) => {
    logger.warn("Could not append denied side-effect transition", {
      error: errorMessage(error),
    });
  });
}

async function dispatchAttempt<T>(
  checkpoint: IExternalSideEffectCheckpoint,
  attemptToken: string,
  attempt: number,
  params: RunSideEffectParams<T>,
  externalReference: string,
): Promise<DurableSideEffectResult<T>> {
  let result: T;
  try {
    result = await params.effect({ externalReference, attempt });
  } catch (error) {
    const ambiguous = (params.isAmbiguous ?? isAmbiguousSideEffectError)(error);
    const state: ExternalSideEffectState = ambiguous ? "AMBIGUOUS" : "FAILED";
    const message = errorMessage(error);
    const recorded = await ExternalSideEffectCheckpoint.findOneAndUpdate(
      { _id: checkpoint._id, state: "IN_PROGRESS", attemptToken },
      {
        $set: {
          state,
          attemptToken: null,
          leasedUntil: null,
          lastError: message,
        },
        $push: { history: { state, at: new Date(), note: message } },
      },
      { new: true },
    );

    if (!recorded) {
      throw new SideEffectCheckpointError(
        "Checkpoint ownership was lost while recording the side-effect failure; inspect the operation before retrying.",
        "SIDE_EFFECT_LEASE_LOST",
      );
    }
    if (ambiguous) {
      throw new SideEffectCheckpointError(
        `External effect outcome is unknown for reference ${externalReference}. Reconcile the checkpoint before retrying; it was not retried automatically.`,
        "SIDE_EFFECT_AMBIGUOUS",
      );
    }
    // Preserve the caller-visible error for deterministic pre-dispatch failures.
    throw error;
  }

  const details = params.describeResult?.(result) ?? {};
  const recorded = await ExternalSideEffectCheckpoint.findOneAndUpdate(
    { _id: checkpoint._id, state: "IN_PROGRESS", attemptToken },
    {
      $set: {
        state: "COMMITTED",
        attemptToken: null,
        leasedUntil: null,
        txHash: details.txHash,
        resultSummary: details.summary,
      },
      $unset: { lastError: "" },
      $push: {
        history: {
          state: "COMMITTED",
          at: new Date(),
          note: `Effect acknowledged with reference ${externalReference}.`,
        },
      },
    },
    { new: true },
  );

  if (!recorded) {
    // The effect ran but another attempt took over the expired lease (which
    // only ever marks the row AMBIGUOUS). Persist the real outcome best-effort
    // so the next caller replays this commit instead of dispatching again.
    await ExternalSideEffectCheckpoint.updateOne(
      { _id: checkpoint._id, state: "AMBIGUOUS" },
      {
        $set: {
          state: "COMMITTED",
          attemptToken: null,
          leasedUntil: null,
          txHash: details.txHash,
          resultSummary: details.summary,
          lastError: "Outcome recorded after a lease takeover.",
        },
        $push: {
          history: {
            state: "COMMITTED",
            at: new Date(),
            note: "Late commit after lease takeover.",
          },
        },
      },
    ).catch((error: unknown) => {
      logger.error("Could not record late side-effect commit", {
        error: errorMessage(error),
      });
    });
    throw new SideEffectCheckpointError(
      "External effect committed but checkpoint ownership was lost; verify before retrying.",
      "SIDE_EFFECT_LEASE_LOST",
    );
  }

  return { outcome: "executed", checkpoint: recorded, result };
}

/**
 * Runs one external effect behind a durable checkpoint.
 *
 * Normal path: writes IN_PROGRESS, dispatches once, writes COMMITTED.
 * Retry path: a COMMITTED checkpoint replays without dispatch; a FAILED one
 * reuses the same deterministic reference and bumps `attemptCount`.
 * Failure path: pre-dispatch errors stay retryable; ambiguous transport errors
 * become AMBIGUOUS and are never retried automatically.
 * Authorization path: a denied actor is recorded and never dispatches.
 */
export async function runDurableSideEffect<T>(
  params: RunSideEffectParams<T>,
): Promise<DurableSideEffectResult<T>> {
  if (!params.operationId?.trim()) {
    throw new SideEffectCheckpointError("operationId is required.", "SIDE_EFFECT_INVALID_INPUT");
  }
  if (!params.actorId?.trim()) {
    throw new SideEffectCheckpointError("actorId is required.", "SIDE_EFFECT_INVALID_INPUT");
  }
  if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(params.effectKey ?? "")) {
    throw new SideEffectCheckpointError(
      "effectKey must be 1-120 characters of letters, digits, '.', '_', ':' or '-'.",
      "SIDE_EFFECT_INVALID_INPUT",
    );
  }

  const maxAttempts = Math.max(1, params.maxAttempts ?? DEFAULT_SIDE_EFFECT_MAX_ATTEMPTS);
  const leaseMs = Math.max(1_000, params.leaseMs ?? DEFAULT_SIDE_EFFECT_LEASE_MS);
  const payload = params.payload ?? null;
  const requestHash = hashRequest({
    operationType: params.operationType,
    operationId: params.operationId,
    effectKey: params.effectKey,
    payload,
  });
  const externalReference =
    params.externalReference ??
    deterministicReference({
      operationType: params.operationType,
      operationId: params.operationId,
      effectKey: params.effectKey,
      requestHash,
    });

  const authorized = params.authorize
    ? await params.authorize({
        actorId: params.actorId,
        operationType: params.operationType,
        operationId: params.operationId,
        effectKey: params.effectKey,
      })
    : true;
  if (!authorized) {
    await recordDenial({
      operationType: params.operationType,
      operationId: params.operationId,
      effectKey: params.effectKey,
      actorId: params.actorId,
      requestHash,
      externalReference,
      reason: `Actor ${params.actorId} is not authorized for ${params.effectKey}.`,
    });
    throw new SideEffectCheckpointError(
      "Actor is not authorized to perform this external side effect.",
      "SIDE_EFFECT_AUTHORIZATION_DENIED",
    );
  }

  for (let round = 0; round < MAX_CLAIM_ROUNDS; round += 1) {
    const existing = await ExternalSideEffectCheckpoint.findOne({
      operationId: params.operationId,
      effectKey: params.effectKey,
    });

    if (!existing) {
      const attemptToken = randomUUID();
      try {
        const created = await ExternalSideEffectCheckpoint.create({
          operationType: params.operationType,
          operationId: params.operationId,
          effectKey: params.effectKey,
          actorId: params.actorId,
          externalReference,
          requestHash,
          state: "IN_PROGRESS",
          attemptToken,
          attemptCount: 1,
          maxAttempts,
          leasedUntil: new Date(Date.now() + leaseMs),
          history: [
            {
              state: "IN_PROGRESS",
              at: new Date(),
              note: `Attempt 1 dispatched with reference ${externalReference}.`,
            },
          ],
        });
        return await dispatchAttempt(created, attemptToken, 1, params, externalReference);
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        continue; // Lost the create race; re-read and claim the existing row.
      }
    }

    if (existing.externalReference !== externalReference) {
      throw new SideEffectCheckpointError(
        "The same effect key was retried with different input. Create a new operation instead.",
        "SIDE_EFFECT_REFERENCE_DRIFT",
      );
    }
    if (existing.actorId !== params.actorId) {
      throw new SideEffectCheckpointError(
        "Checkpoint belongs to a different actor.",
        "SIDE_EFFECT_AUTHORIZATION_DENIED",
      );
    }
    switch (existing.state) {
      case "COMMITTED":
        return { outcome: "replayed", checkpoint: existing };
      case "ROLLED_BACK":
        throw new SideEffectCheckpointError(
          "This effect was rolled back and its reference was already used; start a new operation.",
          "SIDE_EFFECT_ROLLED_BACK",
        );
      case "AMBIGUOUS":
        throw new SideEffectCheckpointError(
          `External effect outcome is unknown for reference ${existing.externalReference}. Reconcile the checkpoint before retrying.`,
          "SIDE_EFFECT_AMBIGUOUS",
        );
      case "IN_PROGRESS": {
        const leaseActive = existing.leasedUntil && existing.leasedUntil.getTime() > Date.now();
        if (leaseActive) {
          throw new SideEffectCheckpointError(
            "An attempt for this external effect is still in progress.",
            "SIDE_EFFECT_IN_PROGRESS",
          );
        }
        // The previous worker vanished without checkpointing an outcome. It may
        // have dispatched, so never re-run: quarantine for reconciliation.
        const quarantined = await ExternalSideEffectCheckpoint.findOneAndUpdate(
          {
            _id: existing._id,
            state: "IN_PROGRESS",
            attemptToken: existing.attemptToken,
          },
          {
            $set: {
              state: "AMBIGUOUS",
              attemptToken: null,
              leasedUntil: null,
              lastError: "Attempt lease expired without a recorded outcome.",
            },
            $push: {
              history: {
                state: "AMBIGUOUS",
                at: new Date(),
                note: "Lease expired without a checkpointed outcome; dispatch state unknown.",
              },
            },
          },
          { new: true },
        );
        if (!quarantined) continue;
        throw new SideEffectCheckpointError(
          `External effect outcome is unknown for reference ${existing.externalReference}. Reconcile the checkpoint before retrying.`,
          "SIDE_EFFECT_AMBIGUOUS",
        );
      }
      case "FAILED":
      case "DENIED": {
        if (existing.attemptCount >= maxAttempts) {
          throw new SideEffectCheckpointError(
            "Retry budget exhausted for this external effect; reconcile or start a new operation.",
            "SIDE_EFFECT_ATTEMPTS_EXHAUSTED",
          );
        }
        const attemptToken = randomUUID();
        const attempt = existing.attemptCount + 1;
        const claimed = await ExternalSideEffectCheckpoint.findOneAndUpdate(
          {
            _id: existing._id,
            state: existing.state,
            attemptToken: existing.attemptToken ?? null,
          },
          {
            $set: {
              state: "IN_PROGRESS",
              attemptToken,
              attemptCount: attempt,
              actorId: params.actorId,
              maxAttempts,
              leasedUntil: new Date(Date.now() + leaseMs),
            },
            $push: {
              history: {
                state: "IN_PROGRESS",
                at: new Date(),
                note: `Attempt ${attempt} dispatched with reference ${externalReference}.`,
              },
            },
          },
          { new: true },
        );
        if (!claimed) continue;
        return await dispatchAttempt(claimed, attemptToken, attempt, params, externalReference);
      }
      default:
        throw new SideEffectCheckpointError(
          `Unsupported checkpoint state: ${String(existing.state)}`,
          "SIDE_EFFECT_INVALID_INPUT",
        );
    }
  }

  throw new SideEffectCheckpointError(
    "Could not settle the external-effect checkpoint because of concurrent claims; retry.",
    "SIDE_EFFECT_IN_PROGRESS",
  );
}

export interface ReconcileSideEffectParams {
  operationId: string;
  effectKey: string;
  operatorId: string;
  reason: string;
  /** Verified remote outcome for an AMBIGUOUS checkpoint. */
  outcome: "COMMITTED" | "NOT_APPLIED";
  txHash?: string;
  resultSummary?: Record<string, unknown>;
}

/**
 * Resolves an AMBIGUOUS checkpoint after an operator checks the remote system.
 * COMMITTED makes future retries replay; NOT_APPLIED returns the effect to the
 * retryable FAILED state. A justification is mandatory and recorded.
 */
export async function reconcileSideEffect(
  params: ReconcileSideEffectParams,
): Promise<IExternalSideEffectCheckpoint> {
  if (!params.reason?.trim()) {
    throw new SideEffectCheckpointError(
      "A justification reason is required to reconcile an external effect.",
      "SIDE_EFFECT_RECONCILE_INVALID",
    );
  }
  const existing = await ExternalSideEffectCheckpoint.findOne({
    operationId: params.operationId,
    effectKey: params.effectKey,
  });
  if (!existing) {
    throw new SideEffectCheckpointError(
      "External-effect checkpoint not found.",
      "SIDE_EFFECT_RECONCILE_INVALID",
    );
  }
  if (existing.state === "COMMITTED") return existing;
  if (existing.state !== "AMBIGUOUS") {
    throw new SideEffectCheckpointError(
      `Only AMBIGUOUS checkpoints can be reconciled; current state is ${existing.state}.`,
      "SIDE_EFFECT_RECONCILE_INVALID",
    );
  }

  const now = new Date();
  const committed = params.outcome === "COMMITTED";
  const set: Record<string, unknown> = {
    state: committed ? "COMMITTED" : "FAILED",
    attemptToken: null,
    leasedUntil: null,
    reconciledBy: params.operatorId,
    reconciledAt: now,
    reconciliationReason: params.reason,
  };
  if (!committed) set.lastError = `Reconciled as not applied: ${params.reason}`;
  if (committed && params.txHash) set.txHash = params.txHash;
  if (params.resultSummary) set.resultSummary = params.resultSummary;

  const reconciled = await ExternalSideEffectCheckpoint.findOneAndUpdate(
    { _id: existing._id, state: "AMBIGUOUS" },
    {
      $set: set,
      ...(committed ? { $unset: { lastError: "" } } : {}),
      $push: {
        history: {
          state: committed ? "COMMITTED" : "FAILED",
          at: now,
          note: `Reconciled by ${params.operatorId}: ${params.outcome}. ${params.reason}`,
        },
      },
    },
    { new: true },
  );
  if (!reconciled) {
    throw new SideEffectCheckpointError(
      "Checkpoint changed while being reconciled; re-read and retry.",
      "SIDE_EFFECT_RECONCILE_INVALID",
    );
  }
  return reconciled;
}

export interface RollbackSideEffectParams {
  operationId: string;
  effectKey: string;
  /** Must match the actor that owns the checkpoint. */
  actorId: string;
  reason: string;
  /** Compensating action; it must itself be idempotent on the reference. */
  compensate: (checkpoint: IExternalSideEffectCheckpoint) => Promise<void>;
}

/**
 * Compensates a COMMITTED effect when a later step fails. A failed
 * compensation keeps the checkpoint COMMITTED so the effect is never reported
 * as undone, and the rollback error is persisted for operators.
 */
export async function rollbackSideEffect(
  params: RollbackSideEffectParams,
): Promise<IExternalSideEffectCheckpoint> {
  if (!params.reason?.trim()) {
    throw new SideEffectCheckpointError(
      "A justification reason is required to roll back an external effect.",
      "SIDE_EFFECT_ROLLBACK_INVALID",
    );
  }
  const existing = await ExternalSideEffectCheckpoint.findOne({
    operationId: params.operationId,
    effectKey: params.effectKey,
  });
  if (!existing) {
    throw new SideEffectCheckpointError(
      "External-effect checkpoint not found.",
      "SIDE_EFFECT_ROLLBACK_INVALID",
    );
  }
  if (existing.actorId !== params.actorId) {
    throw new SideEffectCheckpointError(
      "Checkpoint belongs to a different actor.",
      "SIDE_EFFECT_AUTHORIZATION_DENIED",
    );
  }
  if (existing.state === "ROLLED_BACK") return existing;
  if (existing.state !== "COMMITTED") {
    throw new SideEffectCheckpointError(
      `Only COMMITTED checkpoints can be rolled back; current state is ${existing.state}.`,
      "SIDE_EFFECT_ROLLBACK_INVALID",
    );
  }

  try {
    await params.compensate(existing);
  } catch (error) {
    const message = errorMessage(error);
    await ExternalSideEffectCheckpoint.updateOne(
      { _id: existing._id, state: "COMMITTED" },
      {
        $set: { rollbackError: message },
        $push: {
          history: {
            state: "COMMITTED",
            at: new Date(),
            note: `Rollback failed: ${message}`,
          },
        },
      },
    );
    throw new SideEffectCheckpointError(
      `Rollback failed; the effect remains committed. ${message}`,
      "SIDE_EFFECT_ROLLBACK_FAILED",
    );
  }

  const now = new Date();
  const rolledBack = await ExternalSideEffectCheckpoint.findOneAndUpdate(
    { _id: existing._id, state: "COMMITTED" },
    {
      $set: {
        state: "ROLLED_BACK",
        rolledBackAt: now,
        leasedUntil: null,
        attemptToken: null,
        reconciliationReason: params.reason,
      },
      $unset: { rollbackError: "" },
      $push: {
        history: {
          state: "ROLLED_BACK",
          at: now,
          note: `Compensated by ${params.actorId}: ${params.reason}`,
        },
      },
    },
    { new: true },
  );
  if (!rolledBack) {
    const current = await ExternalSideEffectCheckpoint.findById(existing._id);
    if (current?.state === "ROLLED_BACK") return current;
    throw new SideEffectCheckpointError(
      "Checkpoint changed while rolling back; verify the remote state before retrying.",
      "SIDE_EFFECT_ROLLBACK_INVALID",
    );
  }
  return rolledBack;
}

/**
 * Lists checkpoints that need operator attention: AMBIGUOUS rows, and
 * IN_PROGRESS rows whose lease expired (a crashed worker).
 */
export async function listUnresolvedSideEffects(options: {
  operationId?: string;
  staleMs?: number;
} = {}): Promise<IExternalSideEffectCheckpoint[]> {
  const cutoff = new Date(Date.now() - (options.staleMs ?? DEFAULT_UNRESOLVED_STALE_MS));
  const filter: Record<string, unknown> = {
    $or: [
      { state: "AMBIGUOUS" },
      { state: "IN_PROGRESS", leasedUntil: { $lt: cutoff } },
    ],
  };
  if (options.operationId) filter.operationId = options.operationId;
  return ExternalSideEffectCheckpoint.find(filter).sort({ updatedAt: 1 });
}
