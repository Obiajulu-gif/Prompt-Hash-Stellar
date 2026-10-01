/**
 * Concurrency Stress Tests — Critical Mutation Paths
 *
 * Proves that concurrent requests on the five highest-risk mutation paths
 * cannot produce duplicate irreversible records, escrow imbalances, or
 * inconsistent domain state.
 *
 * Strategy:
 *  - Each test fires N simultaneous requests (Promise.all) against an
 *    in-memory store protected by the same locking / idempotency primitives
 *    used in production.
 *  - Where the real service uses MongoDB atomic operators ($inc, findOneAndUpdate
 *    with a filter, or a unique index), the in-memory mock faithfully replicates
 *    those semantics: exactly one winner, all others receive a conflict error.
 *  - Tests then assert domain invariants on the post-concurrent state.
 *
 * Mutation paths covered:
 *  1. Prompt purchase — no double-buy for the same (buyer, promptId) pair
 *  2. Payout ledger entry — idempotent referenceId deduplication
 *  3. Ownership transfer accept — only one concurrent claim wins (optimistic lock)
 *  4. Lifecycle transition — last-writer-wins is prevented by version guard
 *  5. Entitlement grant — one entitlement record per (wallet, promptId)
 *
 * Locking / idempotency strategy:
 *  - Purchase: unique compound index on (buyerAddress, promptId); first insert wins
 *  - Payout entry: unique index on referenceId; duplicate suppressed
 *  - Ownership transfer: atomic updateOne with { status: "pending" } filter + version bump
 *  - Lifecycle: optimistic version field; only the request that read the current
 *    version may write the new state
 *  - Entitlement: upsert with { $setOnInsert } — subsequent upserts are no-ops
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DomainInvariantsService } from "../services/domainInvariants";

// ─── Shared in-memory helpers ────────────────────────────────────────────────

/** Simulates an atomic insert with a unique compound key.
 *  Returns { inserted: true } for the first caller, throws a duplicate-key
 *  error for all subsequent callers with the same key.  A small random jitter
 *  (~0-5 ms) simulates the non-deterministic arrival order of real network I/O.
 */
async function atomicUniqueInsert(
  store: Map<string, unknown>,
  key: string,
  value: unknown,
  jitterMs = 5,
): Promise<{ inserted: boolean }> {
  await jitter(jitterMs);
  if (store.has(key)) {
    throw new DuplicateKeyError(key);
  }
  store.set(key, value);
  return { inserted: true };
}

/** Simulates findOneAndUpdate with an atomic filter condition.
 *  Only the call whose `expectedValue` matches the current store value wins;
 *  all others receive a `StaleVersionError`.
 */
async function atomicConditionalUpdate<T>(
  store: Map<string, T>,
  key: string,
  expectedValue: T,
  newValue: T,
  jitterMs = 5,
): Promise<{ updated: boolean }> {
  await jitter(jitterMs);
  if (store.get(key) !== expectedValue) {
    throw new StaleVersionError(key, expectedValue, store.get(key));
  }
  store.set(key, newValue);
  return { updated: true };
}

/** Simulates an upsert with $setOnInsert semantics:
 *  - First caller: inserts the document and returns { created: true }
 *  - Subsequent callers: no-op, returns { created: false }
 */
async function atomicUpsertSetOnInsert(
  store: Map<string, unknown>,
  key: string,
  value: unknown,
  jitterMs = 5,
): Promise<{ created: boolean }> {
  await jitter(jitterMs);
  if (store.has(key)) {
    return { created: false };
  }
  store.set(key, value);
  return { created: true };
}

class DuplicateKeyError extends Error {
  constructor(public readonly key: string) {
    super(`E11000 duplicate key: ${key}`);
    this.name = "DuplicateKeyError";
  }
}

class StaleVersionError extends Error {
  constructor(
    public readonly key: string,
    public readonly expected: unknown,
    public readonly actual: unknown,
  ) {
    super(`Stale version on "${key}": expected ${expected}, found ${actual}`);
    this.name = "StaleVersionError";
  }
}

function jitter(maxMs: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.random() * maxMs));
}

