import { describe, expect, it } from "vitest";
import {
  analyzeLifecycle,
  analyzeRawLifecycleEvents,
  hashSubject,
  normalizeLifecycleEvent,
  type LifecycleEvent,
  type RawLifecycleEvent,
} from "@/lib/analytics/lifecycleAnalytics";
import {
  LIFECYCLE_WORKFLOWS,
  sanitizeFailureReason,
  stageIds,
} from "@/lib/analytics/lifecycleStages";
import {
  ALL_EVENTS,
  AS_OF,
  FIXTURE_SALT,
  LIFECYCLE_GOLDEN as G,
  MIN,
  T0,
} from "./fixtures/lifecycleEvents";

const exact = { asOf: AS_OF, minCohort: 1, dropOffThreshold: 0.25 } as const;

function report(raw: RawLifecycleEvent[] = ALL_EVENTS, opts: Partial<Parameters<typeof analyzeRawLifecycleEvents>[2]> = {}) {
  return analyzeRawLifecycleEvents(raw, FIXTURE_SALT, { ...exact, ...opts });
}
const wf = (r: ReturnType<typeof report>, name: "purchase" | "publish") =>
  r.workflows.find((w) => w.workflow === name)!;

describe("stage catalogue", () => {
  it("defines ordered stages with a capture point for every one", () => {
    for (const def of Object.values(LIFECYCLE_WORKFLOWS)) {
      expect(def.stages.length).toBeGreaterThanOrEqual(3);
      for (const s of def.stages) {
        expect(s.capturePoint).toMatch(/^src\//);
        expect(s.id).toMatch(/^[a-z_]+$/);
      }
    }
    expect(stageIds("purchase")).toEqual([
      "detail_viewed",
      "purchase_started",
      "payment_confirmed",
      "unlock_succeeded",
    ]);
  });

  it("collapses unknown or free-text failure reasons to 'other'", () => {
    expect(sanitizeFailureReason("User_Rejected")).toBe("user_rejected");
    expect(sanitizeFailureReason("GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW")).toBe("other");
    expect(sanitizeFailureReason("failed for alice@example.com")).toBe("other");
    expect(sanitizeFailureReason(undefined)).toBe("other");
  });
});

describe("normalizeLifecycleEvent", () => {
  const base = { subject: "s1", workflow: "purchase", stage: "detail_viewed", at: T0 };

  it("hashes the subject and drops the raw id", () => {
    const r = normalizeLifecycleEvent(base, FIXTURE_SALT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.subjectHash).toBe(hashSubject("s1", FIXTURE_SALT));
      expect(JSON.stringify(r.event)).not.toContain('"s1"');
      expect(r.event.kind).toBe("reached");
    }
  });

  it("produces different hashes per salt and rejects weak salts", () => {
    expect(hashSubject("s1", FIXTURE_SALT)).not.toBe(hashSubject("s1", "another-salt-0123456789"));
    expect(() => hashSubject("s1", "short")).toThrow(/salt/);
  });

  it.each([
    [{ ...base, subject: "" }, "missing_subject"],
    [{ ...base, workflow: "nope" }, "unknown_workflow"],
    [{ ...base, stage: "nope" }, "unknown_stage"],
    [{ ...base, stage: "form_opened" }, "unknown_stage"], // stage of another workflow
    [{ ...base, kind: "weird" }, "invalid_kind"],
    [{ ...base, at: "not a date" }, "invalid_timestamp"],
  ])("rejects %j as %s", (raw, rejection) => {
    const r = normalizeLifecycleEvent(raw as RawLifecycleEvent, FIXTURE_SALT);
    expect(r).toEqual({ ok: false, rejection });
  });

  it("keeps only allow-listed reasons on failed events and no reason on reached", () => {
    const failed = normalizeLifecycleEvent({ ...base, kind: "failed", reason: "boom for bob@x.io" }, FIXTURE_SALT);
    const reached = normalizeLifecycleEvent({ ...base, reason: "user_rejected" }, FIXTURE_SALT);
    if (failed.ok) expect(failed.event.reason).toBe("other");
    if (reached.ok) expect(reached.event.reason).toBeUndefined();
  });
});

