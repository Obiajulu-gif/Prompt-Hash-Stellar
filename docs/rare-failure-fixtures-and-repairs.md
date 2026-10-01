# Rare Failure Modes Fixtures & Manual Repair Paths

## Overview
To allow contributors to reproduce, test, and repair rare edge cases without constructing fragile local test data by hand, Prompt Hash Stellar maintains deterministic test fixtures for rare failure modes.

## Available Failure Mode Fixtures
Located in `src/test/fixtures/rareFailureFixtures.ts`:

1. **`ORPHANED_ONCHAIN_PURCHASE`**
   - **Scenario**: Payment confirmed on-chain on Stellar, but local indexing failed mid-transaction.
   - **Repair Command / Path**: Execute `OperationRecoveryService.syncUnclaimedPurchase(txHash)`.

2. **`DESYNCED_PROMPT_CONTENT_HASH`**
   - **Scenario**: IPFS content CID payload hash mismatches Soroban contract committed content hash.
   - **Repair Command / Path**: Execute `repinIpfsContent(promptId, verifiedContent)`.

3. **`STALE_PAYOUT_LEDGER_GAP`**
   - **Scenario**: Ledger indexing missed sequence range during network partition.
   - **Repair Command / Path**: Execute `payoutReconciliationService.reindexRange(startLedger, endLedger)`.

## Running Validation
Run automated schema validation and repair flow tests:
```bash
npx vitest run src/test/rareFailureFixtures.test.ts
```