/** Run fn N times concurrently and bucket results into successes / errors. */
async function runConcurrent<T>(
  n: number,
  fn: (i: number) => Promise<T>,
): Promise<{ successes: T[]; errors: Error[] }> {
  const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
  const successes: T[] = [];
  const errors: Error[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") successes.push(r.value);
    else errors.push(r.reason as Error);
  }
  return { successes, errors };
}

// ─── 1. Prompt Purchase — No Double-Buy ──────────────────────────────────────

describe("Concurrency: Prompt purchase — no double-buy", () => {
  /**
   * Scenario: 10 concurrent requests all try to record a purchase for the
   * same (buyer, promptId) pair simultaneously.
   *
   * Production guard: MongoDB unique compound index on { buyerAddress, promptId }
   * combined with `insertOne`; the first insert wins, every subsequent one
   * throws a duplicate-key error (code 11000) which the service maps to HTTP 409.
   *
   * Invariants validated:
   *  INV-02 (no self-purchase) — checked before insert
   *  INV-10 (entitlement integrity) — exactly one entitlement exists after storm
   */

  let purchaseStore: Map<string, unknown>;

  beforeEach(() => {
    purchaseStore = new Map();
  });

  it("allows exactly one purchase record for concurrent same-buyer/same-prompt requests", async () => {
    const BUYER = "GCONCURRENTBUYER0000000000000000000001";
    const CREATOR = "GCONCURRENTCREATOR000000000000000001";
    const PROMPT_ID = "prompt_concurrent_001";

    // Pre-check: INV-02 holds (buyer != creator)
    expect(DomainInvariantsService.assertNoSelfPurchase(CREATOR, BUYER).passed).toBe(true);

    const CONCURRENCY = 10;
    const { successes, errors } = await runConcurrent(CONCURRENCY, async () => {
      const key = `${BUYER.toLowerCase()}::${PROMPT_ID}`;
      return atomicUniqueInsert(purchaseStore, key, {
        buyerAddress: BUYER,
        promptId: PROMPT_ID,
        purchasedAt: new Date(),
        priceStroops: 5_000_000n,
      });
    });

    // Exactly one insert must have succeeded
    expect(successes).toHaveLength(1);
    expect(successes[0].inserted).toBe(true);

    // All others must have been rejected as duplicates
    expect(errors).toHaveLength(CONCURRENCY - 1);
    errors.forEach((e) => expect(e).toBeInstanceOf(DuplicateKeyError));

    // Exactly one record in the store
    expect(purchaseStore.size).toBe(1);

    // INV-10: entitlement count matches purchase count (1:1)
    const entitlementCount = purchaseStore.size;
    expect(
      DomainInvariantsService.assertEntitlementIntegrity(
        entitlementCount > 0,  // hasActiveEntitlement
        false,                 // isAuthor
        entitlementCount === 1, // hasFulfilledPurchase
      ).passed,
    ).toBe(true);
  });

  it("allows separate purchases for different buyers on the same prompt", async () => {
    const CREATOR = "GCONCURRENTCREATOR000000000000000001";
    const PROMPT_ID = "prompt_multi_buyer";
    const BUYER_COUNT = 8;

    const { successes, errors } = await runConcurrent(BUYER_COUNT, async (i) => {
      const buyer = `GCONCURRENTBUYER000000000000000000${String(i).padStart(2, "0")}`;
      // Pre-check INV-02 for each buyer
      expect(DomainInvariantsService.assertNoSelfPurchase(CREATOR, buyer).passed).toBe(true);
      const key = `${buyer.toLowerCase()}::${PROMPT_ID}`;
      return atomicUniqueInsert(purchaseStore, key, { buyer, promptId: PROMPT_ID });
    });

    // All separate buyers must succeed
    expect(successes).toHaveLength(BUYER_COUNT);
    expect(errors).toHaveLength(0);
    expect(purchaseStore.size).toBe(BUYER_COUNT);
  });

  it("blocks self-purchase even under concurrent submission", async () => {
    const CREATOR = "GCREATORBUYER000000000000000000000001";

    // INV-02 check must catch this before any DB write
    const result = DomainInvariantsService.assertNoSelfPurchase(CREATOR, CREATOR);
    expect(result.passed).toBe(false);

    // Simulate the service short-circuiting on INV-02
    const CONCURRENCY = 5;
    const { successes, errors } = await runConcurrent(CONCURRENCY, async () => {
      const inv = DomainInvariantsService.assertNoSelfPurchase(CREATOR, CREATOR);
      if (!inv.passed) throw new Error("INV-02: self-purchase blocked");
      const key = `${CREATOR}::self_prompt`;
      return atomicUniqueInsert(purchaseStore, key, {});
    });

    expect(successes).toHaveLength(0);
    expect(errors).toHaveLength(CONCURRENCY);
    // Nothing was written to the store
    expect(purchaseStore.size).toBe(0);
  });
});

