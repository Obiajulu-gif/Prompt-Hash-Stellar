# Durable checkpoints around external side effects (Issue #1175)

External systems (Soroban/Horizon, outbound webhooks, third-party mints) cannot
join a MongoDB transaction. A process can die after the remote system applied an
effect but before the local write, or after writing intent but before sending
anything. This document describes the checkpoint module that makes those cases
explicit and recoverable.

## Components

| Component | Purpose |
| --- | --- |
| `server/src/models/ExternalSideEffectCheckpoint.ts` | One durable row per logical effect, uniquely keyed by `(operationId, effectKey)`. Stores only a request hash, deterministic external reference, state history and operator-facing summary — never prompt text, credentials or full request bodies. |
| `server/src/services/durableSideEffectCheckpoint.ts` | `runDurableSideEffect`, `reconcileSideEffect`, `rollbackSideEffect`, `listUnresolvedSideEffects`. |
| `server/src/tests/durableSideEffectCheckpoint.test.ts` | Executable verification of the normal, failure, retry, ambiguity, authorization, exhaustion and rollback paths. |

## Usage

```ts
import { runDurableSideEffect } from "../services/durableSideEffectCheckpoint";

const { outcome, result } = await runDurableSideEffect({
  operationType: "PAYOUT_DISTRIBUTION",
  operationId: payout.id,
  effectKey: "soroban_payout",
  actorId: payout.sellerId,
  payload: { promptId: payout.promptId, amountStroops: payout.amountStroops },
  authorize: () => canReleasePayout(actor, payout),
  effect: ({ externalReference }) => submitSorobanPayout(payout, externalReference),
  describeResult: (tx) => ({ txHash: tx.hash, summary: { amount: payout.amountStroops } }),
});
if (outcome === "replayed") {
  // The effect was already acknowledged; do not send it again.
}
```

`effect` **must** use `externalReference` as the remote idempotency key. Retries
reuse the exact same reference for the same payload, so a remote system that
deduplicates on it cannot apply the effect twice. The reference is
`se_<sha256(operationType, operationId, effectKey, requestHash)[0..32]>` unless
the caller supplies one.

## State machine

```
             authorize=false
                    │
                    ▼
                 DENIED ────── authorize=true ──► IN_PROGRESS ──► COMMITTED
                    ▲                                │  │             │
                    │                                │  │             │ compensate()
              (audit only)                pre-dispatch│  │ambiguous    ▼
                    │                          error  │  │   error  ROLLED_BACK
                    │                                ▼  ▼
                    └──────────────────────────── FAILED  AMBIGUOUS
                                                     │         │
                                         retry (same ref)   reconcile
                                                     │      ├─ COMMITTED (replay)
                                                     └──────└─ NOT_APPLIED → FAILED (retry)
```

- **IN_PROGRESS** is written *before* the external call, with a lease and an
  attempt token. Only the token holder may finalize the attempt.
- **COMMITTED** means the remote system acknowledged the effect. Subsequent
  calls with the same operation/effect key return `outcome: "replayed"` without
  dispatching.
- **FAILED** means the failure happened before any remote commit (connection
  refused, validation rejection). It stays retryable with the same reference.
- **AMBIGUOUS** means the request may have been applied (timeout, dropped
  response, socket reset, crashed worker). It is never retried automatically.
- **DENIED** records an authorization refusal without dispatching. A later
  authorized call may still claim the same effect key.
- **ROLLED_BACK** records a successful compensating action. The reference is
  spent: a new attempt must use a new `operationId`.

## Edge cases and recovery

| Situation | Behavior | Recovery |
| --- | --- | --- |
| Two workers call concurrently | Unique `(operationId, effectKey)` index plus an atomic claim; the loser gets `SIDE_EFFECT_IN_PROGRESS`. | Retry after the winner finishes; a committed winner is replayed. |
| Worker dies mid-dispatch | Expired `IN_PROGRESS` lease is quarantined as `AMBIGUOUS` on the next call, not re-dispatched. | Check the remote system, then `reconcileSideEffect`. |
| Ambiguous transport error | Classified by `isAmbiguousSideEffectError` (or a caller-supplied predicate) and stored as `AMBIGUOUS`. | `reconcileSideEffect({ outcome: "COMMITTED" | "NOT_APPLIED" })` with a reason. |
| Retry with changed input | Deterministic reference differs, so the call fails with `SIDE_EFFECT_REFERENCE_DRIFT`. | Start a new operation; never reuse an effect key for new input. |
| Actor changes across retries | `SIDE_EFFECT_AUTHORIZATION_DENIED`; the checkpoint owner is immutable. | Resume as the original actor or open a new operation. |
| Attempt budget exhausted | `SIDE_EFFECT_ATTEMPTS_EXHAUSTED` before dispatch. | Reconcile, or start a new operation after investigating. |
| Crash after remote commit but before local commit | The late commit is persisted best-effort from the `AMBIGUOUS` row; the caller sees `SIDE_EFFECT_LEASE_LOST` and must verify. | Verify remote state, then `reconcileSideEffect` as `COMMITTED`. |
| Compensation fails | Row stays `COMMITTED` with `rollbackError`; callers get `SIDE_EFFECT_ROLLBACK_FAILED`. | Fix the remote issue and retry the compensation; it must be idempotent. |
| Repeated rollback | Returns the already `ROLLED_BACK` checkpoint without running compensation again. | None required. |

Operators can find work with:

```ts
const unresolved = await listUnresolvedSideEffects({ operationId });
```

This returns `AMBIGUOUS` rows and `IN_PROGRESS` rows whose lease is older than
the stale threshold (default 15 minutes).

## Contracts and migration plan

- No existing route, response body or collection changes. The module is
  additive; existing `OperationCheckpoint`/`TransferRun` flows are untouched.
- The new collection is `externalsideeffectcheckpoints` (Mongoose default).
  `externalReference`, and `(operationId, effectKey)`, are unique. Build the
  indexes before enabling call sites; Mongoose's `autoIndex` does this on boot
  in non-production, but production should build explicitly:

  ```js
  db.externalsideeffectcheckpoints.createIndex(
    { operationId: 1, effectKey: 1 },
    { unique: true },
  );
  db.externalsideeffectcheckpoints.createIndex({ externalReference: 1 }, { unique: true });
  db.externalsideeffectcheckpoints.createIndex({ state: 1, updatedAt: 1 });
  ```

- Rollback/forward-fix: disable new call sites first. Rows in `COMMITTED` or
  `ROLLED_BACK` are safe to retain for audit. Before dropping the collection,
  export unresolved (`AMBIGUOUS` / stale `IN_PROGRESS`) rows so operators can
  still reconcile the remote state; dropping the collection loses the only
  local record of in-flight effects.
- Retention: terminal rows can be pruned after the reconciliation window, but
  never prune `AMBIGUOUS` or active `IN_PROGRESS` rows.
