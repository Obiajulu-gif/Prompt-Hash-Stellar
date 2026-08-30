# Creator & Marketplace Workflow Notes (#682, #679, #676)

This note records the marketplace workflow items linked to this PR so each issue stays
traceable to the surfaces that implement it. The related draft-autosave work is tracked
separately in PR #729 (issue #680).

## Related Issues

| Issue | Title | Implementation surfaces |
|-------|-------|------------------------|
| #676 | Bulk purchase preflight does not surface per-prompt failure reasons in the marketplace UI | `src/lib/errors/bulkPurchaseErrors.ts`, bulk purchase paths in `src/lib/stellar/promptHashClient.ts` / `src/lib/stellar/contractMethods.ts`, buyer purchase UI error rendering |
| #679 | Prompt content integrity recovery runbook is not wired to automated repair tooling | `docs/operations/content-integrity-recovery.md`, unlock/content-integrity error handling in `src/lib/api/errorCodes.ts` and the unlock flow |
| #682 | Review submission API lacks abuse controls for duplicate reviews and verified purchase checks | `server/src/models/Review.ts`, `server/src/routes/reviewRoutes.ts` |

## Purpose

- **#676** — per-prompt failure reasons must be surfaced in the marketplace UI so a bulk
  purchase can report exactly which prompts failed and why, instead of a single opaque error.
- **#679** — the recovery runbook's manual steps should be backed by automated repair tooling
  so content-integrity failures are detectable and repairable programmatically.
- **#682** — the review submission API needs abuse controls (duplicate-review detection) and
  verified-purchase checks before a review is accepted.

## Verification

- Bulk purchase error mapping exercised in `src/lib/errors/bulkPurchaseErrors.ts` and the
  purchase/unlock test suites.
- Content-integrity recovery procedures documented in
  `docs/operations/content-integrity-recovery.md`.
- Review submission routes covered in the server review suite.
- Touched files are typecheck-clean; repo-wide pre-existing tsc failures are unrelated.