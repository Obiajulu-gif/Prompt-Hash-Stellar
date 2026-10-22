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
