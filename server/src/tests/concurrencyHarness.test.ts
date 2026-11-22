/**
 * Multi-Actor Concurrency Harness — Issue #975
 *
 * Simulates concurrent actors, duplicate submissions, stale-version writes,
 * and retry storms around the critical mutation paths in PromptHash Stellar.
 *
 * Strategy
 * --------
 * All five scenarios use in-memory stores with atomic helpers that faithfully
 * replicate the invariants enforced by MongoDB in production:
 *   - unique compound index  → atomicUniqueInsert (first wins, rest 11000)
 *   - optimistic version lock → atomicVersionedUpdate (stale write rejected)
 *   - upsert $setOnInsert    → atomicUpsert (idempotent, first creates)
 *   - idempotency key gate   → atomicIdempotencyGate (replay vs conflict)
 *
 * Scenarios
 * ---------
 *  1. Retry storm on purchase — N retries from same client, only 1 inserted
 *  2. Stale version write — concurrent price updates, only current-version wins
 *  3. Duplicate webhook delivery — idempotency gate dedups at-least-once events
 *  4. Concurrent entitlement + fulfillment — upsert race resolves to 1 record
 *  5. Mixed actors — buyer retries + indexer at-least-once + moderator transition
 *
 * Failure modes and rollback notes are inline.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Atomic in-memory primitives ─────────────────────────────────────────────

class DuplicateKeyError extends Error {
  constructor(key: string) {
    super(`E11000 duplicate key: ${key}`);
    this.name = "DuplicateKeyError";
  }
}

class StaleVersionError extends Error {
  constructor(key: string, expected: number, actual: number | undefined) {
    super(`Stale version on "${key}": expected ${expected}, actual ${actual}`);
    this.name = "StaleVersionError";
  }
}

class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency-Key "${key}" already used with a different payload.`);
    this.name = "IdempotencyConflictError";
  }
}

/** Small non-deterministic delay to surface ordering races. */
const jitter = (max = 8) => new Promise<void>((r) => setTimeout(r, Math.random() * max));

/**
 * Insert with unique-key enforcement. First caller wins; duplicates throw
 * DuplicateKeyError — matching MongoDB's code-11000 behaviour.
 */
async function atomicUniqueInsert(
  store: Map<string, unknown>,
  key: string,
  value: unknown,
): Promise<void> {
  await jitter();
  if (store.has(key)) throw new DuplicateKeyError(key);
  store.set(key, value);
}

/**
 * Versioned conditional update. Only succeeds if the document's current
 * version equals `expectedVersion`. On success, increments version by 1.
 */
async function atomicVersionedUpdate<T extends Record<string, unknown>>(
  store: Map<string, T & { _version: number }>,
  key: string,
  expectedVersion: number,
  patch: Partial<T>,
): Promise<void> {
  await jitter();
  const doc = store.get(key);
  if (!doc || doc._version !== expectedVersion) {
    throw new StaleVersionError(key, expectedVersion, doc?._version);
  }
  store.set(key, { ...doc, ...patch, _version: expectedVersion + 1 });
}

/**
 * Upsert with $setOnInsert semantics: first caller creates, rest are no-ops.
 */
async function atomicUpsert(
  store: Map<string, unknown>,
  key: string,
  value: unknown,
): Promise<{ created: boolean }> {
  await jitter();
  if (store.has(key)) return { created: false };
  store.set(key, value);
  return { created: true };
}

/**
 * Idempotency gate: first call with a key registers it and succeeds;
 * same key + same payload → replay; same key + different payload → conflict.
 */
async function atomicIdempotencyGate(
  store: Map<string, string>,
  key: string,
  payloadHash: string,
): Promise<"new" | "replay"> {
  await jitter();
  const existing = store.get(key);
  if (existing === undefined) {
    store.set(key, payloadHash);
    return "new";
  }
  if (existing === payloadHash) return "replay";
  throw new IdempotencyConflictError(key);
}

/** Run fn concurrently N times; bucket into successes / errors. */
async function race<T>(
  n: number,
  fn: (i: number) => Promise<T>,
): Promise<{ ok: T[]; err: Error[] }> {
  const settled = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
  const ok: T[] = [];
  const err: Error[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") ok.push(r.value);
    else err.push(r.reason as Error);
  }
  return { ok, err };
}

// ─── 1. Retry Storm on Purchase ───────────────────────────────────────────────

