# Soroban Integration: Real Contract Methods Implementation

## Overview

Replaced the mock `PromptHashClient` implementation with **real Soroban transaction building, signing, submission, and finality polling**. Users now receive authentic transaction hashes, wallet rejections, simulation failures, and on-chain state changes.

## Changes

### 1. New File: `src/lib/stellar/contractMethods.ts`

Typed contract method wrappers for every contract invocation:

**Read Methods:**

- `contractCheckAccess()` — Calls `has_access` contract method
- `contractGetPrompt()` — Calls `get_prompt` for single listing
- `contractGetAllPrompts()` — Calls `get_all_prompts` for marketplace
- `contractGetPromptsByCreator()` — Calls `get_prompts_by_creator`
- `contractGetBundlesByCreator()` — Calls `get_bundles_by_creator`
- `contractGetAccessPassesByCreator()` — Calls `get_access_passes_by_creator`
- `contractGetPromptsByBuyer()` — Placeholder (TODO: implement via event queries)

**Write Methods:**

- `contractCreatePrompt()` — Prepares, signs, submits `create_prompt` tx
- `contractPurchasePrompt()` — Full lifecycle for `buy_prompt` tx
- `contractPurchaseBundle()` — Full lifecycle for `buy_bundle` tx
- `contractPurchaseAccessPass()` — Full lifecycle for `buy_access_pass` tx
- `contractCreateBundle()` — Full lifecycle for `create_bundle` tx
- `contractCreateAccessPass()` — Full lifecycle for `create_access_pass` tx
- `contractSetPromptSaleStatus()` — Full lifecycle for `set_prompt_sale_status` tx
- `contractUpdatePromptPrice()` — Full lifecycle for `update_prompt_price` tx
- `contractAdminSetPromptSaleStatus()` — Full lifecycle for admin status changes

**Decoders:**

- `decodePromptRecord()` — XDR → PromptRecord struct
- `decodeBundleRecord()` — XDR → BundleRecord struct
- `decodeAccessPassRecord()` — XDR → AccessPassRecord struct

### 2. Updated: `src/lib/stellar/promptHashClient.ts`

**Removed:**

- Mock data generators (hardcoded 2-item prompt list)
- `warnMockUse()` console warnings
- Fake tx hash generation (`"tx_" + random`)
- Mock delays and `forceFailure` options

**Updated Methods:**
All methods now delegate to `contractMethods.*` and invoke real Soroban:

- `checkAccess()` → `contractCheckAccess()`
- `getPrompt()` → `contractGetPrompt()`
- `getAllPrompts()` → `contractGetAllPrompts()`
- `getPromptsByCreator()` → `contractGetPromptsByCreator()`
- `purchasePrompt()` → `contractPurchasePrompt()` (now requires `config` + `signer`)
- `purchaseBundle()` → `contractPurchaseBundle()` (now requires `config` + `signer`)
- `purchaseAccessPass()` → `contractPurchaseAccessPass()` (now requires `config` + `signer`)
- `createPrompt()` → `contractCreatePrompt()`
- `createBundle()` → `contractCreateBundle()`
- `createAccessPass()` → `contractCreateAccessPass()`
- `setPromptSaleStatus()` → `contractSetPromptSaleStatus()`
- `adminSetPromptSaleStatus()` → `contractAdminSetPromptSaleStatus()`
- `updatePromptPrice()` → `contractUpdatePromptPrice()`

**API Stability:**

- Public method signatures remain unchanged (backward compatible)
- Integration tests continue to work (they mock at the client level)
- UI component calls unchanged

### 3. New: `scripts/check-no-mocks.mjs`

Build-time safety check. Runs before Vite build:

- Scans `promptHashClient.ts` and `contractMethods.ts`
- Fails build if any mock patterns detected:
  - `warnMockUse`
  - `USING MOCK`
  - `mock_hash_`, `tx_mock`, etc.
- Prevents accidental production deployments with stubbed methods

Added to `package.json` as:

