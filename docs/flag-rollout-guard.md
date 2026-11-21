# Feature-Flag Rollout Guard & Automatic Rollback Verification

Issue: #988. Policy: `server/src/services/flagRolloutGuard.ts`
(tested by `server/src/tests/flagRolloutGuard.test.ts`). Persistence and
per-user hashing stay in `server/src/services/featureFlagService.ts` —
the guard adds no storage schema changes.

## Rollout

1. Declare scope (`marketplace|settlement|payouts|auth|indexer|global`),
   environment, and percentage.
2. Call `evaluateRolloutGuard(req, signals)` with observed health
   (`errorRate`, `p1Incident`, `invariantViolations`).
3. Roll out only when `allow === true`. When `requireRollback === true`,
   disable the flag immediately (`PATCH /api/flags/:name {"status":"disabled"}`)
   instead of ramping further.

Guards: error-rate ceiling 5%; `settlement|payouts|global` capped at 10% in
production without staging soak; any P1 or invariant violation blocks and
orders a rollback; percentages must be within 0..100.

## Rollback verification

After disabling, call `verifyRollback({ flagDisabledEverywhere,
noPartialWrites, invariantsPass, noLedgerDrift })`. The rollback is
complete only when `verified === true`:

- flag reads `false` in every environment (no stale cache/DB row),
- indexer, webhook outbox, and entitlement cache agree (no partial writes),
- domain invariants pass (entitlement ↔ purchase, ledger zero-drift),
- no ledger/settlement drift vs. on-chain state.

## Edge cases & recovery

- DB error during evaluation → safe fallback (`safeFallback`), same as
  `featureFlagService.evaluateFlag`.
- Experimental flag without `userId` → disabled (fail-safe).
- Rollback verification fails → keep flag disabled, page maintainer,
  repair via `operationRecoveryService` (`RETRY`/`ROLLBACK`/`MANUAL_REVIEW`),
  replay quarantined events, then re-verify before any re-rollout.

A flag administrator can send olloutHealth with olloutPercentage in a PATCH request to enforce the production guard before a write. A blocked rollout returns HTTP 409. Emergency disablement works even when health is missing or audit storage is down. Verification stays incomplete until all three domain checks are explicitly supplied as true and every environment is disabled.
