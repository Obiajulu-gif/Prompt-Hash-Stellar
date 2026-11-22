import { describe, expect, it } from "vitest";
import {
  evaluateEmergencyDisable,
  evaluateRolloutGuard,
  verifyRollback,
} from "../services/flagRolloutGuard.js";

const healthy = { errorRate: 0.01, p1Incident: false, invariantViolations: 0 };

describe("flagRolloutGuard (issue #988)", () => {
  it("allows a scoped healthy rollout", () => {
    const d = evaluateRolloutGuard(
      { flag: "prompt_preview_markdown_sanitize_v2", scope: "marketplace", environment: "production", rolloutPercentage: 50 },
      healthy,
    );
    expect(d.allow).toBe(true);
    expect(d.requireRollback).toBe(false);
  });

  it("blocks and orders rollback when the error-rate ceiling is breached", () => {
    const d = evaluateRolloutGuard(
      { flag: "stellar_atomic_settlement", scope: "settlement", environment: "production", rolloutPercentage: 10 },
      { errorRate: 0.2, p1Incident: false, invariantViolations: 0 },
    );
    expect(d.allow).toBe(false);
    expect(d.requireRollback).toBe(true);
  });

  it("blocks any rollout during a P1 incident", () => {
    const d = evaluateRolloutGuard(
      { flag: "bulk_purchase_atomic_v2", scope: "marketplace", environment: "staging", rolloutPercentage: 25 },
      { ...healthy, p1Incident: true },
    );
    expect(d.allow).toBe(false);
    expect(d.requireRollback).toBe(true);
  });

  it("caps settlement/payout/global production ramps without staging soak", () => {
    const d = evaluateRolloutGuard(
      { flag: "payout_reconciliation_auto_resolve", scope: "payouts", environment: "production", rolloutPercentage: 100 },
      healthy,
    );
    expect(d.allow).toBe(false);
    expect(d.requireRollback).toBe(false);
  });

  it("rejects out-of-range percentages", () => {
    const d = evaluateRolloutGuard(
      { flag: "x", scope: "marketplace", environment: "development", rolloutPercentage: 101 },
      healthy,
    );
    expect(d.allow).toBe(false);
  });

  it("blocks malformed health values and refuses non-boolean rollback evidence", () => {
    const request = { flag: "x", scope: "marketplace", environment: "production", rolloutPercentage: 10 } as const;
    expect(evaluateRolloutGuard(request, { ...healthy, errorRate: NaN }).allow).toBe(false);
    expect(verifyRollback({
      flagDisabledEverywhere: true,
      noPartialWrites: "false" as unknown as boolean,
      invariantsPass: true,
      noLedgerDrift: true,
    }).verified).toBe(false);
  });

  it("verifies a clean rollback leaves no inconsistent state", () => {
    expect(
      verifyRollback({ flagDisabledEverywhere: true, noPartialWrites: true, invariantsPass: true, noLedgerDrift: true }).verified,
    ).toBe(true);
  });

  it("detects inconsistent state after rollback", () => {
    const v = verifyRollback({ flagDisabledEverywhere: false, noPartialWrites: true, invariantsPass: false, noLedgerDrift: true });
    expect(v.verified).toBe(false);
    expect(v.failures.join(" ")).toMatch(/still enabled|invariants/);
  });

  it("emergency disable succeeds for an authorized operator with a reason", () => {
    const d = evaluateEmergencyDisable({
      flag: "stellar_atomic_settlement",
      operatorId: "ops-1",
      operatorAuthorized: true,
      reason: "settlement exploit suspected",
    });
    expect(d.disable).toBe(true);
    expect(d.audited).toBe(true);
  });

  it("emergency disable is refused for unauthorized operators, missing reason, or missing operator", () => {
    const unauthorized = evaluateEmergencyDisable({
      flag: "x", operatorId: "ops-1", operatorAuthorized: false, reason: "incident",
    });
    expect(unauthorized.disable).toBe(false);
    expect(unauthorized.reasons.join(" ")).toMatch(/not authorized/);

    const noReason = evaluateEmergencyDisable({
      flag: "x", operatorId: "ops-1", operatorAuthorized: true, reason: "  ",
    });
    expect(noReason.disable).toBe(false);

    const noOperator = evaluateEmergencyDisable({
      flag: "x", operatorId: "", operatorAuthorized: true, reason: "incident",
    });
    expect(noOperator.disable).toBe(false);
  });
});
