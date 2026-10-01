export interface InvariantResult {
  invariantId: string;
  name: string;
  passed: boolean;
  message?: string;
  context?: Record<string, unknown>;
}

export const DOMAIN_INVARIANTS = {
  INV_01_NON_NEGATIVE_PRICE: "INV-01: Price must be non-negative and within valid limits",
  INV_02_NO_SELF_PURCHASE: "INV-02: Creator/seller cannot purchase their own listed prompt",
  INV_03_VALID_OWNERSHIP_ON_SALE: "INV-03: Prompt transfer requires verified ownership prior to sale",
  INV_04_EXACT_PAYOUT_SPLIT: "INV-04: Royalty and payout shares must sum exactly to 10,000 basis points (100%)",
  INV_05_VALID_LIFECYCLE_TRANSITION: "INV-05: Prompt lifecycle state transitions must follow legal directed graph",
  INV_06_UNIQUE_TOKEN_ID: "INV-06: On-chain token/NFT IDs must be globally unique across prompts",
  INV_07_ESCROW_BALANCE_CONSERVATION: "INV-07: Escrowed balance must equal pending payouts plus platform fee allocations",
  INV_08_RATING_BOUNDS_AND_BUYER_ELIGIBILITY: "INV-08: Rating score must be between 1 and 5 and reviewer must hold purchase entitlement",
  INV_09_QUARANTINED_PROMPTS_NOT_LISTABLE: "INV-09: Quarantined or flagged prompts cannot be listed or purchased",
  INV_10_ENTITLEMENT_INTEGRITY: "INV-10: User entitlement must trace to a verified purchase or author ownership",
};

export class DomainInvariantsService {
  /**
   * INV-01: Price validation
   */
  static assertPriceNonNegative(priceStroops: number | bigint): InvariantResult {
    const price = typeof priceStroops === "bigint" ? priceStroops : BigInt(priceStroops);
    const passed = price >= 0n;
    return {
      invariantId: "INV-01",
      name: DOMAIN_INVARIANTS.INV_01_NON_NEGATIVE_PRICE,
      passed,
      message: passed ? undefined : `Negative price is strictly impossible: ${price}`,
      context: { priceStroops: price.toString() },
    };
  }

  /**
   * INV-02: Self-purchase prevention
   */
  static assertNoSelfPurchase(sellerId: string, buyerId: string): InvariantResult {
    const passed = sellerId.trim().toLowerCase() !== buyerId.trim().toLowerCase();
    return {
      invariantId: "INV-02",
      name: DOMAIN_INVARIANTS.INV_02_NO_SELF_PURCHASE,
      passed,
      message: passed ? undefined : `Seller cannot purchase their own item: seller=${sellerId}, buyer=${buyerId}`,
      context: { sellerId, buyerId },
    };
  }

  /**
   * INV-03: Valid seller ownership
   */
  static assertSellerOwnership(currentOwnerId: string, sellerId: string): InvariantResult {
    const passed = currentOwnerId.trim().toLowerCase() === sellerId.trim().toLowerCase();
    return {
      invariantId: "INV-03",
      name: DOMAIN_INVARIANTS.INV_03_VALID_OWNERSHIP_ON_SALE,
      passed,
      message: passed ? undefined : `Seller ${sellerId} does not own prompt currently owned by ${currentOwnerId}`,
      context: { currentOwnerId, sellerId },
    };
  }

  /**
   * INV-04: Payout split sum in basis points (10000 bps = 100%)
   */
  static assertExactPayoutSplit(splitsBasisPoints: number[]): InvariantResult {
    const sum = splitsBasisPoints.reduce((acc, val) => acc + val, 0);
    const passed = sum === 10000;
    return {
      invariantId: "INV-04",
      name: DOMAIN_INVARIANTS.INV_04_EXACT_PAYOUT_SPLIT,
      passed,
      message: passed ? undefined : `Payout splits must total 10000 basis points; received: ${sum}`,
      context: { splitsBasisPoints, sum },
    };
  }