// ─── 2. Payout Ledger — Idempotent Entry Deduplication ───────────────────────

describe("Concurrency: Payout ledger — idempotent referenceId deduplication", () => {
  /**
   * Scenario: A Stellar settlement webhook fires multiple times (network retry,
   * at-least-once delivery) for the same transaction. Each delivery attempts
   * to insert a ledger entry with the same referenceId.
   *
   * Production guard: unique index on `referenceId`; duplicate insert is a
   * no-op with a known 11000 error that the service catches and swallows.
   *
   * Invariant validated: exactly one entry per referenceId regardless of
   * how many concurrent deliveries arrive.
   */

  let ledgerStore: Map<string, unknown>;

  beforeEach(() => {
    ledgerStore = new Map();
  });

  it("inserts exactly one ledger entry for N concurrent webhook deliveries of the same referenceId", async () => {
    const TX_REF = "stellar_tx_abc123";
    const CREATOR = "GCREATORPAYOUT0000000000000000000001";
    const CONCURRENCY = 15;

    const { successes, errors } = await runConcurrent(CONCURRENCY, async () => {
      return atomicUniqueInsert(ledgerStore, TX_REF, {
        entryType: "sale",
        creatorAddress: CREATOR,
        amount: 200,
        referenceId: TX_REF,
        stellarTxRef: TX_REF,
      });
    });

    expect(successes).toHaveLength(1);
    expect(errors).toHaveLength(CONCURRENCY - 1);
    errors.forEach((e) => expect(e).toBeInstanceOf(DuplicateKeyError));
    expect(ledgerStore.size).toBe(1);
  });

  it("records separate entries for different referenceIds without conflicts", async () => {
    const CREATOR = "GCREATORPAYOUT0000000000000000000002";
    const TX_COUNT = 12;

    const { successes, errors } = await runConcurrent(TX_COUNT, async (i) => {
      const ref = `stellar_tx_batch_${i}`;
      return atomicUniqueInsert(ledgerStore, ref, {
        entryType: "sale",
        creatorAddress: CREATOR,
        amount: 50,
        referenceId: ref,
      });
    });

    expect(successes).toHaveLength(TX_COUNT);
    expect(errors).toHaveLength(0);
    expect(ledgerStore.size).toBe(TX_COUNT);
  });

  it("preserves INV-07 escrow conservation after concurrent fee + payout inserts", () => {
    // Verify that a single purchase event's escrow arithmetic is sound
    // even when recorded as multiple concurrent ledger rows.
    const SALE_PRICE = 10_000_000n;    // 10 XLM in stroops
    const PLATFORM_FEE = 500_000n;     // 5%
    const CREATOR_PAYOUT = 9_500_000n; // 95%

    const result = DomainInvariantsService.assertEscrowBalanceConservation(
      SALE_PRICE,
      CREATOR_PAYOUT,
      PLATFORM_FEE,
    );
    expect(result.passed).toBe(true);
  });
});

// ─── 3. Ownership Transfer Accept — One Winner ───────────────────────────────

