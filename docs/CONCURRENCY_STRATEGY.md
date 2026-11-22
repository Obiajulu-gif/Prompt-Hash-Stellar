# Concurrency Strategy — Issue #975

Documents the guards, failure modes, and recovery steps for race-prone mutations in PromptHash Stellar.

## Guards in use

| Mutation | Guard | Error on conflict |
|---|---|---|
| `buy_prompt` (purchase insert) | Unique compound index `{ buyerAddress, promptId }` | `DuplicateKeyError` → HTTP 409 |
| Price / metadata update | Optimistic version field `_version` | `StaleVersionError` → HTTP 409 |
| Webhook / event delivery | Idempotency key store (atomic check-and-set) | Replay → return cached response; conflict → HTTP 409 |
| Entitlement grant | Upsert with `$setOnInsert` | No-op (idempotent) |
| Lifecycle transition | Versioned conditional update | `StaleVersionError` → HTTP 409 |
| Timeline page | `(createdAt, _id)` composite cursor after visibility filtering | Reuse the cursor; inserts or permission changes do not shift the page |
| Maintainer action | Explicit approval linked to signed intent and outcome receipts | Block until approved; review the receipt on success or failure |

## Duplicate-submission & stale-version contracts (#1041)

`server/src/tests/concurrencyContracts.test.ts` exercises these contracts
against a REAL in-memory MongoDB (not mocks), so the database-level
guarantees — unique-index atomicity and the version compare-and-swap — are
what is actually asserted:

| Contract | Proven behavior under test |
|---|---|
| Missing / oversized `Idempotency-Key` | HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`; handler never runs |
| Concurrent duplicate submissions (same key) | Exactly one handler execution; losers get HTTP 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS` or a replay with `Idempotent-Replayed: true`; exactly one durable `(scope, key)` row |
| Replay (same key, same body) | Stored response returned with `Idempotent-Replayed: true`; handler not re-executed |
| Key reuse with a different payload | HTTP 409 `IDEMPOTENCY_KEY_CONFLICT` |
| Expired key | HTTP 409 `IDEMPOTENCY_KEY_EXPIRED`; handler not re-run |
| Concurrent writers, same `expectedVersion` | Exactly one wins the compare-and-swap; version increments once |
| Sequential stale write | Rejected (`matched: false`) → controller HTTP 409 with `currentVersion` so the client can refresh and retry |
| Purchase re-submission | 201 on first write, 200 `Already purchased.` afterwards, exactly one row |
| Endpoint guards | HTTP 400 for missing fields or a collection outside the allowlist, HTTP 404 for an unknown prompt |

`server/src/tests/duplicateSubmissionConcurrency.test.ts` adds a deterministic,
DB-free layer over the gate itself: N concurrent submissions reserve the key
exactly once, a duplicate never re-runs the controller, failed outcomes and
captured authorization denials replay rather than re-execute, conflicting
payloads and expired keys are rejected, and keys are scoped per actor.

Shared helpers live in `server/src/tests/helpers/` (`realMongo.ts`,
`httpApp.ts`) so future route suites reuse the real-Mongo + ephemeral-HTTP
harness. The suites skip themselves gracefully when mongodb-memory-server is
unavailable.

Authorization: `/api/versions/*` carries no session auth today (only
`express.json` plus `requireIdempotency` on the mutating routes), so the
enforced guards are exactly those listed above — key requirement, payload
validation, and the collection allowlist. Adding session auth would be a
contract change beyond #1041.

### Known edge case — Purchase TOCTOU (`POST /api/versions/purchase`)

`RecordPurchase` performs check-then-insert (`findOne` → `create`). Two
concurrent submissions **with different idempotency keys** (or any caller
bypassing `requireIdempotency`) can both observe "no purchase" and both
insert, producing duplicate `Purchase` rows. It is not closed in this change:

- A unique index on `{ promptId, buyerWallet }` would break the indexer, which
  upserts on `{ promptId, buyerWallet, txHash }` to support re-purchase after
  revocation under a new transaction hash (`server/src/services/indexer.ts`).
- A single atomic upsert **without** a unique index does not serialize
  concurrent inserts — verified during #1041: 3 concurrent upserts produced 3
  rows.