describe("Concurrency harness: retry storm on purchase", () => {
  /**
   * A mobile client loses connectivity mid-purchase and fires 20 retries with
   * the same (buyer, promptId). Only one purchase record must be created.
   *
   * Guard: unique compound index on { buyerAddress, promptId }.
   *
   * Failure mode: if the index is absent, all 20 inserts succeed → buyer is
   * charged 20×. Recovery: run the dedup repair script in
   * server/scripts/repairEntitlement.ts and issue refunds via the payout ledger.
   */

  let purchaseStore: Map<string, unknown>;

  beforeEach(() => {
    purchaseStore = new Map();
  });

  it("inserts exactly one purchase record under a 20-retry storm", async () => {
    const buyer = "GRETRYBUYER0000000000000000000000001";
    const promptId = "prompt_storm_001";
    const key = `${buyer}::${promptId}`;

    const { ok, err } = await race(20, () =>
      atomicUniqueInsert(purchaseStore, key, {
        buyerAddress: buyer,
        promptId,
        priceStroops: 5_000_000n,
        purchasedAt: new Date(),
      }),
    );

    expect(ok).toHaveLength(1);
    expect(err).toHaveLength(19);
    err.forEach((e) => expect(e).toBeInstanceOf(DuplicateKeyError));
    expect(purchaseStore.size).toBe(1);
  });

  it("retry storm with exponential back-off still produces exactly one record", async () => {
    const buyer = "GRETRYBUYER0000000000000000000000002";
    const promptId = "prompt_storm_backoff";
    const key = `${buyer}::${promptId}`;

    // Simulate back-off by adding extra delay to each retry
    const { ok, err } = await race(10, async (i) => {
      // Exponential delay: 0, 2, 4, 8, … ms (capped at 20 ms for test speed)
      await new Promise<void>((r) => setTimeout(r, Math.min(2 ** i, 20)));
      return atomicUniqueInsert(purchaseStore, key, { buyer, promptId });
    });

    expect(ok).toHaveLength(1);
    expect(err).toHaveLength(9);
    expect(purchaseStore.size).toBe(1);
  });
});

// ─── 2. Stale-Version Write (Price Update) ───────────────────────────────────

describe("Concurrency harness: stale-version write — concurrent price updates", () => {
  /**
   * Creator opens the edit form in two browser tabs simultaneously and
   * submits a price change from each. The optimistic version field ensures
   * only the first submitted write wins; the second gets a 409.
   *
   * Guard: atomic update with version predicate.
   *
   * Failure mode: if version check is absent, the last writer silently
   * overwrites. Recovery: rely on the change-history audit trail to detect
   * and revert ghost writes.
   */

  type PromptDoc = { priceStroops: bigint; _version: number };
  let promptStore: Map<string, PromptDoc & { _version: number }>;

  beforeEach(() => {
    promptStore = new Map();
    promptStore.set("prompt_price_001", { priceStroops: 5_000_000n, _version: 1 });
  });

  it("allows exactly one of two concurrent price updates to succeed", async () => {
    const [r1, r2] = await Promise.allSettled([
      atomicVersionedUpdate(promptStore, "prompt_price_001", 1, {
        priceStroops: 8_000_000n,
      }),
      atomicVersionedUpdate(promptStore, "prompt_price_001", 1, {
        priceStroops: 12_000_000n,
      }),
    ]);

    const wins = [r1, r2].filter((r) => r.status === "fulfilled");
    const losses = [r1, r2].filter((r) => r.status === "rejected");

    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleVersionError);

    // Version was incremented exactly once
    expect(promptStore.get("prompt_price_001")!._version).toBe(2);
  });

  it("version increments monotonically under sequential retries after 409", async () => {
    // Retry loop: try until success or max attempts
    let attempts = 0;
    let succeeded = false;

    while (attempts < 5 && !succeeded) {
      const doc = promptStore.get("prompt_price_001")!;
      try {
        await atomicVersionedUpdate(promptStore, "prompt_price_001", doc._version, {
          priceStroops: 10_000_000n,
        });
        succeeded = true;
      } catch {
        attempts++;
      }
    }

    expect(succeeded).toBe(true);
    expect(promptStore.get("prompt_price_001")!.priceStroops).toBe(10_000_000n);
  });

  it("N concurrent stale writers all fail when document moves to version 2", async () => {
    // First writer advances to v2
    await atomicVersionedUpdate(promptStore, "prompt_price_001", 1, {
      priceStroops: 7_000_000n,
    });

    // All remaining writers still reference v1 — all must fail
    const { ok, err } = await race(8, () =>
      atomicVersionedUpdate(promptStore, "prompt_price_001", 1, {
        priceStroops: 9_000_000n,
      }),
    );

    expect(ok).toHaveLength(0);
    expect(err).toHaveLength(8);
    err.forEach((e) => expect(e).toBeInstanceOf(StaleVersionError));
    // Version stays at 2 — no phantom writes
    expect(promptStore.get("prompt_price_001")!._version).toBe(2);
  });
});

