# Creator Draft & Publish Workflow

This note records how the creator draft/publish workflow satisfies three earlier product
issues whose behavior is implemented in the files touched by the combined draft-lifecycle
work merged via PR #729 (commit `a21870a`, "protect draft ownership and session integrity
across wallet disconnects and network changes").

The issues below were kept together with #680 because they live in the same surfaces —
`src/hooks/useDraftAutoSave.ts` and `src/pages/sell/CreatePromptForm.tsx` — and the
ownership/session rewrite (merged already as #680) preserves, integrates, and re-tests their
existing machinery.

## Related Issues

| Issue | Title | Where implemented |
|-------|-------|------------------|
| #458 | [Creator] Add encrypted payload size estimator before publication | `CreatePromptForm.tsx` encrypted-payload-size-estimator section; `estimateEncryptedSize` / `wouldExceedPayloadLimit` in `src/lib/validation/listing.ts` |
| #488 | [Creator] Warn when publishing an exact duplicate prompt content hash | `CreatePromptForm.tsx` duplicate-content-hash section; `findPromptByContentHash` in `src/lib/stellar/promptHashClient.ts`; final submit gate via `duplicateWarning` / `duplicateConfirmed` |
| #680 | Seller draft lifecycle can lose unsynced changes across wallet disconnects and network changes | `src/hooks/useDraftAutoSave.ts`, `CreatePromptForm.tsx`, `src/pages/sell/DraftManager.tsx` |
| #710 | Creator draft autosave does not include conflict resolution for multi-tab editing | `src/hooks/useDraftAutoSave.ts` (last-writer detection, draft backup audit trace, `conflict` / `resolveConflict`) |

## What the combined change preserves

- **#458 payload estimator** — the estimator renders a live byte count of the encrypted
  payload (plaintext, ciphertext, IV, wrapped key) against the on-chain limit and blocks
  submission while over the limit.
- **#488 duplicate-hash guard** — the form fingerprints the plaintext content hash and
  queries the contract for an existing listing; a match raises a warning the creator must
  explicitly confirm, and the final submit path refuses to proceed without that
  confirmation.
- **#710 multi-tab conflict resolution** — each autosave boundary stamps a revision and
  appends an audit-trail entry so another tab's writes are detected on a fresh draft; the
  creator resolves the conflict (keep/revert) instead of silently losing edits.

## Verification

- `src/hooks/useDraftAutoSave.test.tsx` — multi-tab `#710` conflict describe + new `#680`
  ownership/session describe (12 tests).
- `src/test/integration/CreatePromptFormSessionGuard.test.tsx` — session guards against a
  real hook (3 tests).
- `src/test/integration/create-listing.integration.test.tsx` — end-to-end submit path
  including enrichment and contract call (2 tests).
- Touched files are typecheck-clean; repo-wide pre-existing tsc failures are unrelated.