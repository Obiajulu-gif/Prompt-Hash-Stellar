import { describe, expect, it, vi } from "vitest";
import {
  AbuseActivityLedger,
  AbuseReviewQueue,
  DEFAULT_RISK_THRESHOLDS,
  assessRisk,
  degradedAssessment,
  effectiveDecision,
  evaluateOperation,
  parseRiskMode,
  type OperationContext,
  type RecentActivity,
  type SubjectHistory,
} from "../services/abuseRiskScoring.js";

vi.mock("../services/auditTrail", () => ({ recordAuditEvent: vi.fn() }));

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const quiet: RecentActivity = {
  operationsInWindow: 1,
  failedStreak: 0,
  distinctIpsInWindow: 1,
  sameTargetInWindow: 1,
};
const veteran: SubjectHistory = {
  firstSeenAt: NOW - 60 * DAY,
  completedOperations: 25,
  disputedOperations: 0,
  typicalAmount: 20,
};
const newcomer: SubjectHistory = { completedOperations: 0, disputedOperations: 0 };

function ctx(over: Partial<OperationContext> = {}): OperationContext {
  return { operation: "purchase", wallet: WALLET, target: "p1", amount: 10, now: NOW, ...over };
}

describe("assessRisk", () => {
  it("allows ordinary low-risk use with a score of zero", () => {
    const a = assessRisk(ctx(), veteran, quiet);
    expect(a.decision).toBe("allow");
    expect(a.score).toBe(0);
    expect(a.signals).toEqual([]);
  });

  it("does not challenge a brand-new wallet making a small purchase", () => {
    const a = assessRisk(ctx({ amount: 5 }), newcomer, quiet);
    expect(a.decision).toBe("allow");
  });

  it("is deterministic for identical input", () => {
    const recent = { ...quiet, operationsInWindow: 20 };
    expect(assessRisk(ctx(), veteran, recent)).toEqual(assessRisk(ctx(), veteran, recent));
  });

  it("explains every fired signal with observed value, threshold and text", () => {
    const a = assessRisk(ctx(), veteran, { ...quiet, operationsInWindow: 12 });
    const velocity = a.signals.find((s) => s.code === "velocity_burst")!;
    expect(velocity.observed).toBe(12);
    expect(velocity.threshold).toBe(DEFAULT_RISK_THRESHOLDS.maxOperationsInWindow);
    expect(velocity.explanation).toContain("12");
    expect(a.summary).toContain("velocity_burst");
  });

  it("caps a single signal at step_up even when its points are large", () => {
    const a = assessRisk(ctx({ operation: "payout_request" }), newcomer, {
      ...quiet,
      operationsInWindow: 60,
    });
    expect(a.signals).toHaveLength(1);
    expect(a.decision).toBe("step_up");
  });

  it("requires step-up for a moderately suspicious burst on a high-impact op", () => {
    const a = assessRisk(ctx({ operation: "payout_request" }), newcomer, {
      ...quiet,
      operationsInWindow: 14,
    });
    expect(a.decision).toBe("step_up");
  });

  it("routes corroborated signals to review", () => {
    const a = assessRisk(
      ctx({ operation: "payout_request", amount: 900 }),
      newcomer,
      { ...quiet, operationsInWindow: 20, failedStreak: 5, distinctIpsInWindow: 6 },
    );
    expect(a.signals.length).toBeGreaterThanOrEqual(3);
    expect(a.decision).toBe("review");
  });

  it("blocks only with corroboration including a critical signal", () => {
    const a = assessRisk(
      ctx({ operation: "ownership_transfer", counterparty: OTHER, amount: 900 }),
      newcomer,
      {
        ...quiet,
        operationsInWindow: 30,
        failedStreak: 6,
        distinctIpsInWindow: 8,
        counterpartyFirstSeenAt: NOW - 60_000,
      },
    );
    expect(a.signals.some((s) => s.critical)).toBe(true);
    expect(a.decision).toBe("block");
  });

  it("never blocks on non-critical signals alone", () => {
    const a = assessRisk(
      ctx({ operation: "payout_request", amount: 900 }),
      newcomer,
      { ...quiet, operationsInWindow: 100, failedStreak: 20, distinctIpsInWindow: 30, sameTargetInWindow: 40 },
    );
    expect(a.signals.some((s) => s.critical)).toBe(false);
    expect(a.decision).not.toBe("block");
  });

  it("flags self-dealing as a critical signal", () => {
    const a = assessRisk(ctx({ counterparty: WALLET }), veteran, quiet);
    expect(a.signals.map((s) => s.code)).toContain("self_dealing");
    expect(a.signals[0].critical).toBe(true);
  });

  it("flags an amount spike only with enough history", () => {
    const spike = assessRisk(ctx({ amount: 400 }), veteran, quiet);
    expect(spike.signals.map((s) => s.code)).toContain("amount_spike");
    const thin = assessRisk(ctx({ amount: 400 }), { ...veteran, completedOperations: 1 }, quiet);
    expect(thin.signals.map((s) => s.code)).not.toContain("amount_spike");
  });

  it("flags dispute history above the ratio limit", () => {
    const a = assessRisk(
      ctx(),
      { ...veteran, completedOperations: 6, disputedOperations: 4 },
      quiet,
    );
    expect(a.signals.map((s) => s.code)).toContain("dispute_history");
  });

  it("applies a bounded trust credit for established clean history", () => {
    const recent = { ...quiet, operationsInWindow: 10 };
    const trusted = assessRisk(ctx(), veteran, recent);
    const fresh = assessRisk(ctx(), newcomer, recent);
    expect(trusted.score).toBeLessThan(fresh.score);
    expect(trusted.trustCredit).toBeLessThanOrEqual(DEFAULT_RISK_THRESHOLDS.maxTrustCredit);
  });

  it("does not let trust fully cancel a critical signal", () => {
    const a = assessRisk(ctx({ counterparty: WALLET }), veteran, quiet);
    expect(a.score).toBeGreaterThan(0);
  });

  it("weights low-impact unlocks below payouts for the same signals", () => {
    const recent = { ...quiet, operationsInWindow: 14 };
    const unlock = assessRisk(ctx({ operation: "unlock" }), newcomer, recent);
    const payout = assessRisk(ctx({ operation: "payout_request" }), newcomer, recent);
    expect(unlock.score).toBeLessThan(payout.score);
  });
});