// ─── 3. Duplicate Webhook Delivery — Idempotency Gate ────────────────────────

describe("Concurrency harness: duplicate webhook delivery via idempotency gate", () => {
  /**
   * Stellar settlement webhooks use at-least-once delivery. The same
   * purchase-confirmed event may arrive 15 times. The idempotency gate
   * must deduplicate to exactly one fulfillment action.
   *
   * Guard: idempotency key stored atomically before any side-effect.
   *
   * Failure mode: gate bypassed → duplicate entitlements / payouts.
   * Recovery: deduplicate via referenceId unique index on the payout ledger
   * and the entitlement upsert guard (scenario 4).
   */

  let idempotencyStore: Map<string, string>;

  beforeEach(() => {
    idempotencyStore = new Map();
  });

  it("processes exactly one of 15 duplicate webhook deliveries", async () => {
    const key = "webhook_stellar_tx_abc123";
    const hash = "sha256_payload_hash_abc";

    const { ok, err } = await race(15, () =>
      atomicIdempotencyGate(idempotencyStore, key, hash),
    );

    expect(err).toHaveLength(0); // replays do not throw
    const newOps = ok.filter((r) => r === "new");
    const replayOps = ok.filter((r) => r === "replay");

    expect(newOps).toHaveLength(1);
    expect(replayOps).toHaveLength(14);
    expect(idempotencyStore.size).toBe(1);
  });

  it("raises IdempotencyConflictError when the same key arrives with a different payload", async () => {
    const key = "webhook_key_conflict";
    // First call establishes the key
    await atomicIdempotencyGate(idempotencyStore, key, "hash_v1");

    // Second call with a different hash (tampered or mis-routed delivery)
    await expect(
      atomicIdempotencyGate(idempotencyStore, key, "hash_v2"),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("different keys for different events do not interfere", async () => {
    const EVENT_COUNT = 10;

    const { ok, err } = await race(EVENT_COUNT, async (i) => {
      const key = `webhook_event_${i}`;
      const hash = `hash_event_${i}`;
      return atomicIdempotencyGate(idempotencyStore, key, hash);
    });

    expect(err).toHaveLength(0);
    expect(ok.every((r) => r === "new")).toBe(true);
    expect(idempotencyStore.size).toBe(EVENT_COUNT);
  });
});

// ─── 4. Concurrent Entitlement + Fulfillment ─────────────────────────────────

describe("Concurrency harness: concurrent entitlement grant and fulfillment", () => {
  /**
   * Both the on-chain event indexer and the fulfillment job detect the same
   * purchase and each attempts to upsert an entitlement record. Only one
   * entitlement must exist at the end.
   *
   * Guard: upsert with $setOnInsert + unique compound index on (wallet, promptId).
   *
   * Failure mode: two entitlements created → buyer gets double access count.
   * Recovery: dedup-repair script in server/scripts/repairEntitlement.ts.
   */

  let entitlementStore: Map<string, unknown>;

  beforeEach(() => {
    entitlementStore = new Map();
  });

  it("creates exactly one entitlement when indexer and fulfillment race", async () => {
    const wallet = "GBUYER_FULFILLMENT_RACE_00000000001";
    const promptId = "prompt_fulfillment_001";
    const key = `${wallet}::${promptId}`;

    const { ok, err } = await race(12, () =>
      atomicUpsert(entitlementStore, key, {
        walletAddress: wallet,
        promptId,
        grantedAt: new Date(),
        source: "fulfillment",
      }),
    );

    expect(err).toHaveLength(0); // upsert never throws
    expect(ok.filter((r) => r.created)).toHaveLength(1);
    expect(ok.filter((r) => !r.created)).toHaveLength(11);
    expect(entitlementStore.size).toBe(1);
  });

  it("independent purchases for different wallets all succeed without conflict", async () => {
    const promptId = "prompt_popular_002";

    const { ok, err } = await race(20, async (i) => {
      const wallet = `GBUYER_MULTI_${String(i).padStart(16, "0")}`;
      const key = `${wallet}::${promptId}`;
      return atomicUpsert(entitlementStore, key, { wallet, promptId });
    });

    expect(err).toHaveLength(0);
    expect(ok.every((r) => r.created)).toBe(true);
    expect(entitlementStore.size).toBe(20);
  });
});

// ─── 5. Mixed-Actor Storm ─────────────────────────────────────────────────────

describe("Concurrency harness: mixed-actor storm", () => {
  /**
   * Simultaneous actors on the same prompt:
   *   A) Buyer retries purchase 5 times (expects exactly 1 insert)
   *   B) Webhook fires 8 times (expects exactly 1 "new" idempotency gate)
   *   C) Entitlement upsert fires 6 times (expects exactly 1 creation)
   *   D) Moderator and creator race to update lifecycle (exactly 1 wins)
   *
   * All four sub-storms run truly concurrently (Promise.all across actors).
   *
   * Failure mode: any one guard missing → duplicate records.
   * Recovery: see inline notes and docs/CONCURRENCY_STRATEGY.md.
   */

  type LifecycleDoc = { state: string; _version: number };

  let purchaseStore: Map<string, unknown>;
  let idempotencyStore: Map<string, string>;
  let entitlementStore: Map<string, unknown>;
  let lifecycleStore: Map<string, LifecycleDoc>;

  const BUYER = "GMIXEDBUYER000000000000000000000001";
  const PROMPT = "prompt_mixed_storm_001";

  beforeEach(() => {
    purchaseStore = new Map();
    idempotencyStore = new Map();
    entitlementStore = new Map();
    lifecycleStore = new Map();
    lifecycleStore.set(PROMPT, { state: "PENDING_VERIFICATION", _version: 1 });
  });

  it("all four guards hold independently under a mixed concurrent storm", async () => {
    const purchaseKey = `${BUYER}::${PROMPT}`;
    const webhookKey = "webhook_mixed_001";
    const webhookHash = "hash_mixed_001";
    const entitlementKey = `${BUYER}::${PROMPT}`;

    // Fire all actors simultaneously
    const [purchaseResults, webhookResults, entitlementResults, lifecycleResults] =
      await Promise.all([
        // Actor A: 5 purchase retries
        race(5, () =>
          atomicUniqueInsert(purchaseStore, purchaseKey, {
            buyer: BUYER,
            promptId: PROMPT,
            purchasedAt: new Date(),
          }),
        ),

        // Actor B: 8 webhook deliveries
        race(8, () =>
          atomicIdempotencyGate(idempotencyStore, webhookKey, webhookHash),
        ),

        // Actor C: 6 entitlement upserts
        race(6, () =>
          atomicUpsert(entitlementStore, entitlementKey, {
            wallet: BUYER,
            promptId: PROMPT,
          }),
        ),

        // Actor D: 4 lifecycle transitions (moderator + creator both trying)
        race(4, () =>
          atomicVersionedUpdate(lifecycleStore, PROMPT, 1, { state: "PUBLISHED" }),
        ),
      ]);

    // A: exactly 1 purchase
    expect(purchaseResults.ok).toHaveLength(1);
    expect(purchaseResults.err).toHaveLength(4);
    expect(purchaseResults.err.every((e) => e instanceof DuplicateKeyError)).toBe(true);

    // B: exactly 1 "new", rest replays
    expect(webhookResults.err).toHaveLength(0);
    expect(webhookResults.ok.filter((r) => r === "new")).toHaveLength(1);
    expect(webhookResults.ok.filter((r) => r === "replay")).toHaveLength(7);

    // C: exactly 1 entitlement created
    expect(entitlementResults.err).toHaveLength(0);
    expect(entitlementResults.ok.filter((r) => r.created)).toHaveLength(1);

    // D: exactly 1 lifecycle transition wins
    expect(lifecycleResults.ok).toHaveLength(1);
    expect(lifecycleResults.err).toHaveLength(3);
    expect(lifecycleResults.err.every((e) => e instanceof StaleVersionError)).toBe(true);
    expect(lifecycleStore.get(PROMPT)!.state).toBe("PUBLISHED");
    expect(lifecycleStore.get(PROMPT)!._version).toBe(2);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("Concurrency harness: edge cases", () => {
  it("zero-concurrency atomicUniqueInsert succeeds on the single call", async () => {
    const store = new Map<string, unknown>();
    await atomicUniqueInsert(store, "key", { data: true });
    expect(store.size).toBe(1);
  });

  it("unique insert: a failed insert does not leave a partial record behind", async () => {
    const store = new Map<string, unknown>();
    await atomicUniqueInsert(store, "k1", { ok: true });
    const results = await race(5, () => atomicUniqueInsert(store, "k1", { ok: false }));
    expect(results.ok).toHaveLength(0);
    expect(results.err).toHaveLength(5);
    expect(store.get("k1")).toEqual({ ok: true });
    expect(store.size).toBe(1);
  });

  it("retry after a duplicate-key rejection can still succeed on a different key", async () => {
    const store = new Map<string, unknown>();
    await atomicUniqueInsert(store, "a", { v: 1 });
    await expect(atomicUniqueInsert(store, "a", { v: 2 })).rejects.toBeInstanceOf(DuplicateKeyError);
    await atomicUniqueInsert(store, "b", { v: 3 });
    expect(store.size).toBe(2);
  });

  it("versioned update: authorized writer retrying with the refreshed version succeeds", async () => {
    const store = new Map<string, { v: number; _version: number }>();
    store.set("doc", { v: 0, _version: 1 });
    await atomicVersionedUpdate(store, "doc", 1, { v: 1 });
    const refreshed = store.get("doc")!._version;
    await atomicVersionedUpdate(store, "doc", refreshed, { v: 2 });
    expect(store.get("doc")).toEqual({ v: 2, _version: 3 });
  });

  it("versioned update: unauthorized-style stale retry without refresh is rejected and state is unchanged", async () => {
    const store = new Map<string, { v: number; _version: number }>();
    store.set("doc", { v: 0, _version: 1 });
    await atomicVersionedUpdate(store, "doc", 1, { v: 1 });
    await expect(atomicVersionedUpdate(store, "doc", 1, { v: 9 })).rejects.toBeInstanceOf(
      StaleVersionError,
    );
    expect(store.get("doc")).toEqual({ v: 1, _version: 2 });
  });

  it("upsert: concurrent creators with identical payloads produce a single record", async () => {
    const store = new Map<string, unknown>();
    const { ok, err } = await race(10, () => atomicUpsert(store, "same", { x: 1 }));
    expect(err).toHaveLength(0);
    expect(ok.filter((r) => r.created)).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it("idempotency gate: retry after conflict does not overwrite the original registered hash", async () => {
    const store = new Map<string, string>();
    await atomicIdempotencyGate(store, "k", "h1");
    await expect(atomicIdempotencyGate(store, "k", "h2")).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(store.get("k")).toBe("h1");
    expect(await atomicIdempotencyGate(store, "k", "h1")).toBe("replay");
  });

  it("atomicVersionedUpdate on a missing key throws StaleVersionError", async () => {
    const store = new Map<string, { _version: number }>();
    await expect(
      atomicVersionedUpdate(store, "missing_key", 1, {}),
    ).rejects.toBeInstanceOf(StaleVersionError);
  });

  it("atomicUpsert on the same key with different values returns created:false (no overwrite)", async () => {
    const store = new Map<string, unknown>();
    await atomicUpsert(store, "k", { v: 1 });
    const result = await atomicUpsert(store, "k", { v: 999 });

    expect(result.created).toBe(false);
    // Original value preserved — no silent overwrite
    expect((store.get("k") as any).v).toBe(1);
  });

  it("versioned update: a writer holding a stale version cannot overwrite a newer document", async () => {
    const store = new Map<string, { v: number; _version: number }>();
    store.set("doc", { v: 0, _version: 1 });
    // Writer A reads v1, writer B advances to v2 first
    await atomicVersionedUpdate(store, "doc", 1, { v: 2 });
    // Writer A's stale write is rejected and the newer state is preserved
    await expect(atomicVersionedUpdate(store, "doc", 1, { v: 99 })).rejects.toBeInstanceOf(
      StaleVersionError,
    );
    expect(store.get("doc")).toEqual({ v: 2, _version: 2 });
  });
});
