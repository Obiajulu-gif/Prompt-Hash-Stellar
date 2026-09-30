# Concurrency Strategy — Critical Mutation Paths

> **Purpose**: Document the locking, idempotency, and transaction strategy used on every mutation path that could produce duplicate irreversible records or inconsistent domain state under concurrent load.
>
> **Audience**: Contributors, code reviewers, and on-call engineers.

---

## Mutation Paths Covered

| Path | Risk | Strategy | Test file |
|------|------|----------|-----------|
| Prompt purchase | Duplicate purchase record / double-charge | Unique compound index `(buyerAddress, promptId)` | `concurrencyStress.test.ts` |
| Payout ledger entry | Duplicate settlement row from webhook retry | Unique index on `referenceId` | `concurrencyStress.test.ts` |
| Ownership transfer accept | Two sessions accepting the same transfer | Atomic `updateOne({ status: "pending" })` — modifiedCount guard | `concurrencyStress.test.ts` |
| Lifecycle transition | Two maintainers moving a prompt to different states | Optimistic version field — write gated on `version === expected` | `concurrencyStress.test.ts` |
| Entitlement grant | Fulfillment job + indexer both granting access | Upsert with `$setOnInsert` on compound index | `concurrencyStress.test.ts` |
| Revenue split edit | Concurrent co-creator split config writes | Version guard + INV-04 pre-write validation | `concurrencyStress.test.ts` |

---

## Strategy Details

### 1. Unique Compound Index (Purchase, Entitlement)

The `purchases` and `entitlements` collections carry a unique compound index on `{ buyerAddress: 1, promptId: 1 }`. The service calls `insertOne()` (never `updateOne`) for new records. Any concurrent duplicate insert receives a MongoDB error code `11000` which is caught and mapped to HTTP `409 Conflict`. This prevents double-purchases without requiring a distributed lock.

**Why not a pessimistic lock?** Purchases are rare relative to reads; a unique index is zero-overhead on reads and has O(log n) write cost. A distributed Redis lock would add latency and a failure mode (lock holder crash).

### 2. Idempotent Ledger Entry via referenceId (Payout Ledger)

Every `LedgerEntry` document requires a caller-supplied `referenceId` (the Stellar transaction hash or an idempotency key). A unique index on `referenceId` ensures that replayed webhook deliveries (Stellar's at-least-once event delivery) produce exactly one row. The service catches error code `11000` on the insert and returns early without error — the webhook is acknowledged as already processed.

This makes the entire settlement pipeline idempotent end-to-end.

### 3. Atomic Conditional Update (Ownership Transfer, Lifecycle)

For state-machine transitions (ownership transfer: `pending → approved/rejected/cancelled`; lifecycle: `DRAFT → PENDING_VERIFICATION`, etc.) the service uses:

```ts
const result = await Collection.updateOne(
  { _id: id, status: "pending" },   // ← guard condition
  { $set: { status: "approved" } },
);
if (result.modifiedCount === 0) {
  // document was already transitioned by a concurrent request
  throw new ConflictError("Transfer already decided.");
}
```

This is a single atomic operation at the MongoDB engine level. No two concurrent writers can both see `modifiedCount === 1`. The loser always gets `0` and is surfaced as `409`.

For the lifecycle state machine, the same pattern uses an additional `version` field:

```ts
await Prompt.updateOne(
  { _id: id, version: readVersion },
  { $set: { lifecycle: newState }, $inc: { version: 1 } },
);
```

### 4. Upsert with `$setOnInsert` (Entitlement Grant)

The entitlement grant path (called from both the fulfillment job and the indexer) uses:

```ts
await Entitlement.updateOne(
  { walletAddress, promptId },        // ← filter
  { $setOnInsert: { grantedAt, source } },
  { upsert: true },
);
```

MongoDB guarantees this is atomic: if a document matching the filter already exists, `$setOnInsert` fields are ignored and no write occurs. The first concurrent writer creates the document; all subsequent concurrent writers are no-ops. No error is thrown and no duplicate is created.

### 5. Domain Invariant Pre-Checks

All five strategies above are backed by `DomainInvariantsService` checks that run **before** the database write:

- `assertNoSelfPurchase` (INV-02) before purchase insert
- `assertExactPayoutSplit` (INV-04) before split config write
- `assertValidLifecycleTransition` (INV-05) before state update
- `assertListableStatus` (INV-09) before any publish attempt
- `assertEntitlementIntegrity` (INV-10) after grant to verify consistency

If any invariant fails, the request is rejected before touching the database, eliminating a class of concurrency bugs.

---

## What Is Not Covered (and Why)

| Path | Reason not covered |
|------|-------------------|
| Smart contract mutations | Soroban handles all on-chain atomicity. The contract is the source of truth; the server only indexes events. |
| Search index | The search index is rebuilt from the authoritative DB; eventual consistency is acceptable. |
| Draft auto-save | Drafts are user-local and non-authoritative. Last-write-wins is intentional. |
| Analytics counters | Approximate counts are acceptable; no idempotency required. |

---

## Running the Concurrency Tests

```bash
# Run the full concurrency stress suite
npm --prefix server test -- concurrencyStress

# Run with verbose output to see per-test timing
npm --prefix server test -- concurrencyStress --reporter=verbose
```

---

## Adding a New Mutation Path

If you add a new mutation path that creates irreversible records (payments, transfers, grants), follow this checklist:

1. **Identify the natural idempotency key** (tx hash, composite business key).
2. **Add a unique MongoDB index** on that key.
3. **Catch error code 11000** in the service and map to HTTP 409 or a silent no-op depending on the semantics.
4. **Add a domain invariant** in `DomainInvariantsService` if it does not already exist.
5. **Add a concurrency scenario** to `server/src/tests/concurrencyStress.test.ts` with at least:
   - N concurrent duplicate submissions → exactly 1 success, N-1 conflict errors
   - Post-storm invariant assertion
6. **Document the strategy** in the table at the top of this file.
