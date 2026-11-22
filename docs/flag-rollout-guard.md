# Feature-Flag Rollout Guard & Automatic Rollback Verification

Issue: #988. Policy: `server/src/services/flagRolloutGuard.ts`
(tested by `server/src/tests/flagRolloutGuard.test.ts`). Persistence and
per-user hashing stay in `server/src/services/featureFlagService.ts` —
the guard adds no storage schema changes.

## CI note (Playwright workflow)

The `Install dependencies` step in `.github/workflows/playwright.yml` failed
with `YN0078: Invalid resolution typescript@npm:^5.0.0 → npm:6.0.3`. The
Yarn `resolutions` entry pins `typescript` to a range that resolves to a
major version (6.x) outside the project's supported range. Fix: align the
`resolutions` override with the TypeScript major the workspace actually uses
(`^5.x`), or remove the override, then regenerate `yarn.lock`. Do not bypass
the resolution check in CI. The upload-artifact step only reports the failed
install; it is not the root cause.

## Rollout

1. Declare scope (`marketplace|settlement|payouts|auth|indexer|global`),
   environment, and percentage.
2. Call `evaluateRolloutGuard(req, signals)` with observed health
   (`errorRate`, `p1Incident`, `invariantViolations`).
3. Roll out only when `allow === true`. When `requireRollback === true`,
   disable the flag immediately (`PATCH /api/flags/:name {"status":"disabled"}`)
   instead of ramping further.

API enforcement: a `PATCH /api/flags/:name` that ramps a flag (non-disabled
status with `rolloutPercentage`) must include `rolloutHealth`
(`errorRate`, `p1Incident`, `invariantViolations`). Missing health is refused
with 400; a blocked rollout returns HTTP 409 with the guard reasons. The guard
runs before any write.

Guards: error-rate ceiling 5%; `settlement|payouts|global` capped at 10% in
production without staging soak; any P1 or invariant violation blocks and
orders a rollback; percentages must be within 0..100.

## Emergency disablement

`POST /api/flags/:name/emergency-disable` forces the flag to `disabled` in
all environments in one call. It does not require `rolloutHealth` and is
audited on a best-effort basis (`requireEvidence: false`), so it works even
when audit storage is down. The response includes `verification` and
`auditRecorded`.

## Rollback verification

After disabling, call `verifyRollback({ flagDisabledEverywhere,
noPartialWrites, invariantsPass, noLedgerDrift })`. The rollback is
complete only when `verified === true`:

- flag reads `false` in every environment (no stale cache/DB row),
- indexer, webhook outbox, and entitlement cache agree (no partial writes),
- domain invariants pass (entitlement ↔ purchase, ledger zero-drift),
- no ledger/settlement drift vs. on-chain state.

The emergency-disable endpoint accepts the three domain checks as request
body booleans (`noPartialWrites`, `invariantsPass`, `noLedgerDrift`). Any
check omitted or not exactly `true` is reported as a failure, so verification
stays incomplete until all three are explicitly supplied as true and every
environment is disabled.

## Edge cases & recovery

- DB error during evaluation → safe fallback (`safeFallback`), same as
  `featureFlagService.evaluateFlag`.
- Experimental flag without `userId` → disabled (fail-safe).
- Missing or malformed `rolloutHealth` on a ramp → 400, no write.
- Audit storage down during emergency disable → disablement still applied,
  `auditRecorded: false`.
- Rollback verification fails → keep flag disabled, page maintainer,
  repair via `operationRecoveryService` (`RETRY`/`ROLLBACK`/`MANUAL_REVIEW`),
  replay quarantined events, then re-verify before any re-rollout.