  /**
   * INV-05: Lifecycle transitions
   */
  static assertValidLifecycleTransition(
    currentState: "DRAFT" | "PENDING_VERIFICATION" | "PUBLISHED" | "ARCHIVED" | "QUARANTINED",
    nextState: "DRAFT" | "PENDING_VERIFICATION" | "PUBLISHED" | "ARCHIVED" | "QUARANTINED"
  ): InvariantResult {
    const validTransitions: Record<string, string[]> = {
      DRAFT: ["PENDING_VERIFICATION", "ARCHIVED"],
      PENDING_VERIFICATION: ["PUBLISHED", "DRAFT", "QUARANTINED"],
      PUBLISHED: ["ARCHIVED", "QUARANTINED"],
      ARCHIVED: ["DRAFT"],
      QUARANTINED: ["ARCHIVED", "DRAFT"],
    };

    const allowed = validTransitions[currentState] || [];
    const passed = allowed.includes(nextState);

    return {
      invariantId: "INV-05",
      name: DOMAIN_INVARIANTS.INV_05_VALID_LIFECYCLE_TRANSITION,
      passed,
      message: passed
        ? undefined
        : `Illegal transition from ${currentState} to ${nextState}. Allowed: [${allowed.join(", ")}]`,
      context: { currentState, nextState, allowed },
    };
  }

  /**
   * INV-06: Unique token IDs
   */
  static assertUniqueTokenId(existingTokenIds: Set<string>, candidateTokenId: string): InvariantResult {
    const passed = !existingTokenIds.has(candidateTokenId);
    return {
      invariantId: "INV-06",
      name: DOMAIN_INVARIANTS.INV_06_UNIQUE_TOKEN_ID,
      passed,
      message: passed ? undefined : `Duplicate token ID collision detected: ${candidateTokenId}`,
      context: { candidateTokenId },
    };
  }

  /**
   * INV-07: Escrow balance conservation
   */
  static assertEscrowBalanceConservation(
    escrowDeposit: bigint,
    pendingPayouts: bigint,
    platformFee: bigint
  ): InvariantResult {
    const sum = pendingPayouts + platformFee;
    const passed = escrowDeposit === sum;
    return {
      invariantId: "INV-07",
      name: DOMAIN_INVARIANTS.INV_07_ESCROW_BALANCE_CONSERVATION,
      passed,
      message: passed
        ? undefined
        : `Escrow imbalance: deposit ${escrowDeposit} != payouts (${pendingPayouts}) + fee (${platformFee}) = ${sum}`,
      context: {
        escrowDeposit: escrowDeposit.toString(),
        pendingPayouts: pendingPayouts.toString(),
        platformFee: platformFee.toString(),
      },
    };
  }

  /**
   * INV-08: Rating score bounds and reviewer entitlement
   */
  static assertRatingAndReviewerEligibility(
    rating: number,
    hasPurchased: boolean
  ): InvariantResult {
    const isInteger = Number.isInteger(rating);
    const inRange = rating >= 1 && rating <= 5;
    const passed = isInteger && inRange && hasPurchased;

    let message: string | undefined;
    if (!isInteger || !inRange) {
      message = `Rating must be an integer between 1 and 5; got: ${rating}`;
    } else if (!hasPurchased) {
      message = "User has not purchased this prompt and is ineligible to leave a review.";
    }

    return {
      invariantId: "INV-08",
      name: DOMAIN_INVARIANTS.INV_08_RATING_BOUNDS_AND_BUYER_ELIGIBILITY,
      passed,
      message,
      context: { rating, hasPurchased },
    };
  }

  /**
   * INV-09: Quarantined prompts not listable
   */
  static assertListableStatus(isQuarantined: boolean, isListed: boolean): InvariantResult {
    const passed = !(isQuarantined && isListed);
    return {
      invariantId: "INV-09",
      name: DOMAIN_INVARIANTS.INV_09_QUARANTINED_PROMPTS_NOT_LISTABLE,
      passed,
      message: passed ? undefined : "Quarantined prompt cannot be set to active listed status",
      context: { isQuarantined, isListed },
    };
  }

  /**
   * INV-10: Entitlement integrity
   */
  static assertEntitlementIntegrity(
    hasActiveEntitlement: boolean,
    isAuthor: boolean,
    hasFulfilledPurchase: boolean
  ): InvariantResult {
    const passed = !hasActiveEntitlement || isAuthor || hasFulfilledPurchase;
    return {
      invariantId: "INV-10",
      name: DOMAIN_INVARIANTS.INV_10_ENTITLEMENT_INTEGRITY,
      passed,
      message: passed ? undefined : "User holds entitlement without corresponding purchase or authorship record.",
      context: { hasActiveEntitlement, isAuthor, hasFulfilledPurchase },
    };
  }
}