Detection and recovery already exist (see *Failure modes* #1): the dedup
monitor (`server/scripts/dataIntegrityMonitor.ts`) flags duplicates and
`server/scripts/repairEntitlement.ts --dry-run` estimates the repair before it
is applied.

Remediation options (a product decision on whether re-purchase is legal is
required first):

1. Partial unique index excluding revoked purchases, once re-purchase
   semantics are confirmed.
2. Route-level single flight: reject concurrent purchases for the same
   `(promptId, buyerWallet)` at the gate instead of in the controller.
3. Keep the layered design: the gate's unique `(scope, key)` index is the
   authoritative duplicate-submission guard for this route (it runs before
   `RecordPurchase`), the controller is best-effort, and the dedup monitor
   covers the residual gap.

### Idempotency replay response format (fixed in #1041)

The gate captures the handler's response to replay it later. `res.json()`
delegates to `res.send()` with the already-stringified payload, so the send
hook overwrote the captured object with a string and every replay
double-encoded the body — the client received a JSON string instead of the
original response object. The capture now keeps the object passed to
`res.json()`, so a replay is byte-identical to the original response.

Operational notes:

- Records written before this fix (retention window 24h — see
  `IDEMPOTENCY_RETENTION_MS`) still hold the stringified body and replay the
  double-encoded payload until they expire. Clients that get a string where
  they expect an object should retry with the same key after expiry. No data
  migration is required.
- Rollback is symmetric: the previous code replays object-form records
  correctly, so reverting the commit is safe at any time.
- No schema change: `IdempotencyRecord.responseBody` remains `Mixed`.

### Duplicate-submission concurrency coverage (this change)

The `/api/versions/*` mutating routes and the generic versioned-update
endpoint are covered for the four required paths:

- **Normal**: matching `expectedVersion` applies once; first keyed request
  executes, later identical requests replay.
- **Failure**: missing/invalid fields, non-integer or negative
  `expectedVersion`, disallowed collections, and invalid ObjectIds are rejected
  before any write. Handler failures are recorded as `failed` and replayed
  without re-running the side effect.
- **Retry**: a stale `expectedVersion` returns HTTP 409 with `currentVersion`;
  the same idempotency key on retry replays the recorded outcome rather than
  re-applying the mutation.
- **Authorization**: the actor is folded into the idempotency store scope, so
  identical keys from different actors never collide or leak replays; captured
  authorization denials (e.g. 403) replay deterministically.

Edge cases and recovery:

- A record stuck in `processing` after a worker crash stays `in_progress`
  until its TTL lapses, then reports `expired`. Do not retry the side effect
  under the same key while `in_progress`.
- A concurrent duplicate that arrives while the first request is still running
  receives `IDEMPOTENCY_REQUEST_IN_PROGRESS` (409) and must back off and retry.
- The conditional update in `updateWithVersionCheck` is atomic, so two
  concurrent writers with the same `expectedVersion` cannot both succeed.
- Rejected requests perform no writes; there is nothing to roll back for them.

## Retry storm handling

- Clients must use exponential back-off with jitter after a 409.
- Maximum retries: 5. After that, surface a user-visible error.
- The idempotency key must be the same on every retry for the same logical operation.

## Failure modes

1. **Missing unique index**: duplicate records may be inserted. Detect via the dedup monitor (`server/scripts/dataIntegrityMonitor.ts`). Recover with `server/scripts/repairEntitlement.ts`.
2. **Version field absent**: last-writer-wins silently overwrites. Detect via the change-history audit trail. Recover by reverting to the last recorded version in `ChangeHistoryEntry`.
3. **Idempotency store unavailable**: fall back to processing the request as new (fail-open). Alert on the `idempotency.store_miss` metric and switch to fail-closed mode by returning 503.

## Rollback steps

1. Revert the deploy that removed a guard.
2. Run `server/scripts/repairEntitlement.ts --dry-run` to estimate affected records.
3. Apply repair, then re-run integrity checks.
4. Issue refunds for any duplicate charges via the payout ledger API.

## Operational recovery notes

- A timeline cursor is opaque and remains valid when records are inserted,
	deleted, or lose visibility. Malformed legacy cursors fall back to the
	historical `_id` boundary; clients can restart from the first page after an
	invalid response.
- Never retry a high-impact action with a new approval or idempotency key.
	Keep the original signed intent receipt, inspect its terminal outcome
	receipt, and create a new approval only after a maintainer has determined
	recovery is safe.
- If receipt persistence fails, treat the protected action as failed and use
	the approval record plus request ID to reconcile before retrying. Do not
	bypass approval during rollback.