describe("analytics match the fixture (exact cohorts)", () => {
  const r = report();

  it("accepts every fixture event", () => {
    expect(r.quality).toEqual({ accepted: ALL_EVENTS.length, duplicates: 0, rejected: {} });
  });

  for (const name of ["purchase", "publish"] as const) {
    const g = G[name];
    describe(name, () => {
      const w = wf(r, name);

      it("journey totals", () => {
        expect({
          started: w.started,
          completed: w.completed,
          abandoned: w.abandoned,
          inProgress: w.inProgress,
          completionRate: w.completionRate,
          abandonRate: w.abandonRate,
        }).toEqual({
          started: g.started,
          completed: g.completed,
          abandoned: g.abandoned,
          inProgress: g.inProgress,
          completionRate: g.completionRate,
          abandonRate: g.abandonRate,
        });
        expect((w.completed as number) + (w.abandoned as number) + (w.inProgress as number)).toBe(g.started);
      });

      it("recovery", () => {
        expect(w.journeysWithFailure).toBe(g.journeysWithFailure);
        expect(w.recovered).toBe(g.recovered);
        expect(w.recoveryRate).toBe(g.recoveryRate);
      });

      it("per-stage funnel", () => {
        expect(w.stages.map((s) => s.reached)).toEqual(g.reached);
        expect(w.stages.map((s) => s.conversionFromPrevious)).toEqual(g.conversionFromPrevious);
        expect(w.stages.map((s) => s.abandonedHere)).toEqual(g.abandonedHere);
        expect(w.stages.map((s) => s.dropOffRate)).toEqual(g.dropOffRate);
        expect(w.stages.map((s) => s.failedAttempts)).toEqual(g.failedAttempts);
      });

      it("timing and data quality", () => {
        expect(w.medianMsToComplete).toBe(g.medianMsToComplete);
        expect(w.gapJourneys).toBe(g.gapJourneys);
      });

      it("identifies the primary drop-off stage", () => {
        expect(w.primaryDropOff).toBe(g.primaryDropOff);
      });
    });
  }

  it("computes median time between stages", () => {
    expect(wf(r, "purchase").stages.map((s) => s.medianMsFromPrevious)).toEqual(G.purchase.medianMsFromPrevious);
  });

  it("flags stages at or above the drop-off threshold, worst first", () => {
    expect(wf(r, "publish").dropOffStages).toEqual(G.publish.dropOffStages);
    expect(wf(r, "purchase").dropOffStages).toEqual([]);
    const lower = wf(report(ALL_EVENTS, { dropOffThreshold: 0.11 }), "purchase");
    expect(lower.dropOffStages).toEqual(["detail_viewed", "payment_confirmed", "purchase_started"]);
  });

  it("attributes a paid-but-failed unlock to payment_confirmed, not to a user who never paid", () => {
    const stage = wf(r, "purchase").stages.find((s) => s.stage === "payment_confirmed")!;
    expect(stage.abandonedHere).toBe(1);
  });

  it("reports failure reasons per stage, ordered by count then name", () => {
    const w = wf(r, "purchase");
    const reasons = (name: string) => w.stages.find((s) => s.stage === name)!.topFailureReasons;
    expect(reasons("purchase_started")).toEqual([
      { reason: "tx_network_error", count: 1 },
      { reason: "user_rejected", count: 1 },
    ]);
    expect(reasons("unlock_succeeded")).toEqual([
      { reason: "unlock_integrity_failed", count: 1 },
      { reason: "unlock_rate_limited", count: 1 },
    ]);
    expect(reasons("detail_viewed")).toEqual([]);
  });
});

describe("failure reasons with a real cohort", () => {
  it("lists reasons that meet the cohort and folds rarer ones away", () => {
    const events: RawLifecycleEvent[] = [];
    for (let i = 0; i < 6; i++) {
      events.push({ subject: `a${i}`, workflow: "purchase", stage: "detail_viewed", at: T0 + i * 1000 });
      events.push({ subject: `a${i}`, workflow: "purchase", stage: "purchase_started", at: T0 + i * 1000 + 10 });
      events.push({
        subject: `a${i}`,
        workflow: "purchase",
        stage: "purchase_started",
        kind: "failed",
        reason: i < 5 ? "tx_network_error" : "offline",
        at: T0 + i * 1000 + 20,
      });
    }
    const w = wf(report(events, { minCohort: 5 }), "purchase");
    const stage = w.stages.find((s) => s.stage === "purchase_started")!;
    expect(stage.topFailureReasons).toEqual([{ reason: "tx_network_error", count: 5 }]);
    expect(stage.failedAttempts).toBe(6);
  });
});

describe("abandonment boundary", () => {
  const ev = (at: number): RawLifecycleEvent[] => [{ subject: "x", workflow: "purchase", stage: "detail_viewed", at }];

  it("is in progress just under the idle threshold and abandoned exactly at it", () => {
    const under = wf(report(ev(AS_OF - 30 * MIN + 1)), "purchase");
    expect([under.abandoned, under.inProgress]).toEqual([0, 1]);
    const at = wf(report(ev(AS_OF - 30 * MIN)), "purchase");
    expect([at.abandoned, at.inProgress]).toEqual([1, 0]);
  });

  it("honours a custom idle threshold", () => {
    const w = wf(report(ev(AS_OF - 10 * MIN), { abandonAfterMs: 5 * MIN }), "purchase");
    expect(w.abandoned).toBe(1);
  });
});

