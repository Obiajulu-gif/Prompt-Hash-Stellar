/**
 * Feature-flag rollout guard with automatic rollback verification — Issue #988.
 *
 * Pure, dependency-free policy layer on top of `featureFlagService.ts`
 * (which owns persistence and per-user hashing). Keeping this module pure
 * (no Mongo, no network) means rollout/rollback decisions are unit-testable
 * and safe to call from routes, jobs, or CI without side effects.
 *
 * - Scoped: each rollout declares a blast radius (`RolloutScope`).
 * - Monitored: caller passes observed health (`GuardSignals`); the guard
 *   blocks or orders a rollback when thresholds are breached.
 * - Verified: `verifyRollback` asserts the flag is disabled everywhere and
 *   no partial-write/ledger drift remains, so a rollback never leaves
 *   inconsistent state behind.
 * - Emergency disablement: `evaluateEmergencyDisable` provides an
 *   authorized, always-available kill switch that bypasses threshold
 *   evaluation but still requires explicit operator authorization.
 *
 * Runbook: docs/flag-rollout-guard.md
 */

export type RolloutScope =
  | "marketplace"
  | "settlement"
  | "payouts"
  | "auth"
  | "indexer"
  | "global";

export type RolloutEnvironment = "development" | "staging" | "production";

export interface RolloutRequest {
  flag: string;
  scope: RolloutScope;
  environment: RolloutEnvironment;
  rolloutPercentage: number;
}

export interface GuardSignals {
  /** Observed error rate 0..1 (unlock failures, settlement errors, 5xx). */
  errorRate: number;
  /** Active P1 incident (funds at risk, outage, exploit). */
  p1Incident: boolean;
  /** Domain invariant violations detected (entitlement/ledger drift). */
  invariantViolations: number;
}

export interface GuardDecision {
  allow: boolean;
  requireRollback: boolean;
  reasons: string[];
}

export interface GuardThresholds {
  maxErrorRate: number;
  /** Settlement/payout scopes may only ramp this far without staging soak. */
  maxDirectProductionPercent: number;
}

export const DEFAULT_GUARD_THRESHOLDS: GuardThresholds = {
  maxErrorRate: 0.05,
  maxDirectProductionPercent: 10,
};

export function evaluateRolloutGuard(
  req: RolloutRequest,
  signals: GuardSignals,
  thresholds: GuardThresholds = DEFAULT_GUARD_THRESHOLDS,
): GuardDecision {
  const reasons: string[] = [];
  let allow = true;
  let requireRollback = false;

  if (!Number.isInteger(req.rolloutPercentage) || req.rolloutPercentage < 0 || req.rolloutPercentage > 100) {
    allow = false;
    reasons.push("rolloutPercentage must be within 0..100");
  }
  if (!Number.isFinite(signals.errorRate) || signals.errorRate < 0 || signals.errorRate > 1 ||
      typeof signals.p1Incident !== "boolean" ||
      !Number.isSafeInteger(signals.invariantViolations) || signals.invariantViolations < 0) {
    return { allow: false, requireRollback: false, reasons: ["Invalid rollout health signals"] };
  }
  if (signals.errorRate > thresholds.maxErrorRate) {
    allow = false;
    requireRollback = req.rolloutPercentage > 0;
    reasons.push(
      `errorRate ${(signals.errorRate * 100).toFixed(2)}% exceeds ${(thresholds.maxErrorRate * 100).toFixed(2)}% ceiling`,
    );
  }
  if (signals.p1Incident) {
    allow = false;
    requireRollback = req.rolloutPercentage > 0;
    reasons.push("active P1 incident — rollout blocked, rollback required");
  }
  if (signals.invariantViolations > 0) {
    allow = false;
    requireRollback = req.rolloutPercentage > 0;
    reasons.push(`${signals.invariantViolations} invariant violation(s) — rollback required`);
  }
  if (
    req.environment === "production" &&
    (req.scope === "settlement" || req.scope === "payouts" || req.scope === "global") &&
    req.rolloutPercentage > thresholds.maxDirectProductionPercent
  ) {
    allow = false;
    reasons.push(
      `${req.scope} scope may not exceed ${thresholds.maxDirectProductionPercent}% in production without staging soak`,
    );
  }
  if (allow) reasons.push("guard passed: scoped, monitored, within thresholds");

  return { allow, requireRollback, reasons };
}

export interface EmergencyDisableRequest {
  flag: string;
  /** Identifier of the operator invoking the kill switch. */
  operatorId: string;
  /** Whether the operator holds the emergency-disable authorization role. */
  operatorAuthorized: boolean;
  /** Human-readable justification, required for audit. */
  reason: string;
}

export interface EmergencyDisableDecision {
  /** True when the flag must be forced off. */
  disable: boolean;
  /** True when the request was accepted and should be audited. */
  audited: boolean;
  reasons: string[];
}

/**
 * Emergency kill switch. Disabling a flag is always the safe direction, so
 * this path does not consult health thresholds. It still requires an
 * authorized operator and a non-empty reason so every disablement is
 * attributable. Unauthorized or malformed requests are rejected without
 * changing flag state.
 */
export function evaluateEmergencyDisable(req: EmergencyDisableRequest): EmergencyDisableDecision {
  const reasons: string[] = [];
  if (req === null || typeof req !== "object") {
    return { disable: false, audited: false, reasons: ["request is required"] };
  }
  if (typeof req.flag !== "string" || req.flag.trim().length === 0) {
    reasons.push("flag is required");
  }
  if (typeof req.operatorId !== "string" || req.operatorId.trim().length === 0) {
    reasons.push("operatorId is required for audit");
  }
  if (typeof req.reason !== "string" || req.reason.trim().length === 0) {
    reasons.push("reason is required for audit");
  }
  if (req.operatorAuthorized !== true) {
    reasons.push("operator is not authorized to perform emergency disablement");
  }
  if (reasons.length > 0) {
    return { disable: false, audited: false, reasons };
  }
  return {
    disable: true,
    audited: true,
    reasons: [`emergency disable accepted for ${req.flag} by ${req.operatorId}`],
  };
}

export interface RollbackEvidence {
  /** Flag reads disabled in every environment (dev/staging/production). */
  flagDisabledEverywhere: boolean;
  /** No partial writes: indexer, outbox, and entitlement cache agree. */
  noPartialWrites: boolean;
  /** Domain invariants pass after rollback (entitlement/ledger zero-drift). */
  invariantsPass: boolean;
  /** No ledger/settlement drift vs. on-chain state. */
  noLedgerDrift: boolean;
}

export interface RollbackVerification {
  verified: boolean;
  failures: string[];
}

export function verifyRollback(evidence: RollbackEvidence): RollbackVerification {
  const failures: string[] = [];
  if (evidence.flagDisabledEverywhere !== true) failures.push("flag still enabled in at least one environment");
  if (evidence.noPartialWrites !== true) failures.push("partial writes detected (indexer/outbox/entitlement disagree)");
  if (evidence.invariantsPass !== true) failures.push("domain invariants failing after rollback");
  if (evidence.noLedgerDrift !== true) failures.push("ledger/settlement drift vs. on-chain state");
  return { verified: failures.length === 0, failures };
}
