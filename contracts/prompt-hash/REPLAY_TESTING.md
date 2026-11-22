# Deterministic Replay Testing for Multi-Actor Mutations

This document describes the deterministic replay test suite in [`src/replay_test.rs`](src/replay_test.rs) for `PromptHashContract`.

## Purpose

Multi-actor smart contract mutations (creators listing/revising prompts, buyers purchasing with splits and referrers, admins pausing/unpausing or resolving disputes, and unauthorized actors probing boundaries) can subtly diverge if state transitions, escrow accounting, or rollback paths depend on non-deterministic ordering or leave partial storage writes on failure.

The replay harness (`ReplayHarness`) executes declarative `ReplayAction` scripts against two completely independent, freshly initialized Soroban `Env` instances (with fixed ledger sequence `10_000` and timestamp `1_700_000_000`) and asserts exact equality of:

- Every step outcome (`StepOutcome::Ok`, `ContractErr(code)`, or `HostErr`).
- Every post-step `StateSnapshot` (ledger timestamp, pause status, platform fee, prompt metadata, all 9 actor/contract token balances, buyer/reseller access matrix, escrow records, dispute states, and `AssetSolvency`).

## Covered Paths

| Path | Test Function | What It Verifies |
| --- | --- | --- |
| **Normal** | `replay_normal_multi_actor_lifecycle_is_deterministic` | Prompt creation with collaborator split, listing revision, multi-buyer purchases (with and without referrer), post-window settlement, license transfer, zero residual liability, and exact replay equivalence. |
| **Failure** | `replay_failure_paths_preserve_state_and_are_deterministic` | Underpayment (`InvalidPaymentAmount`), creator self-purchase (`CreatorCannotBuy`), duplicate purchase (`AlreadyPurchased`), supply exhaustion (`MaxSupplyReached`), and settlement during an open dispute. Verifies atomic rollback (post-failure snapshot equals pre-failure snapshot). |
| **Retry & Recovery** | `replay_retry_paths_after_pause_window_and_dispute_recovery` | Purchase rejected while paused (`ContractIsPaused`) then retried after unpause; premature settlement rejected (`DisputeWindowNotElapsed`) then retried after advancing ledger time; dispute refunded (`DisputeStatus::Refunded`) restoring buyer balance and revoking access, followed by a second buyer purchasing and settling cleanly. |
| **Authorization** | `replay_authorization_paths_enforce_actor_boundaries` | Runs without `mock_all_auths()`, supplying explicit `MockAuth` entries per call. Verifies that `Attacker` cannot pause the contract or modify `CreatorA`'s prompt price, while `Admin` and `CreatorA` succeed with their own signatures. |
| **Interleaved Ordering** | `replay_interleaved_actors_order_determinism` | Compares two orderings of racing buyers and a creator price update on a `max_supply = 1` prompt, verifying each ordering replays deterministically and produces the expected winner and escrow liability. |

## Edge Cases & Recovery / Rollback Behavior

1. **Atomic Rollback on Contract Errors**: In Soroban, any contract entrypoint returning `Err(Error::...)` reverts all storage and token state changes made during that invocation. The failure-path replay test explicitly asserts `snapshots[failed_step] == snapshots[previous_step]` to guarantee zero state or balance drift.
2. **Pause / Unpause Recovery**: Pausing (`set_pause_status(true)`) blocks state-mutating purchases with `Error::ContractIsPaused` without consuming supply or moving tokens. Once unpaused, the exact same `buy_prompt` call succeeds on retry.
3. **Dispute Window & Premature Settlement**: Calling `settle_purchase` before `DISPUTE_WINDOW_SECS` (3 days) elapses fails with `Error::DisputeWindowNotElapsed` and leaves the escrow pending. Retrying after the window elapses settles funds to fee wallet, creator, splits, and referrer, reducing `tracked_liability` to `0`.
4. **Dispute Refund Recovery**: Resolving an open dispute with `refund = true` returns the escrowed payment to the buyer, marks the dispute `DisputeStatus::Refunded`, revokes the buyer's access, and updates `AssetLiability` so solvency (`surplus == 0`) is preserved.
5. **Strict Signer Isolation**: Without `mock_all_auths()`, host-level authorization rejects wrong signers before mutating contract storage, preventing unauthorized pauses or price tampering.

## Contract Compatibility

This change is **test-only** and preserves all existing contract entrypoints, storage keys, error codes, and ABI definitions without modification. No migration is required.

## Running the Tests

```bash
cargo test -p prompt-hash --lib replay_test
```
