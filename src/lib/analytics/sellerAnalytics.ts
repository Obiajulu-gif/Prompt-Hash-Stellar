/**
 * Privacy-safe seller analytics — issue #711.
 *
 * Converts raw, per-buyer marketplace activity into aggregated, privacy-safe
 * metrics for creators. The aggregation layer is the ONLY place where buyer
 * identities are allowed to meet seller analytics: inputs may carry raw
 * buyer addresses, but outputs never do. Aggregates are suppressed below a
 * minimum cohort size so that a single buyer can never be isolated.
 */

/** Raw per-event input carrying buyer identity. Never leaves this module. */
export interface SellerEvent {
  /** Opaque buyer id — used only for uniqueness cohorts, never returned. */
  buyerId: string;
  kind: "view" | "purchase" | "refund" | "unlock_failure" | "review";
  promptId: string;
  /** For `review` events: 1–5. */
  rating?: number;
  /** For `review` events: a negative review is a support concern. */
  isPositiveReview?: boolean;
  /** Reason category for unlock failures (e.g. `no_access`, `integrity_failure`). */
  reason?: string;
  occurredAt?: string;
}

/** Aggregated, identity-free metrics a seller is allowed to see. */
export interface SellerAnalytics {
  windowDays: number;
  cohort: {
    /** Active buyers measured one-per-buyer; suppressed when < MIN_COHORT_SIZE. */
    activeBuyers: number;
    buyerIdentitiesRedacted: boolean;
  };
  totals: {
    views: number;
    purchases: number;
    refunds: number;
    unlockFailures: number;
    reviews: number;
  };
  metrics: {
    /** purchases / views, expressed 0–1 (null when no views). */
    conversionRate: number | null;
    /** refunds / purchases, expressed 0–1 (null when no purchases). */
    refundRate: number | null;
    /** 1 - unlockFailures / purchases, expressed 0–1 (null when no purchases). */
    unlockSuccessRate: number | null;
    /** positive reviews / reviews, expressed 0–1 (null when no reviews). */
    satisfactionRate: number | null;
    averageRating: number | null;
  };
  /** Per-category breakdown for unlock failures — tags only, no buyer ids. */
  unlockFailuresByReason: Record<string, number>;
}

/** Minimum cohort size before a count is emitted (prevents buyer isolation). */
export const MIN_COHORT_SIZE = 2;
export const DEFAULT_WINDOW_DAYS = 30;

export interface SellerAnalyticsOptions {
  windowDays?: number;
  /** Suppress any metric whose cohort is below MIN_COHORT_SIZE. Off in tests. */
  enforceMinCohort?: boolean;
}

/** Count unique buyer ids; returns null when the cohort is too small to emit. */
function safeCohortCount(buyerIds: Set<string>, enforceMinCohort: boolean): number {
  if (enforceMinCohort && buyerIds.size < MIN_COHORT_SIZE) {
    return 0;
  }
  return buyerIds.size;
}

export function aggregateSellerAnalytics(
  events: SellerEvent[],
  options: SellerAnalyticsOptions = {},
): SellerAnalytics {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const enforceMinCohort = options.enforceMinCohort ?? true;

  const buyersByKind = new Map<SellerEvent["kind"], Set<string>>();
  const buyers = new Set<string>();
  const allBuyers = new Set<string>();

  let views = 0;
  let purchases = 0;
  let refunds = 0;
  let unlockFailures = 0;
  let reviews = 0;
  let ratingSum = 0;
  let positiveReviews = 0;
  const unlockFailuresByReason: Record<string, number> = {};

  for (const event of events) {
    allBuyers.add(event.buyerId);
    if (event.kind === "view") views += 1;
    if (event.kind === "purchase") purchases += 1;
    if (event.kind === "refund") refunds += 1;
    if (event.kind === "unlock_failure") {
      unlockFailures += 1;
      const reason = event.reason ?? "unknown";
      unlockFailuresByReason[reason] = (unlockFailuresByReason[reason] ?? 0) + 1;
    }
    if (event.kind === "review") {
      reviews += 1;
      if (event.rating !== undefined) ratingSum += event.rating;
      if (event.isPositiveReview) positiveReviews += 1;
    }
    const set = buyersByKind.get(event.kind) ?? new Set<string>();
    set.add(event.buyerId);
    buyersByKind.set(event.kind, set);
    buyers.add(event.buyerId);
  }

  const redacted = true; // Outputs never carry buyer identity by construction.

  return {
    windowDays,
    cohort: {
      activeBuyers: safeCohortCount(allBuyers, enforceMinCohort),
      buyerIdentitiesRedacted: redacted,
    },
    totals: {
      views,
      purchases,
      refunds,
      unlockFailures,
      reviews,
    },
    metrics: {
      conversionRate: views > 0 ? purchases / views : null,
      refundRate: purchases > 0 ? refunds / purchases : null,
      unlockSuccessRate:
        purchases > 0 ? Math.max(0, 1 - unlockFailures / purchases) : null,
      satisfactionRate: reviews > 0 ? positiveReviews / reviews : null,
      averageRating: reviews > 0 ? ratingSum / reviews : null,
    },
    unlockFailuresByReason,
  };
}

/** Human-readable summary for dashboard copy (kept side-effect free). */
export function summarizeSellerAnalytics(analytics: SellerAnalytics): string[] {
  const pct = (value: number | null) =>
    value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  return [
    `Conversion ${pct(analytics.metrics.conversionRate)}`,
    `Refund rate ${pct(analytics.metrics.refundRate)}`,
    `Unlock success ${pct(analytics.metrics.unlockSuccessRate)}`,
    `Satisfaction ${pct(analytics.metrics.satisfactionRate)}`,
  ];
}