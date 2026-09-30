import { describe, it, expect } from "vitest";
import { DomainInvariantsService } from "../services/domainInvariants";

describe("DomainInvariantsService (Issue #832)", () => {
  it("asserts INV-01: Non-negative price", () => {
    expect(DomainInvariantsService.assertPriceNonNegative(100n).passed).toBe(true);
    expect(DomainInvariantsService.assertPriceNonNegative(0).passed).toBe(true);
    expect(DomainInvariantsService.assertPriceNonNegative(-5).passed).toBe(false);
  });

  it("asserts INV-02: Self-purchase prohibited", () => {
    expect(DomainInvariantsService.assertNoSelfPurchase("creator_1", "buyer_2").passed).toBe(true);
    expect(DomainInvariantsService.assertNoSelfPurchase("creator_1", "CREATOR_1").passed).toBe(false);
  });

  it("asserts INV-03: Valid seller ownership prior to transfer", () => {
    expect(DomainInvariantsService.assertSellerOwnership("user_alice", "user_alice").passed).toBe(true);
    expect(DomainInvariantsService.assertSellerOwnership("user_alice", "user_bob").passed).toBe(false);
  });

  it("asserts INV-04: Exact payout split summation to 10,000 bps", () => {
    expect(DomainInvariantsService.assertExactPayoutSplit([8500, 1000, 500]).passed).toBe(true);
    expect(DomainInvariantsService.assertExactPayoutSplit([9000, 500]).passed).toBe(false);
    expect(DomainInvariantsService.assertExactPayoutSplit([10000, 100]).passed).toBe(false);
  });

  it("asserts INV-05: Valid lifecycle state transitions", () => {
    expect(DomainInvariantsService.assertValidLifecycleTransition("DRAFT", "PENDING_VERIFICATION").passed).toBe(true);
    expect(DomainInvariantsService.assertValidLifecycleTransition("PENDING_VERIFICATION", "PUBLISHED").passed).toBe(true);
    expect(DomainInvariantsService.assertValidLifecycleTransition("PUBLISHED", "ARCHIVED").passed).toBe(true);
    // Invalid jump from DRAFT to PUBLISHED directly without verification
    expect(DomainInvariantsService.assertValidLifecycleTransition("DRAFT", "PUBLISHED").passed).toBe(false);
  });

  it("asserts INV-06: Unique token ID across prompts", () => {
    const existing = new Set(["tok_101", "tok_102"]);
    expect(DomainInvariantsService.assertUniqueTokenId(existing, "tok_103").passed).toBe(true);
    expect(DomainInvariantsService.assertUniqueTokenId(existing, "tok_101").passed).toBe(false);
  });

  it("asserts INV-07: Escrow balance conservation", () => {
    expect(DomainInvariantsService.assertEscrowBalanceConservation(1000n, 900n, 100n).passed).toBe(true);
    expect(DomainInvariantsService.assertEscrowBalanceConservation(1000n, 950n, 100n).passed).toBe(false);
  });

  it("asserts INV-08: Rating score bounds and reviewer purchase verification", () => {
    expect(DomainInvariantsService.assertRatingAndReviewerEligibility(5, true).passed).toBe(true);
    expect(DomainInvariantsService.assertRatingAndReviewerEligibility(1, true).passed).toBe(true);
    expect(DomainInvariantsService.assertRatingAndReviewerEligibility(6, true).passed).toBe(false);
    expect(DomainInvariantsService.assertRatingAndReviewerEligibility(0, true).passed).toBe(false);
    expect(DomainInvariantsService.assertRatingAndReviewerEligibility(4.5, true).passed).toBe(false);
    expect(DomainInvariantsService.assertRatingAndReviewerEligibility(5, false).passed).toBe(false);
  });

  it("asserts INV-09: Quarantined prompts not listable", () => {
    expect(DomainInvariantsService.assertListableStatus(false, true).passed).toBe(true);
    expect(DomainInvariantsService.assertListableStatus(false, false).passed).toBe(true);
    expect(DomainInvariantsService.assertListableStatus(true, true).passed).toBe(false);
    expect(DomainInvariantsService.assertListableStatus(true, false).passed).toBe(true);
  });

  it("asserts INV-10: Entitlement integrity", () => {
    expect(DomainInvariantsService.assertEntitlementIntegrity(true, true, false).passed).toBe(true);
    expect(DomainInvariantsService.assertEntitlementIntegrity(true, false, true).passed).toBe(true);
    expect(DomainInvariantsService.assertEntitlementIntegrity(true, false, false).passed).toBe(false);
    expect(DomainInvariantsService.assertEntitlementIntegrity(false, false, false).passed).toBe(true);
  });
});
