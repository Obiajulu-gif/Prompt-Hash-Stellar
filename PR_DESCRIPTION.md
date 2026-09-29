# Marketplace Rounding Drift Controls

## Summary

Add deterministic, drift-resistant revenue allocation for marketplace purchases and access passes. Fractional payout remainders are carried between settlements so repeated rounding does not silently accumulate as payout drift.

## Changes

- Add a reusable `revenue-rounding` crate to calculate allocations and rounding remainders.
- Persist per-asset, recipient, and revenue-role rounding carries, plus rounding plans for purchases and access passes.
- Apply saved plans when settling escrows, while preserving saved payouts for legacy escrows without rounding plans.
- Expose rounding remainder and cumulative rounding report queries, including the reserved stroops for each asset.
- Add contract tests for rounding behavior and document the architecture.

## Testing

- Contract tests covering rounding behavior were added.
- Tests were not run for this documentation-only commit.

## Before opening a PR

The feature commit `90301bd` is already included in `upstream/main`. A PR from this branch to the current `main` will therefore contain this description file, not the feature implementation.