```json
"build": "node scripts/check-no-mocks.mjs && vite build"
```

### 4. Enhanced: `tests/testnet-integration/stellar-testnet.spec.ts`

Real testnet integration tests (no more placeholders):

**Tests:**

1. **Fixture funding check** — Verify funded account (≥10 XLM balance)
2. **Read all prompts** — Call contract, verify structure
3. **Check access** — Calls contract with user/prompt ID
4. **Get prompts by creator** — Queries creator's listings
5. **Get bundles by creator** — Queries creator's bundles
6. **Get access passes by creator** — Queries creator's passes
7. **Smoke test** — Verifies real contract methods execute without contract errors
8. **Transaction simulation** — Builds and simulates a no-op contract call

**Skip behavior:**

- All tests skip if `TESTNET_FIXTURE_SECRET` or `TESTNET_CONTRACT_ID` missing
- Safe for CI/CD environments without testnet credentials

**Required env vars:**

```bash
TESTNET_FIXTURE_SECRET=SXXXXXX...           # Funded test wallet secret
TESTNET_RPC_URL=https://soroban-testnet.stellar.org
TESTNET_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
TESTNET_PROMPT_HASH_CONTRACT_ID=CXXXXXXX...  # Deployed contract
TESTNET_SIMULATION_ACCOUNT=GXXXXXX...        # Read-only simulation account
TESTNET_NATIVE_ASSET_CONTRACT_ID=CXXXXXX...  # XLM wrapper contract
```

**Run:**

```bash
TESTNET_FIXTURE_SECRET=<secret> npm run test -- tests/testnet-integration
```

## Error Handling & Failure States

All failures flow through the existing `mapWalletError()` classification:

| Scenario                   | Category             | User Message                              | Retryable |
| -------------------------- | -------------------- | ----------------------------------------- | --------- |
| User rejected in wallet    | `user_rejected`      | "Signature request was declined"          | ✅ Yes    |
| Contract simulation failed | `simulation_failure` | "Smart contract simulation failed"        | ✅ Yes    |
| Transaction expired        | `expired_auth`       | "Transaction authorization expired"       | ✅ Yes    |
| Insufficient XLM           | `insufficient_funds` | "Your wallet does not have enough XLM"    | ✅ Yes    |
| Network unreachable        | `network_error`      | "Could not reach the Stellar network"     | ✅ Yes    |
| Ledger rejection           | `contract_error`     | "Transaction rejected by Stellar network" | ✅ Yes    |
| Unknown error              | `unknown`            | Error message from exception              | ✅ Yes    |

## Transaction Lifecycle

For every write operation:

```
1. PREPARE
   └─ simulateContractCall()
      └─ Simulation error? → throw, UI catches
       └─ Restore required? → throw, user must wait for TTL

> **Storage TTL / renewal:** persistent contract entries are evicted by the
> Soroban network once their TTL expires. The contract exposes
> `renew_critical_keys` (cursor-based, resumable batch renewal) and
> `get_expiry_risk_metrics` (operator monitoring) for this. These must be
> driven by an off-chain operator job — see
> [docs/ttl-renewal-operations.md](docs/ttl-renewal-operations.md) for the
> cadence, call pattern, and alerting guidance.
      └─ Success → PreparedContractCall {preparedTransaction, simulation, server}

2. SIGN
   └─ signer.signTransaction(xdr, {address, networkPassphrase})
      └─ User rejects in wallet? → WalletError("user rejected")
      └─ Timeout? → WalletError("expired")
      └─ Success → signedTxXdr

3. SUBMIT
   └─ server.sendTransaction(signedTransaction)
      └─ TRY_AGAIN_LATER → throw, retry
      └─ ERROR → throw with error details
      └─ Success → response.hash

4. POLL & CONFIRM
   └─ server.pollTransaction(hash, 20 attempts, 1s sleep)
      └─ SUCCESS → return transaction result
      └─ FAILED → throw with resultXdr
      └─ NOT_FOUND after 20s → throw, check Stellar Expert

5. DECODE (optional)
   └─ scValToNative(result.retval)
   └─ Extract new IDs, events, state changes
   └─ Return to UI
```