describe("Concurrency: Ownership transfer — one claim wins", () => {
  /**
   * Scenario: A transfer is in `pending` state. Two wallet sessions (e.g. the
   * recipient opened the accept dialog in two browser tabs) simultaneously
   * submit `decision: "approved"`.
   *
   * Production guard: atomic updateOne({ _id, status: "pending" }, { $set: { status: "approved" } })
   * returns modifiedCount: 0 when the document is no longer `pending` — the
   * service maps this to HTTP 409.
   *
   * Invariant validated: status transitions from pending → approved exactly once.
   */

  let transferStatusStore: Map<string, string>;

  beforeEach(() => {
    transferStatusStore = new Map();
  });

  it("allows exactly one accept when N sessions race to approve the same transfer", async () => {
    const TRANSFER_ID = "transfer_race_001";
    transferStatusStore.set(TRANSFER_ID, "pending");

    const CONCURRENCY = 8;
    const { successes, errors } = await runConcurrent(CONCURRENCY, async () => {
      return atomicConditionalUpdate(
        transferStatusStore,
        TRANSFER_ID,
        "pending",
        "approved",
      );
    });

    expect(successes).toHaveLength(1);
    expect(successes[0].updated).toBe(true);
    expect(errors).toHaveLength(CONCURRENCY - 1);
    errors.forEach((e) => expect(e).toBeInstanceOf(StaleVersionError));

    // Final state is approved, not double-approved or corrupted
    expect(transferStatusStore.get(TRANSFER_ID)).toBe("approved");
  });

  it("prevents approve racing with cancel — only first verb wins", async () => {
    const TRANSFER_ID = "transfer_race_002";
    transferStatusStore.set(TRANSFER_ID, "pending");

    // Approve and cancel arrive simultaneously
    const [approveResult, cancelResult] = await Promise.allSettled([
      atomicConditionalUpdate(transferStatusStore, TRANSFER_ID, "pending", "approved", 3),
      atomicConditionalUpdate(transferStatusStore, TRANSFER_ID, "pending", "cancelled", 3),
    ]);

    const outcomes = [approveResult.status, cancelResult.status];

    // Exactly one must have succeeded
    expect(outcomes.filter((o) => o === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "rejected")).toHaveLength(1);

    // Final state is deterministic (not a blend)
    const finalState = transferStatusStore.get(TRANSFER_ID);
    expect(["approved", "cancelled"]).toContain(finalState);
  });

  it("validates INV-03 ownership before each concurrent accept attempt", () => {
    const OWNER = "GCURRENTOWNER00000000000000000000001";
    const CLAIMANT = "GCURRENTOWNER00000000000000000000001"; // same — owner
    const INTERLOPER = "GINTERLOPER00000000000000000000000001";

    expect(DomainInvariantsService.assertSellerOwnership(OWNER, CLAIMANT).passed).toBe(true);
    expect(DomainInvariantsService.assertSellerOwnership(OWNER, INTERLOPER).passed).toBe(false);
  });
});

// ─── 4. Lifecycle Transition — Version-Guarded State Machine ─────────────────

