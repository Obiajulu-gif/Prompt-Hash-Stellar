/**
 * Deterministic lifecycle event fixture with hand-computed expectations.
 *
 * Every journey is described in the comments next to it so the golden numbers
 * in LIFECYCLE_GOLDEN can be re-derived by reading, not by running the code.
 */

import type { RawLifecycleEvent } from "@/lib/analytics/lifecycleAnalytics";

export const FIXTURE_SALT = "fixture-salt-0123456789";
export const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);
export const MIN = 60_000;
export const AS_OF = T0 + 24 * 60 * MIN;

type Step = [minute: number, stage: string, kind?: "reached" | "failed", reason?: string];

function journey(subject: string, workflow: string, base: number, steps: Step[]): RawLifecycleEvent[] {
  return steps.map(([minute, stage, kind = "reached", reason]) => ({
    subject,
    workflow,
    stage,
    kind,
    at: base + minute * MIN,
    ...(reason ? { reason } : {}),
  }));
}

const hour = (i: number) => T0 + i * 60 * MIN;

/** Purchase: 12 journeys. */
export const PURCHASE_EVENTS: RawLifecycleEvent[] = [
  // u01–u05: straight through, 4 minutes end to end.
  ...[1, 2, 3, 4, 5].flatMap((i) =>
    journey(`u0${i}`, "purchase", hour(i), [
      [0, "detail_viewed"],
      [1, "purchase_started"],
      [3, "payment_confirmed"],
      [4, "unlock_succeeded"],
    ]),
  ),
  // u06: network error at purchase, retries, completes in 6 min (recovered).
  ...journey("u06", "purchase", hour(6), [
    [0, "detail_viewed"],
    [1, "purchase_started"],
    [2, "purchase_started", "failed", "tx_network_error"],
    [3, "purchase_started"],
    [5, "payment_confirmed"],
    [6, "unlock_succeeded"],
  ]),
  // u07: unlock rate limited once, then succeeds at minute 7 (recovered).
  ...journey("u07", "purchase", hour(7), [
    [0, "detail_viewed"],
    [1, "purchase_started"],
    [3, "payment_confirmed"],
    [4, "unlock_succeeded", "failed", "unlock_rate_limited"],
    [7, "unlock_succeeded"],
  ]),
  // u08, u09: look and leave (abandoned at detail_viewed).
  ...journey("u08", "purchase", hour(8), [[0, "detail_viewed"]]),
  ...journey("u09", "purchase", hour(9), [[0, "detail_viewed"]]),
  // u10: rejects the wallet prompt (abandoned at purchase_started).
  ...journey("u10", "purchase", hour(10), [
    [0, "detail_viewed"],
    [1, "purchase_started"],
    [2, "purchase_started", "failed", "user_rejected"],
  ]),
  // u11: paid, unlock failed, never came back (abandoned at payment_confirmed).
  ...journey("u11", "purchase", hour(11), [
    [0, "detail_viewed"],
    [1, "purchase_started"],
    [3, "payment_confirmed"],
    [4, "unlock_succeeded", "failed", "unlock_integrity_failed"],
  ]),
  // u12: viewed 5 minutes before asOf (still in progress, not abandoned).
  ...journey("u12", "purchase", AS_OF - 5 * MIN, [[0, "detail_viewed"]]),
];

/** Publish: 8 journeys. */
export const PUBLISH_EVENTS: RawLifecycleEvent[] = [
  // p01–p03: complete in 6 minutes.
  ...[1, 2, 3].flatMap((i) =>
    journey(`p0${i}`, "publish", hour(i), [
      [0, "form_opened"],
      [5, "publish_submitted"],
      [6, "publish_confirmed"],
    ]),
  ),
  // p04: confirmation timeout, retried, completes in 8 min (recovered).
  ...journey("p04", "publish", hour(4), [
    [0, "form_opened"],
    [3, "publish_submitted"],
    [4, "publish_confirmed", "failed", "tx_confirmation_timeout"],
    [8, "publish_confirmed"],
  ]),
  // p05: opened and left (abandoned at form_opened).
  ...journey("p05", "publish", hour(5), [[0, "form_opened"]]),
  // p06: blocked by validation, left (abandoned at form_opened).
  ...journey("p06", "publish", hour(6), [
    [0, "form_opened"],
    [2, "publish_submitted", "failed", "validation_error"],
  ]),
  // p07: submitted, wallet rejected confirmation (abandoned at publish_submitted).
  ...journey("p07", "publish", hour(7), [
    [0, "form_opened"],
    [2, "publish_submitted"],
    [3, "publish_confirmed", "failed", "user_rejected"],
  ]),
  // p08: form_opened event was lost; completes in 2 min (gap journey).
  ...journey("p08", "publish", hour(8), [
    [0, "publish_submitted"],
    [2, "publish_confirmed"],
  ]),
];

export const ALL_EVENTS: RawLifecycleEvent[] = [...PURCHASE_EVENTS, ...PUBLISH_EVENTS];

/** Exact (minCohort=1) results derivable from the journeys above. */
export const LIFECYCLE_GOLDEN = {
  purchase: {
    started: 12,
    completed: 7, // u01–u07
    abandoned: 4, // u08, u09, u10, u11
    inProgress: 1, // u12
    completionRate: 0.5833, // 7/12
    abandonRate: 0.3333, // 4/12
    journeysWithFailure: 4, // u06, u07, u10, u11
    recovered: 2, // u06, u07
    recoveryRate: 0.5,
    medianMsToComplete: 4 * MIN, // [4,4,4,4,4,6,7]
    gapJourneys: 0,
    reached: [12, 9, 8, 7],
    conversionFromPrevious: [1, 0.75, 0.8889, 0.875],
    abandonedHere: [2, 1, 1, 0],
    dropOffRate: [0.1667, 0.1111, 0.125, 0],
    failedAttempts: [0, 2, 0, 2],
    medianMsFromPrevious: [null, 1 * MIN, 2 * MIN, 1 * MIN],
    primaryDropOff: "detail_viewed",
  },
  publish: {
    started: 8,
    completed: 5, // p01–p04, p08
    abandoned: 3, // p05, p06, p07
    inProgress: 0,
    completionRate: 0.625,
    abandonRate: 0.375,
    journeysWithFailure: 3, // p04, p06, p07
    recovered: 1, // p04
    recoveryRate: 0.3333,
    medianMsToComplete: 6 * MIN, // [2,6,6,6,8]
    gapJourneys: 1, // p08
    reached: [8, 6, 5],
    conversionFromPrevious: [1, 0.75, 0.8333],
    abandonedHere: [2, 1, 0],
    dropOffRate: [0.25, 0.1667, 0],
    failedAttempts: [0, 1, 2],
    dropOffStages: ["form_opened"],
    primaryDropOff: "form_opened",
  },
} as const;
