# Domain Invariants Guide (Issues #832 and #1014)

## Overview
This document specifies the 13 core domain invariants enforced across Prompt Hash Stellar to guarantee marketplace integrity, prevent invalid state mutations, and protect user balances and creator rights.

## Core Domain Invariants

| Invariant ID | Name | Description & Why It Matters | Relevant Code Paths |
|---|---|---|---|
| **INV-01** | Non-Negative Price | Prices must be >= 0 stroops; prevents negative balance drains. | `server/src/services/listingValidation.ts` |
| **INV-02** | No Self-Purchase | Creators/sellers cannot buy their own listings; prevents wash trading and fee gaming. | `server/src/services/domainInvariants.ts` |
| **INV-03** | Valid Seller Ownership | Transfers require verified seller ownership prior to sale. | `server/src/models/OwnershipTransfer.ts` |
| **INV-04** | Exact Payout Split | Royalty and payout basis points must total exactly 10,000 (100%). | `server/src/services/payoutLedgerService.ts` |
| **INV-05** | Valid Lifecycle Transition | Prompt lifecycle states follow a strict directed graph (e.g. Draft -> Verification -> Published). | `packages/schema/src/lifecycle.ts` |
| **INV-06** | Unique Token ID | Soroban/NFT token IDs must be globally unique across all prompt records. | `server/src/services/indexer.ts` |
| **INV-07** | Escrow Conservation | Escrow balance = pending payouts + platform fees; prevents fund loss or over-allocation. | `server/src/services/payoutReconciliation.ts` |
| **INV-08** | Rating Bounds & Eligibility | Reviews must score 1-5 and reviewer must hold confirmed prompt purchase entitlement. | `api/reviews/reviews.ts` |
| **INV-09** | Quarantined Prompts Unlistable | Moderated or quarantined content cannot be set to active listed status. | `server/src/services/moderationService.ts` |
| **INV-10** | Entitlement Integrity | User access entitlement must trace directly to fulfilled purchase or authorship. | `server/src/services/entitlementService.ts` |
| **INV-11** | Balance Entry Direction | Ledger entries must have finite amounts; sales are credits, and fees, refunds, and payouts are debits. Legacy positive debit inputs are normalized to negative amounts before append. | `server/src/services/payoutLedgerService.ts` |
| **INV-12** | Ownership Transition | A listing transfer must use the expected current owner and move to a different recipient. The controller retains its compare-and-swap write to prevent stale requests from changing ownership. | `server/src/controllers/transferControllers.ts` |
| **INV-13** | Entitlement Transition Evidence | Grants require a non-empty purchase/repair reference; revocations require a reason and a valid wallet/prompt identity. | `server/src/services/entitlementService.ts` |

## Transition failure, retry, and recovery behavior (#1014)

- **Balance ledger:** entries are immutable and remain idempotent by `referenceId`. Debit entry types are stored as negative amounts even when a legacy caller submits a positive magnitude. Non-finite values and negative sales fail before persistence. A duplicate reference returns the existing entry; attempting to alter its settlement reference remains an error. If a write fails after an on-chain settlement, retry with the same reference and reconcile the ledger against the transaction rather than appending a second entry.
- **Ownership:** request authorization is checked against the indexed current owner; an approval still applies through a conditional compare-and-swap. If the owner changed, the transfer is cancelled instead of overwriting the new owner. Transient storage failure restores an approval claim to `pending` so the recipient can retry before expiration. Do not manually force the owner field; issue a new transfer from the current owner or resolve the underlying stale record.
- **Entitlement:** a grant without an auditable source or a revocation without a reason is rejected before the database write. Repair flows must use the purchase reference (or stable purchase ID fallback) and remain idempotent. If a repair partially fails, rerun the targeted dry-run first, then apply; preserve the audit trail and verify the purchase/refund source before retry.
- These checks are server-side guards and do not change the Soroban contract or stored schema. Existing ledger records are not rewritten; reconcile historic entries through the existing reporting path.

## Property tests (#1135)

`server/src/tests/financialOwnershipInvariants.property.test.ts` checks the financial and ownership invariants against hundreds of generated cases per property, using a small seeded harness in `server/src/tests/support/property.ts` (no extra dependency).

| Area | Property |
|---|---|
| Payout statements | Every statement balances (`gross - fee - refunds === net`); each line splits gross exactly into fee + creator share; the fee is 5% to statement precision; sales never debit and refunds never credit (INV-11). |
| Rollback | A refund exactly reverses its sale: net settlement and fees return to zero. |
| Replay/backfill | Summaries do not depend on event order, and summary status is the worst line status (`failed > pending > settled`). |
| INV-01 / INV-04 / INV-07 / INV-11 | Prices, payout splits, escrow, and ledger direction accept exactly the valid inputs and reject everything else without throwing. |
| INV-12 (stateful) | A random sequence of transfers, some fresh and some stale or forged, only moves ownership from the verified owner to a different account. Replaying a transfer that already succeeded is rejected. |
| INV-02 / INV-03 / INV-10 / INV-13 | No self-purchase or non-owner sale however an address is cased or padded; entitlements always trace to authorship or a purchase; whitespace never counts as evidence. |

**Reproducing a failure.** A failing property prints its counterexample and a replay command:

```bash
cd server
PROPERTY_SEED=<seed> PROPERTY_RUNS=1 npx vitest run src/tests/financialOwnershipInvariants.property.test.ts
PROPERTY_RUNS=5000 npx vitest run src/tests/financialOwnershipInvariants.property.test.ts   # deeper local run
```

### Behaviour tightened by the property tests

| Invariant | Before | After | Migration / rollback |
|---|---|---|---|
| INV-04 | `[20000, -10000]` and `[5000.5, 4999.5]` passed because they sum to 10,000. | Every share must be a whole, non-negative number of basis points. | Stored splits are not rewritten. Before deploying, check for stored splits with negative or fractional shares; they were never valid payouts and need manual review. To roll back, revert `assertExactPayoutSplit`. |
| INV-01 | `NaN`, `Infinity`, or fractional numbers threw a raw `RangeError` from `BigInt()`. | They return a failed `InvariantResult`. | Callers that caught the `RangeError` now get `passed: false` instead, which is the documented contract. |
| INV-12 | Blank owner IDs (`""`, `" "`) could authorize a transition. | All three identities must be non-blank. | No stored data is affected. `transferControllers` already resolves a real owner first, so this only closes the gap at the invariant. |
| Payout statements | A `NaN`, infinite, or negative prompt price spread `NaN` through the statement or made a sale debit the creator. | Such prices count as `0`. The statement stays balanced and finite. | The corrupt price still exists at its source. Use INV-01 at write time and `data:integrity:monitor` to find and fix it. |