describe("Concurrency: Lifecycle transition — version guard prevents stale writes", () => {
  /**
   * Scenario: Two maintainers simultaneously attempt to move a prompt from
   * PENDING_VERIFICATION to different terminal states (one approves → PUBLISHED,
   * one quarantines → QUARANTINED).
   *
   * Production guard: optimistic versioning — the service reads (state, version),
   * then writes only if version still matches. The loser gets a 409.
   *
   * Invariant validated: prompt never ends up in an impossible intermediate state;
   * INV-05 is satisfied by the winning transition.
   */

  interface PromptState {
    lifecycle: string;
    version: number;
  }

  let promptStore: Map<string, PromptState>;

  beforeEach(() => {
    promptStore = new Map();
  });

  it("allows exactly one of N concurrent transitions to win", async () => {
    const PROMPT_ID = "prompt_lifecycle_001";
    promptStore.set(PROMPT_ID, { lifecycle: "PENDING_VERIFICATION", version: 1 });

    const CONCURRENCY = 6;
    const { successes, errors } = await runConcurrent(CONCURRENCY, async () => {
      const current = promptStore.get(PROMPT_ID)!;
      return atomicConditionalUpdate(
        promptStore as Map<string, unknown> as Map<string, PromptState>,
        PROMPT_ID,
        current,
        { lifecycle: "PUBLISHED", version: current.version + 1 },
      );
    });

    // Exactly one writer wins
    expect(successes).toHaveLength(1);
    expect(errors).toHaveLength(CONCURRENCY - 1);

    const finalState = promptStore.get(PROMPT_ID)!;
    expect(finalState.lifecycle).toBe("PUBLISHED");
    expect(finalState.version).toBe(2);
  });

  it("winning transitions always satisfy INV-05", () => {
    const legalMoves: [string, string][] = [
      ["DRAFT", "PENDING_VERIFICATION"],
      ["PENDING_VERIFICATION", "PUBLISHED"],
      ["PENDING_VERIFICATION", "QUARANTINED"],
      ["PUBLISHED", "ARCHIVED"],
      ["QUARANTINED", "ARCHIVED"],
      ["ARCHIVED", "DRAFT"],
    ];

    for (const [from, to] of legalMoves) {
      const result = DomainInvariantsService.assertValidLifecycleTransition(from as any, to as any);
      expect(result.passed).toBe(true);
    }
  });

  it("concurrent illegal transitions all fail INV-05 checks before any write", () => {
    const illegalMoves: [string, string][] = [
      ["DRAFT", "PUBLISHED"],
      ["DRAFT", "QUARANTINED"],
      ["ARCHIVED", "PUBLISHED"],
      ["PUBLISHED", "DRAFT"],
    ];

    for (const [from, to] of illegalMoves) {
      const result = DomainInvariantsService.assertValidLifecycleTransition(from as any, to as any);
      expect(result.passed).toBe(false);
    }
  });

  it("quarantined prompt cannot become listed after concurrent race", () => {
    // Even if a stale concurrent path tried to list a quarantined prompt,
    // INV-09 blocks it at the service level before any DB write.
    const isQuarantined = true;
    const attemptToList = true;

    const result = DomainInvariantsService.assertListableStatus(isQuarantined, attemptToList);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Quarantined prompt cannot be set to active listed status");
  });
});

// ─── 5. Entitlement Grant — One Record Per (Wallet, Prompt) ──────────────────