describe("modes and degradation", () => {
  it("parses modes and defaults to shadow", () => {
    expect(parseRiskMode("ENFORCE")).toBe("enforce");
    expect(parseRiskMode("off")).toBe("off");
    expect(parseRiskMode(undefined)).toBe("shadow");
    expect(parseRiskMode("garbage")).toBe("shadow");
  });

  it("only enforces decisions in enforce mode", () => {
    expect(effectiveDecision("shadow", "block")).toBe("allow");
    expect(effectiveDecision("off", "review")).toBe("allow");
    expect(effectiveDecision("enforce", "review")).toBe("review");
  });

  it("fails open for low-impact and closed for money-out operations", () => {
    expect(degradedAssessment("unlock", "store down").decision).toBe("allow");
    expect(degradedAssessment("payout_request", "store down").decision).toBe("step_up");
    expect(degradedAssessment("ownership_transfer", "store down").decision).toBe("step_up");
  });

  it("degrades instead of throwing when the ledger fails", () => {
    const broken = new AbuseActivityLedger();
    broken.history = () => {
      throw new Error("boom");
    };
    const out = evaluateOperation(ctx({ operation: "payout_request" }), "enforce", {
      ledger: broken,
      queue: new AbuseReviewQueue(),
    });
    expect(out.assessment.decision).toBe("step_up");
    expect(out.assessment.summary).toContain("boom");
  });
});

