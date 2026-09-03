import { describe, it, expect } from "vitest";
import {
  aggregateSellerAnalytics,
  MIN_COHORT_SIZE,
  type SellerEvent,
} from "./sellerAnalytics";

function sampleEvents(): SellerEvent[] {
  const buyers = ["GSSSBUYER1", "GSSSBUYER2", "GSSSBUYER3", "GSSSBUYER4"];
  const events: SellerEvent[] = [];
  for (const buyer of buyers) {
    events.push({ buyerId: buyer, kind: "view", promptId: "0" });
    events.push({ buyerId: buyer, kind: "view", promptId: "1" });
    events.push({ buyerId: buyer, kind: "purchase", promptId: "0" });
  }
  events.push({ buyerId: buyers[0], kind: "purchase", promptId: "1" });
  events.push({ buyerId: buyers[0], kind: "refund", promptId: "1" });
  events.push({ buyerId: buyers[0], kind: "unlock_failure", promptId: "0", reason: "no_access" });
  events.push({ buyerId: buyers[1], kind: "review", promptId: "0", rating: 5, isPositiveReview: true });
  events.push({ buyerId: buyers[2], kind: "review", promptId: "0", rating: 4, isPositiveReview: true });
  events.push({ buyerId: buyers[3], kind: "review", promptId: "0", rating: 2, isPositiveReview: false });
  return events;
}

describe("aggregateSellerAnalytics", () => {
  it("computes conversion, refund, and unlock-success rates accurately", () => {
    const analytics = aggregateSellerAnalytics(sampleEvents(), {
      enforceMinCohort: false,
    });

    // 8 views → 5 purchases across 4 buyers
    expect(analytics.totals.views).toBe(8);
    expect(analytics.totals.purchases).toBe(5);
    expect(analytics.totals.refunds).toBe(1);
    expect(analytics.totals.unlockFailures).toBe(1);
    expect(analytics.metrics.conversionRate).toBeCloseTo(5 / 8, 5);
    expect(analytics.metrics.refundRate).toBeCloseTo(1 / 5, 5);
    expect(analytics.metrics.unlockSuccessRate).toBeCloseTo(1 - 1 / 5, 5);
  });

  it("rolls review outcomes up into satisfaction and average rating", () => {
    const analytics = aggregateSellerAnalytics(sampleEvents(), {
      enforceMinCohort: false,
    });
    expect(analytics.totals.reviews).toBe(3);
    expect(analytics.metrics.averageRating).toBeCloseTo((5 + 4 + 2) / 3, 5);
    expect(analytics.metrics.satisfactionRate).toBeCloseTo(2 / 3, 5);
  });

  it("never leaks buyer identities in the output", () => {
    const analytics = aggregateSellerAnalytics(sampleEvents());
    const serialized = JSON.stringify(analytics);
    expect(serialized).not.toContain("GSSSBUYER1");
    expect(serialized).not.toContain("GSSSBUYER");
    expect(analytics.cohort.buyerIdentitiesRedacted).toBe(true);
  });

  it("suppresses active-buyer cohort counts below the privacy threshold", () => {
    const singleBuyer = aggregateSellerAnalytics(
      [
        { buyerId: "GOLONELY", kind: "view", promptId: "0" },
        { buyerId: "GOLONELY", kind: "purchase", promptId: "0" },
      ],
      { enforceMinCohort: true },
    );
    expect(singleBuyer.cohort.activeBuyers).toBe(0);

    const multiBuyer = aggregateSellerAnalytics(
      [
        { buyerId: "GA", kind: "view", promptId: "0" },
        { buyerId: "GB", kind: "view", promptId: "0" },
      ],
      { enforceMinCohort: true },
    );
    expect(multiBuyer.cohort.activeBuyers).toBe(MIN_COHORT_SIZE);
  });

  it("returns null rates when there is no denominator", () => {
    const analytics = aggregateSellerAnalytics([], { enforceMinCohort: false });
    expect(analytics.totals.views).toBe(0);
    expect(analytics.metrics.conversionRate).toBeNull();
    expect(analytics.metrics.refundRate).toBeNull();
    expect(analytics.metrics.unlockSuccessRate).toBeNull();
    expect(analytics.metrics.satisfactionRate).toBeNull();
  });

  it("groups unlock failures by reason without exposing buyers", () => {
    const analytics = aggregateSellerAnalytics(
      [
        { buyerId: "G1", kind: "unlock_failure", promptId: "0", reason: "no_access" },
        { buyerId: "G2", kind: "unlock_failure", promptId: "0", reason: "integrity_failure" },
        { buyerId: "G3", kind: "unlock_failure", promptId: "0", reason: "no_access" },
      ],
      { enforceMinCohort: false },
    );
    expect(analytics.unlockFailuresByReason).toEqual({
      no_access: 2,
      integrity_failure: 1,
    });
  });

  it("counts a single buyer once per cohort even across event kinds", () => {
    const analytics = aggregateSellerAnalytics(sampleEvents(), {
      enforceMinCohort: false,
    });
    // 4 distinct buyers participate across view/purchase/refund/unlock/review.
    expect(analytics.cohort.activeBuyers).toBe(4);
  });
});