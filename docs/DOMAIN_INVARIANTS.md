# Domain Invariants Guide (Issue #832)

## Overview
This document specifies the 10 core domain invariants enforced across Prompt Hash Stellar to guarantee marketplace integrity, prevent invalid state mutations, and protect user balances and creator rights.

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