describe("AbuseActivityLedger", () => {
  it("tracks velocity, failed streak, IP fan-out and repeat targets within the window", () => {
    const ledger = new AbuseActivityLedger();
    for (let i = 0; i < 5; i++) {
      ledger.record(ctx({ now: NOW + i * 1000, ip: `10.0.0.${i}`, target: "same" }), false);
    }
    const recent = ledger.recent(ctx({ now: NOW + 6000, target: "same" }));
    expect(recent.operationsInWindow).toBe(5);
    expect(recent.failedStreak).toBe(5);
    expect(recent.distinctIpsInWindow).toBe(5);
    expect(recent.sameTargetInWindow).toBe(5);
  });

  it("ages events out of the window and resets the streak on success", () => {
    const ledger = new AbuseActivityLedger();
    ledger.record(ctx({ now: NOW }), false);
    ledger.record(ctx({ now: NOW + 1 }), true);
    expect(ledger.recent(ctx({ now: NOW + 2 })).failedStreak).toBe(0);
    expect(ledger.recent(ctx({ now: NOW + HOUR })).operationsInWindow).toBe(0);
  });

  it("stores only hashes and supports reset (false-positive recovery)", () => {
    const ledger = new AbuseActivityLedger();
    ledger.record(ctx(), true);
    expect(JSON.stringify([...(ledger as any).subjects.keys()])).not.toContain(WALLET);
    expect(ledger.history(WALLET).completedOperations).toBe(1);
    ledger.reset(WALLET);
    expect(ledger.history(WALLET).completedOperations).toBe(0);
  });

  it("caps the number of tracked subjects", () => {
    const ledger = new AbuseActivityLedger({ maxSubjects: 2 });
    ledger.record(ctx({ wallet: "A" }), true);
    ledger.record(ctx({ wallet: "B" }), true);
    ledger.record(ctx({ wallet: "C" }), true);
    expect(ledger.size).toBe(2);
  });
});

describe("evaluateOperation + review queue", () => {
  function hotLedger(): AbuseActivityLedger {
    const ledger = new AbuseActivityLedger();
    for (let i = 0; i < 25; i++) {
      ledger.record(ctx({ operation: "payout_request", now: NOW + i, ip: `1.1.1.${i}` }), false);
    }
    return ledger;
  }
  const risky = ctx({ operation: "payout_request", amount: 900, now: NOW + 100 });

  it("enqueues review items and enforces a hold in enforce mode", () => {
    const queue = new AbuseReviewQueue();
    const out = evaluateOperation(risky, "enforce", { ledger: hotLedger(), queue });
    expect(out.assessment.decision).toBe("review");
    expect(out.action).toBe("review");
    expect(queue.list("pending")).toHaveLength(1);
    expect(out.reviewId).toBe(queue.list("pending")[0].id);
  });

  it("records but does not enforce in shadow mode", () => {
    const queue = new AbuseReviewQueue();
    const out = evaluateOperation(risky, "shadow", { ledger: hotLedger(), queue });
    expect(out.assessment.decision).toBe("review");
    expect(out.action).toBe("allow");
    expect(queue.list("pending")).toHaveLength(1);
  });

  it("de-duplicates pending reviews for the same subject, operation and target", () => {
    const queue = new AbuseReviewQueue();
    const ledger = hotLedger();
    evaluateOperation(risky, "enforce", { ledger, queue });
    evaluateOperation(risky, "enforce", { ledger, queue });
    expect(queue.list("pending")).toHaveLength(1);
  });

  it("releases exactly one held operation after approval", () => {
    const queue = new AbuseReviewQueue();
    const ledger = hotLedger();
    const first = evaluateOperation(risky, "enforce", { ledger, queue });
    queue.resolve(first.reviewId!, "approved", "admin-1", "verified with creator");

    const released = evaluateOperation(risky, "enforce", { ledger, queue });
    expect(released.releasedByReview).toBe(true);
    expect(released.action).toBe("allow");

    const again = evaluateOperation(risky, "enforce", { ledger, queue });
    expect(again.releasedByReview).toBe(false);
    expect(again.action).toBe("review");
  });

  it("keeps a rejected review blocking and cannot re-resolve a closed item", () => {
    const queue = new AbuseReviewQueue();
    const first = evaluateOperation(risky, "enforce", { ledger: hotLedger(), queue });
    expect(queue.resolve(first.reviewId!, "rejected", "admin-1")?.status).toBe("rejected");
    expect(queue.resolve(first.reviewId!, "approved", "admin-2")).toBeUndefined();
  });

  it("does not enqueue anything for ordinary traffic", () => {
    const queue = new AbuseReviewQueue();
    const out = evaluateOperation(ctx(), "enforce", { ledger: new AbuseActivityLedger(), queue });
    expect(out.action).toBe("allow");
    expect(queue.list()).toHaveLength(0);
  });
});
