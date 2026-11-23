/**
 * Dependency fallback policy (#1126)
 *
 * The degradation matrix (dependencyDegradationMatrix.ts, #980) documents what
 * each dependency failure *means*. This module makes it executable: given the
 * current dependency states it decides, per user-facing capability, whether a
 * request runs normally, runs in a degraded mode, or is blocked — and it runs
 * the operation with a retry policy that cannot double-charge or fail open.
 *
 * Rules enforced here (see docs/dependency-degradation-matrix.md):
 *  - Blocked capabilities never invoke the operation, so no funds move and no
 *    partial writes happen.
 *  - auth_failure is never retried: rejected credentials cannot recover by
 *    retrying, and hammering the provider risks account lockout.
 *  - Authorization-bearing capabilities (unlock, wallet auth) fail closed:
 *    stale or unverifiable state blocks the request instead of granting access.
 *  - Mutating capabilities are only retried when the caller supplies an
 *    idempotency key; otherwise they get exactly one attempt.
 */

import {
  getFallbackBehavior,
  getUserSafeMessage,
  type DependencyName,
  type FailureMode,
  type ProbeResult,
} from "./dependencyDegradationMatrix.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Capability =
  | "browse_catalog"
  | "purchase_prompt"
  | "unlock_prompt"
  | "publish_prompt"
  | "wallet_auth";

export type CapabilityOutcome = "normal" | "degraded" | "blocked";

/** Impact of one unhealthy dependency on one capability. */
export type DependencyImpact = Exclude<CapabilityOutcome, "normal">;

export interface DependencyState {
  dependency: DependencyName;
  healthy: boolean;
  failureMode?: FailureMode;
}

export interface FallbackDecision {
  capability: Capability;
  outcome: CapabilityOutcome;
  /** HTTP status the API should answer with when the capability is blocked. */
  httpStatus: 200 | 503;
  /** Whether the client may retry the same request later. */
  retryable: boolean;
  /** Seconds the client should wait before retrying; set only when retryable and blocked. */
  retryAfterSeconds?: number;
  /** User-safe copy — never contains hostnames, stack traces, or credentials. */
  userMessage?: string;
  blockingDependencies: DependencyName[];
  degradedDependencies: DependencyName[];
  /** Matrix fallback behaviour for each unhealthy dependency, for logs and runbooks. */
  fallbackBehaviors: string[];
}

// ---------------------------------------------------------------------------
// Capability × dependency matrix
// ---------------------------------------------------------------------------

/**
 * How an unhealthy dependency affects each capability. A dependency that is
 * not listed for a capability does not affect it.
 */
export const CAPABILITY_DEGRADATION_MATRIX: Record<
  Capability,
  Partial<Record<DependencyName, DependencyImpact>>
> = {
  browse_catalog: {
    mongodb: "blocked",
    redis: "degraded",
  },
  purchase_prompt: {
    stellar_rpc: "blocked",
    mongodb: "blocked",
    stellar_horizon: "degraded", // balance pre-check skipped with a warning
    redis: "degraded", // in-process rate limiter
  },
  unlock_prompt: {
    stellar_rpc: "blocked", // has_access cannot be verified — fail closed
    mongodb: "blocked",
    ipfs_pinata: "degraded", // preview served instead of full payload
    redis: "degraded", // in-process nonces with shorter TTL
  },
  publish_prompt: {
    mongodb: "blocked",
    ipfs_pinata: "blocked",
    safety_scanner: "degraded", // routed to manual review
    redis: "degraded",
  },
  wallet_auth: {
    redis: "degraded", // in-process nonces with shorter TTL
  },
};

/** Capabilities that grant access; they must never proceed on unverifiable state. */
export const AUTHORIZATION_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "unlock_prompt",
  "wallet_auth",
]);

/** Capabilities that write state or move funds; retries need an idempotency key. */
export const MUTATING_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "purchase_prompt",
  "publish_prompt",
]);

/** Failure modes that indicate state we cannot trust for an access decision. */
const UNTRUSTED_STATE_MODES: ReadonlySet<FailureMode> = new Set([
  "stale_data",
  "partial_data",
]);