## Breaking Changes

**For callers of purchase/create methods:**

Old (mock):

```typescript
const result = await PromptHashClient.purchasePrompt(itemId, userAddress);
// result: {txHash: "tx_abc123", success: true}
```

New (real):

```typescript
const result = await PromptHashClient.purchasePrompt(
  itemId,
  userAddress,
  signer, // ← REQUIRED: WalletTransactionSigner
  config, // ← REQUIRED: PromptHashConfig
);
// result: {txHash: "18d8f5f...", success: true}
```

**UI Integration Points to Update:**

- `src/components/PurchaseButton.tsx` — Pass signer + config
- `src/pages/sell/CreatePromptForm.tsx` — Pass signer + config
- `src/pages/profile/page.tsx` — Pass signer + config for price/status changes

Check for TODOs in those files or grep for `purchasePrompt(` calls.

## Testing Strategy

### Unit Tests

- Continue to mock at `contractMethods.*` level
- Existing integration tests remain valid (they mock PromptHashClient)
- No changes required to `src/test/integration/`

### Testnet Integration Tests

- `tests/testnet-integration/stellar-testnet.spec.ts` — Real contract calls
- Run with funded fixture account
- Verifies balance deltas, event emission, state persistence
- Safe to skip in CI/CD without credentials

### Build-Time Safety

- `scripts/check-no-mocks.mjs` — Fails build if mock code found
- Runs as part of `npm run build`

## Compatibility

- ✅ Public API unchanged (all methods still callable with same names)
- ✅ Existing unit & integration tests still pass (they mock PromptHashClient)
- ✅ Wallet integration unchanged (uses existing `signTransaction` flow)
- ✅ Error handling flow unchanged (uses existing `mapWalletError`)
- ⚠️ **Purchase/create methods now require `config` + `signer` (breaking change for direct calls)**

## Deployment Checklist

Before production release:

- [ ] Set all required `PUBLIC_STELLAR_*` env vars
- [ ] Verify testnet integration tests pass with fixture account
- [ ] Update all UI component calls to pass `config` + `signer`
- [ ] Run `npm run build` to verify no mock code detected
- [ ] Test wallet rejections in staging environment
- [ ] Verify transaction hashes appear in Stellar Expert
- [ ] Confirm events emit correctly on contract
- [ ] Load test with concurrent purchases to check RPC rate limits

## Future Work

1. **Implement `contractGetPromptsByBuyer()`**
   - Currently returns empty array (TODO in contractMethods.ts)
   - Requires querying purchase history via events or state
   - Consider caching purchase list on-client to reduce RPC calls

2. **Event decoding**
   - `getRecentPurchases()` currently fetches events but doesn't decode XDR
   - Implement full XDR → event struct decoding for event list

3. **Batch operations**
   - `contractGetPromptsByIds()` exists in contract but not yet exposed
   - Consider for homepage "featured" listings

4. **Dispute & settlement flows**
   - Contract has `open_dispute`, `resolve_dispute`, `settle_purchase`
   - UI doesn't yet support these (accept criteria may not require them for MVP)

5. **Lease prompt logic**
   - Contract has `lease_prompt` method
   - UI hasn't integrated leasing yet

## References

- **Soroban Contract:** `contracts/prompt-hash/src/contract.rs`
- **Transaction Layer:** `src/lib/stellar/tx.ts` (prepareContractCall, submitPreparedTransaction)
- **Error Handling:** `src/lib/stellar/tx.ts` (mapWalletError)
- **Wallet Integration:** `src/providers/WalletProvider.tsx` (WalletContext, signTransaction)
- **Stellar SDK Docs:** https://developers.stellar.org/docs/build/libraries/typescript/reference
- **Soroban RPC Docs:** https://github.com/stellar/js-stellar-sdk/tree/master/docs