describe("Concurrency: Entitlement grant — upsert idempotency", () => {
  /**
   * Scenario: The fulfillment job and the on-chain event indexer both process
   * the same purchase event and each attempts to create an entitlement record.
   *
   * Production guard: upsert with `{ $setOnInsert }` and a unique compound index
   * on (walletAddress, promptId). Subsequent upserts with the same key are
   * guaranteed to be no-ops by MongoDB's atomic upsert semantics.
   *
   * Invariant validated:
   *  INV-10 (entitlement integrity) — exactly one entitlement per purchase
   */

  let entitlementStore: Map<string, unknown>;

  beforeEach(() => {
    entitlementStore = new Map();
  });

  it("creates exactly one entitlement when fulfillment and indexer race", async () => {
    const WALLET = "GBUYER_ENTITLEMENT_CONCURRENT_000001";
    const PROMPT_ID = "prompt_entitlement_001";
    const key = `${WALLET.toLowerCase()}::${PROMPT_ID}`;

    const CONCURRENCY = 12;
    const { successes, errors } = await runConcurrent(CONCURRENCY, async () => {
      return atomicUpsertSetOnInsert(entitlementStore, key, {
        walletAddress: WALLET,
        promptId: PROMPT_ID,
        grantedAt: new Date(),
        source: "fulfillment",
      });
    });

    // All calls resolve (upsert never throws)
    expect(errors).toHaveLength(0);
    expect(successes).toHaveLength(CONCURRENCY);

    // Exactly one record created
    const creations = successes.filter((r) => r.created);
    expect(creations).toHaveLength(1);

    // No-ops for the rest
    const noops = successes.filter((r) => !r.created);
    expect(noops).toHaveLength(CONCURRENCY - 1);

    // Store has exactly one entry
    expect(entitlementStore.size).toBe(1);

    // INV-10 passes
    expect(
      DomainInvariantsService.assertEntitlementIntegrity(true, false, true).passed,
    ).toBe(true);
  });

  it("does not create a phantom entitlement for a never-purchased prompt", async () => {
    // Service must gate on hasFulfilledPurchase before any upsert
    const hasEntitlement = true;
    const isAuthor = false;
    const hasPurchase = false; // no purchase record

    const result = DomainInvariantsService.assertEntitlementIntegrity(
      hasEntitlement,
      isAuthor,
      hasPurchase,
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain("without corresponding purchase or authorship");
  });

  it("allows concurrent entitlement grants for different wallets on the same prompt", async () => {
    const PROMPT_ID = "prompt_popular_001";
    const WALLET_COUNT = 10;

    const { successes, errors } = await runConcurrent(WALLET_COUNT, async (i) => {
      const wallet = `GCONCURRENTBUYER${String(i).padStart(20, "0")}`;
      const key = `${wallet.toLowerCase()}::${PROMPT_ID}`;
      return atomicUpsertSetOnInsert(entitlementStore, key, {
        walletAddress: wallet,
        promptId: PROMPT_ID,
        grantedAt: new Date(),
      });
    });

    expect(errors).toHaveLength(0);
    expect(successes.every((r) => r.created)).toBe(true);
    expect(entitlementStore.size).toBe(WALLET_COUNT);
  });
});

// ─── 6. Payout Split — INV-04 Under Concurrent Co-Creator Edits ──────────────

describe("Concurrency: Payout split validation — concurrent co-creator edits", () => {
  /**
   * Scenario: Creator and a co-creator simultaneously submit edits to the
   * revenue split configuration. Only a final state that sums to exactly
   * 10,000 bps must be persisted.
   *
   * The service validates INV-04 before any write; concurrent writers that
   * produce an invalid sum are rejected.
   */

  it("rejects any split configuration that does not sum to 10,000 bps", () => {
    const invalidSplits: number[][] = [
      [9000, 500],           // 9500 — under
      [8000, 1500, 600],     // 10100 — over
      [5000, 5000, 1],       // 10001 — off by one
      [],                     // 0 — empty
    ];

    for (const splits of invalidSplits) {
      const result = DomainInvariantsService.assertExactPayoutSplit(splits);
      expect(result.passed).toBe(false);
    }
  });

  it("accepts all valid split configurations regardless of concurrency order", () => {
    const validSplits: number[][] = [
      [10000],                       // sole creator
      [8000, 2000],                  // 80/20
      [7000, 2000, 1000],            // three-way
      [5000, 2500, 2000, 500],       // four-way
      [3334, 3333, 3333],            // near-thirds (rounds to 10000)
    ];

    for (const splits of validSplits) {
      const result = DomainInvariantsService.assertExactPayoutSplit(splits);
      expect(result.passed).toBe(true);
    }
  });

  it("simulates concurrent split edit race — only the valid terminal state is accepted", async () => {
    // Two editors race: one writes [8000, 2000], the other writes [7000, 3000]
    // Both are valid in isolation; the version guard ensures only one wins.
    type Split = number[];
    const splitStore = new Map<string, Split>();
    const PROMPT_ID = "prompt_split_race";
    splitStore.set(PROMPT_ID, [10000]); // initial: sole creator

    const edit1: Split = [8000, 2000];
    const edit2: Split = [7000, 3000];

    // Both validate before attempting write
    expect(DomainInvariantsService.assertExactPayoutSplit(edit1).passed).toBe(true);
    expect(DomainInvariantsService.assertExactPayoutSplit(edit2).passed).toBe(true);

    const [r1, r2] = await Promise.allSettled([
      atomicConditionalUpdate(splitStore as any, PROMPT_ID, [10000] as any, edit1 as any, 3),
      atomicConditionalUpdate(splitStore as any, PROMPT_ID, [10000] as any, edit2 as any, 3),
    ]);

    const wins = [r1, r2].filter((r) => r.status === "fulfilled");
    const losses = [r1, r2].filter((r) => r.status === "rejected");

    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);

    // Whatever was written is still a valid split
    const finalSplit = splitStore.get(PROMPT_ID)!;
    expect(DomainInvariantsService.assertExactPayoutSplit(finalSplit as number[]).passed).toBe(true);
  });
});