describe("privacy", () => {
  it("never exposes subject ids or hashes in the report", () => {
    const json = JSON.stringify(report());
    for (const e of ALL_EVENTS) {
      expect(json).not.toContain(e.subject);
      expect(json).not.toContain(hashSubject(e.subject, FIXTURE_SALT));
    }
    expect(json).not.toMatch(/"(subject|subjectHash|wallet|address|email)"/i);
  });

  it("suppresses small cohorts (k-anonymity) and hides drop-off that would single out users", () => {
    const w = wf(report(ALL_EVENTS, { minCohort: 5 }), "purchase");
    // Large cells survive.
    expect(w.started).toBe(12);
    expect(w.completed).toBe(7);
    expect(w.stages.map((s) => s.reached)).toEqual([12, 9, 8, 7]);
    // Cells of 1..4 are suppressed.
    expect(w.abandoned).toBeNull();
    expect(w.inProgress).toBeNull();
    expect(w.recovered).toBeNull();
    expect(w.recoveryRate).toBeNull();
    expect(w.stages.map((s) => s.abandonedHere)).toEqual([null, null, null, 0]);
    expect(w.stages.map((s) => s.dropOffRate)).toEqual([null, null, null, 0]);
    expect(w.stages.map((s) => s.failedAttempts)).toEqual([0, null, 0, null]);
    expect(w.dropOffStages).toEqual([]);
    expect(w.primaryDropOff).toBeNull();
    expect(w.medianMsToComplete).toBe(4 * MIN); // 7 completers ≥ k
  });

  it("suppresses medians computed from fewer than k journeys", () => {
    const w = wf(report(ALL_EVENTS, { minCohort: 6 }), "publish");
    expect(w.medianMsToComplete).toBeNull();
  });

  it("defaults to a minimum cohort of 5", () => {
    const r = analyzeRawLifecycleEvents(ALL_EVENTS, FIXTURE_SALT, { asOf: AS_OF });
    expect(r.params.minCohort).toBe(5);
    expect(wf(r, "publish").abandoned).toBeNull();
  });

  it("rounds published counts and derives rates from the rounded values", () => {
    const w = wf(report(ALL_EVENTS, { roundTo: 5 }), "purchase");
    expect(w.started).toBe(10); // 12 → 10
    expect(w.completed).toBe(5); // 7 → 5
    expect(w.completionRate).toBe(0.5); // 5/10, not 7/12
  });
});

describe("determinism and robustness", () => {
  it("is independent of input order", () => {
    const shuffled = [...ALL_EVENTS].reverse();
    const interleaved = [...ALL_EVENTS].sort((a, b) => (a.subject < b.subject ? 1 : -1));
    const base = JSON.stringify(report());
    expect(JSON.stringify(report(shuffled))).toBe(base);
    expect(JSON.stringify(report(interleaved))).toBe(base);
  });

  it("is byte-identical across repeated runs", () => {
    expect(JSON.stringify(report())).toBe(JSON.stringify(report()));
  });

  it("is idempotent when events are delivered twice (retried beacons)", () => {
    const doubled = report([...ALL_EVENTS, ...ALL_EVENTS]);
    expect(doubled.quality.duplicates).toBe(ALL_EVENTS.length);
    expect(doubled.workflows).toEqual(report().workflows);
  });

  it("rejects events from the future instead of counting them", () => {
    const future: RawLifecycleEvent = {
      subject: "z",
      workflow: "purchase",
      stage: "detail_viewed",
      at: AS_OF + 60 * MIN,
    };
    const r = report([...ALL_EVENTS, future]);
    expect(r.quality.rejected.future_timestamp).toBe(1);
    expect(wf(r, "purchase").started).toBe(G.purchase.started);
  });

  it("tallies malformed events in quality.rejected without failing the run", () => {
    const r = report([
      ...ALL_EVENTS,
      { subject: "", workflow: "purchase", stage: "detail_viewed", at: T0 },
      { subject: "q", workflow: "nope", stage: "x", at: T0 },
      { subject: "q", workflow: "purchase", stage: "nope", at: T0 },
    ]);
    expect(r.quality.rejected).toEqual({ missing_subject: 1, unknown_workflow: 1, unknown_stage: 1 });
    expect(wf(r, "purchase").started).toBe(G.purchase.started);
  });

  it("honours the since filter", () => {
    const r = report(ALL_EVENTS, { since: T0 + 7 * 60 * MIN });
    expect(wf(r, "purchase").started).toBeLessThan(G.purchase.started);
  });

  it("returns zeroed, rate-less workflows for empty input without dividing by zero", () => {
    const r = analyzeLifecycle([], { asOf: AS_OF, minCohort: 1 });
    for (const w of r.workflows) {
      expect(w.started).toBe(0);
      expect(w.completionRate).toBeNull();
      expect(w.primaryDropOff).toBeNull();
      expect(w.stages.every((s) => s.reached === 0 && s.dropOffRate === null)).toBe(true);
    }
  });

  it("handles a journey that only has failures (no reached events)", () => {
    const only: LifecycleEvent[] = [
      {
        subjectHash: "h1",
        workflow: "purchase",
        stage: "payment_confirmed",
        kind: "failed",
        at: T0,
        reason: "tx_network_error",
      },
    ];
    const w = analyzeLifecycle(only, { asOf: AS_OF, minCohort: 1 }).workflows[0];
    // Failing at payment_confirmed implies the buyer reached purchase_started.
    expect(w.started).toBe(1);
    expect(w.stages.map((s) => s.reached)).toEqual([1, 1, 0, 0]);
    expect(w.stages[1].abandonedHere).toBe(1);
    expect(w.gapJourneys).toBe(1);
  });
});
