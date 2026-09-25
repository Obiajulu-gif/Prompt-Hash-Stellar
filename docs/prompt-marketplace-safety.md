# Prompt marketplace safety behavior

## Imports (#773)

Catalog imports are planned through `planPromptImport`. Each row must have a stable
`externalId` (or an opaque payload reference), valid shared prompt metadata, and a
creator wallet. The planner returns `created`, `updated`, `skipped`, and `invalid`
collections and does not persist data. Re-running the same external IDs is therefore
safe and ownership changes are rejected for remediation rather than silently reassigned.
Payload references are never included in reports or logs. Operators should correct the
invalid rows, rerun the dry run, then commit the approved plan; rollback is performed
by restoring the previous external-ID snapshot.

## Search (#764)

Public search requires active, published, intact listings and excludes flagged,
hidden, private, and highly similar records. Sorts include deterministic `_id`
tie-breakers so identical indexed data produces stable results.

## Reviews (#768)

Reviews require a finalized, non-refunded entitlement and wallet signature. One
review is allowed per buyer/prompt; a repeat submission updates that review. The
buyer wallet and purchase details are not returned as verification evidence.

## Analytics (#765)

Creator analytics are served only after resolving the requested wallet to its owned
prompts. Aggregation returns counts and rates, never buyer identities, and suppresses
the active-buyer cohort below the configured privacy threshold. Views, purchases,
refunds, reviews, and unlock failures are separate event kinds so reporting can be
extended without coupling collection to query code.