const RETRY_AFTER_SECONDS: Record<FailureMode, number | undefined> = {
  timeout: 5,
  partial_data: 10,
  stale_data: 15,
  connection_refused: 30,
  rate_limited: 30,
  unavailable: 60,
  auth_failure: undefined, // not retryable
};

const GENERIC_UNAVAILABLE_MESSAGE =
  "This action is temporarily unavailable. Please try again shortly.";

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

function impactFor(capability: Capability, state: DependencyState): DependencyImpact | null {
  const base = CAPABILITY_DEGRADATION_MATRIX[capability][state.dependency];
  if (!base) return null;
  // Credentials rejected: a dependency this capability relies on is unusable.
  if (state.failureMode === "auth_failure") return "blocked";
  // Never authorize access from a dependency serving stale or partial state.
  if (
    AUTHORIZATION_CAPABILITIES.has(capability) &&
    state.failureMode &&
    UNTRUSTED_STATE_MODES.has(state.failureMode)
  ) {
    return "blocked";
  }
  return base;
}

/**
 * Decide how `capability` should behave given the current dependency states.
 * Pure and synchronous so it can be evaluated per request without I/O.
 */
export function resolveFallbackDecision(
  capability: Capability,
  states: ReadonlyArray<DependencyState | ProbeResult>,
): FallbackDecision {
  const blocking: DependencyState[] = [];
  const degraded: DependencyState[] = [];

  for (const state of states) {
    if (state.healthy) continue;
    const impact = impactFor(capability, state);
    if (impact === "blocked") blocking.push(state);
    else if (impact === "degraded") degraded.push(state);
  }

  const unhealthy = [...blocking, ...degraded];
  const fallbackBehaviors = unhealthy.map((s) =>
    getFallbackBehavior(s.dependency, s.failureMode ?? "unavailable"),
  );
  const base = {
    capability,
    blockingDependencies: blocking.map((s) => s.dependency),
    degradedDependencies: degraded.map((s) => s.dependency),
    fallbackBehaviors,
  };

  if (blocking.length === 0) {
    const first = degraded[0];
    return {
      ...base,
      outcome: degraded.length > 0 ? "degraded" : "normal",
      httpStatus: 200,
      retryable: true,
      userMessage: first
        ? getUserSafeMessage(first.dependency, first.failureMode ?? "unavailable")
        : undefined,
    };
  }

  // Any credential failure makes the whole decision non-retryable.
  const retryable = blocking.every((s) => s.failureMode !== "auth_failure");
  const retryAfterSeconds = retryable
    ? Math.max(...blocking.map((s) => RETRY_AFTER_SECONDS[s.failureMode ?? "unavailable"] ?? 0))
    : undefined;
  const primary = blocking[0];

  return {
    ...base,
    outcome: "blocked",
    httpStatus: 503,
    retryable,
    retryAfterSeconds,
    userMessage: primary.failureMode
      ? getUserSafeMessage(primary.dependency, primary.failureMode)
      : GENERIC_UNAVAILABLE_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Execution with retry
// ---------------------------------------------------------------------------

/** Error thrown by an operation when a dependency fails mid-request. */
export class DependencyFailureError extends Error {
  readonly dependency: DependencyName;
  readonly failureMode: FailureMode;

  constructor(dependency: DependencyName, failureMode: FailureMode, message?: string) {
    super(message ?? `${dependency} failed: ${failureMode}`);
    this.name = "DependencyFailureError";
    this.dependency = dependency;
    this.failureMode = failureMode;
  }
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
};

export interface ExecuteWithFallbackOptions<T> {
  capability: Capability;
  states: ReadonlyArray<DependencyState | ProbeResult>;
  /** Invoked only when the capability is not blocked. */
  run: (context: { decision: FallbackDecision; attempt: number; idempotencyKey?: string }) => Promise<T>;
  /** Required for retries of purchase/publish; reused verbatim on every attempt. */
  idempotencyKey?: string;
  retry?: Partial<RetryPolicy>;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type ExecuteWithFallbackResult<T> =
  | { status: "ok"; value: T; decision: FallbackDecision; attempts: number }
  | { status: "blocked"; decision: FallbackDecision; attempts: 0 }
  | { status: "failed"; decision: FallbackDecision; attempts: number; error: unknown };

/** Whether a mid-request failure is worth retrying within the same request. */
export function isRetryableFailure(error: unknown): boolean {
  if (!(error instanceof DependencyFailureError)) return false;
  return (
    error.failureMode === "timeout" ||
    error.failureMode === "rate_limited" ||
    error.failureMode === "connection_refused" ||
    error.failureMode === "partial_data"
  );
}

export function backoffDelayMs(attempt: number, policy: RetryPolicy): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolve the fallback decision for `capability` and run the operation under
 * it. Blocked capabilities return without calling `run`.
 */
export async function executeWithFallback<T>(
  options: ExecuteWithFallbackOptions<T>,
): Promise<ExecuteWithFallbackResult<T>> {
  const decision = resolveFallbackDecision(options.capability, options.states);
  if (decision.outcome === "blocked") {
    return { status: "blocked", decision, attempts: 0 };
  }

  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
  // Without an idempotency key a retried purchase could charge twice.
  const maxAttempts =
    MUTATING_CAPABILITIES.has(options.capability) && !options.idempotencyKey
      ? 1
      : Math.max(1, policy.maxAttempts);
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await options.run({
        decision,
        attempt,
        idempotencyKey: options.idempotencyKey,
      });
      return { status: "ok", value, decision, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!isRetryableFailure(error) || attempt === maxAttempts) {
        return { status: "failed", decision, attempts: attempt, error };
      }
      await sleep(backoffDelayMs(attempt, policy));
    }
  }

  // Unreachable: the loop always returns on its last attempt.
  return { status: "failed", decision, attempts: maxAttempts, error: lastError };
}

// ---------------------------------------------------------------------------
// HTTP integration
// ---------------------------------------------------------------------------

export interface DependencyStateSource {
  (): Promise<ReadonlyArray<DependencyState | ProbeResult>>;
}

/**
 * Cache dependency states so per-request decisions do not trigger network
 * probes. Concurrent callers share one in-flight refresh. If a refresh fails
 * the last known states are kept; with no prior snapshot every dependency is
 * reported healthy so a broken probe pipeline does not take the API down
 * (individual operations still fail and are handled by their own errors).
 */
export function createCachedStateSource(
  probe: DependencyStateSource,
  options: { ttlMs: number; now?: () => number },
): DependencyStateSource {
  const now = options.now ?? Date.now;
  let snapshot: ReadonlyArray<DependencyState | ProbeResult> = [];
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<ReadonlyArray<DependencyState | ProbeResult>> | null = null;

  return async () => {
    if (now() - fetchedAt < options.ttlMs) return snapshot;
    if (!inFlight) {
      inFlight = probe()
        .then((states) => {
          snapshot = states;
          fetchedAt = now();
          return states;
        })
        .catch(() => snapshot)
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}

interface MinimalResponse {
  setHeader(name: string, value: string | number): unknown;
  status(code: number): { json(body: unknown): unknown };
  locals: Record<string, unknown>;
}

/**
 * Express middleware that answers 503 for blocked capabilities and exposes
 * the decision on `res.locals.fallbackDecision` for degraded ones. Additive:
 * routes opt in explicitly, so existing API contracts are unchanged.
 */
export function requireCapability(capability: Capability, source: DependencyStateSource) {
  return async (_req: unknown, res: MinimalResponse, next: (err?: unknown) => void) => {
    let decision: FallbackDecision;
    try {
      decision = resolveFallbackDecision(capability, await source());
    } catch (err) {
      return next(err);
    }

    res.locals.fallbackDecision = decision;
    if (decision.outcome === "degraded") {
      res.setHeader("X-Degraded-Dependencies", decision.degradedDependencies.join(","));
    }
    if (decision.outcome !== "blocked") return next();

    if (decision.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", decision.retryAfterSeconds);
    }
    return res.status(503).json({
      error: decision.userMessage,
      code: "DEPENDENCY_UNAVAILABLE",
      capability,
      retryable: decision.retryable,
      retryAfter: decision.retryAfterSeconds,
    });
  };
}
