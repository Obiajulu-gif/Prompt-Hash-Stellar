# Security Notes: Reentrancy Guard Audit

## Overview

This document audits reentrancy guard coverage across all fund-moving contract entry points in the Prompt Hash Stellar contract. While Soroban's cross-contract call model makes classic EVM-style reentrancy less likely than on Ethereum, non-standard SAC token wrappers can still trigger callbacks during token transfers, creating potential reentrancy risks.

**Audit Date**: August 2026  
**Scope**: All functions that call `token::StellarAssetClient::transfer()` or `transfer_from()`  
**Guard Mechanism**: `InstanceStorage::set_reentrancy_guard()` / `clear_reentrancy_guard()`

---

## Guard Coverage Inventory

### Guarded Fund-Moving Functions

1. `buy_prompt()` via `execute_buy_with_required_price()` - GUARDED
2. `buy_prompt_with_auth()` via `execute_buy_with_required_price()` - GUARDED
3. `lease_prompt()` - GUARDED
4. `buy_prompts_bulk()` - GUARDED
5. `buy_bundle()` - GUARDED
6. `buy_access_pass()` - GUARDED
7. `transfer_license()` - GUARDED
8. `resolve_dispute()` - GUARDED (fixed in audit)
9. `resolve_access_pass_dispute()` - GUARDED (fixed in audit)
10. `settle_purchase()` - GUARDED (fixed in audit)
11. `settle_access_pass_purchase()` - GUARDED (fixed in audit)

---

## Guard Implementation Details

`set_reentrancy_guard()` returns `Error::Reentrancy` if the flag is already set; otherwise it stores the flag in instance storage. `clear_reentrancy_guard()` removes the flag after the protected operation completes. A nested call arriving mid-operation sees the flag and fails atomically.

---

## Permission Changes and Hidden Records

This section documents the authorization model, edge cases, and recovery behavior covered by the tests in `contracts/prompt-hash/src/contract_tests.rs`.

### Authorization Model

- Only the admin may change permissions. A non-admin caller must be rejected and must not alter permission state.
- Only the record owner may hide or unhide a record.
- Revoked grantees lose authorization for previously permitted actions immediately.

### Scenarios Covered

| Path | Scenario | Expected Behavior |
|------|----------|-------------------|
| Normal | Owner grants a permission to an account | Permission is recorded and the grantee can perform the permitted action |
| Normal | Owner hides a record | Record is excluded from public reads; owner can still read it |
| Normal | Owner unhides a record | Record becomes visible again to all readers |
| Failure | Non-owner attempts to grant or revoke a permission | Call fails with an authorization error; permission state is unchanged |
| Failure | Non-owner attempts to hide or unhide a record | Call fails with an authorization error; visibility is unchanged |
| Failure | Operation on a non-existent record | Call fails with a not-found error; no state is written |
| Retry | Repeating a grant for an already-granted permission | Idempotent: state is unchanged and no duplicate entry is created |
| Retry | Repeating a hide on an already-hidden record | Idempotent: record remains hidden without error |
| Retry | Repeating a revoke for an already-revoked permission | Idempotent: state is unchanged |
| Authorization | Revoked grantee attempts a previously permitted action | Call fails with an authorization error |
| Authorization | Hidden record accessed by an unauthorized reader | Read is rejected as if the record does not exist |

### Edge Cases

- Granting and revoking the same permission within a single ledger leaves the final state consistent with the last operation.
- Hiding a record does not alter its underlying data, only its visibility flag.
- Transferring ownership does not leave stale permissions held by the previous owner.
- Cursor round-trips for hidden records succeed; visibility filtering happens at read time.

### Recovery and Rollback Behavior

- Soroban transaction atomicity reverts all storage writes on failure, so no partial permission state persists.
- Hidden-record flags are written in the same transaction as the change; a failed unhide leaves the record hidden.
- Rollback of a permission change is performed by issuing the inverse operation (revoke for grant, unhide for hide) from the owner or admin account.

### Migration

Existing contract entry points and storage keys are preserved. No migration is required, since the tests exercise current behavior without changing storage layout.

---

## Release Readiness

The Release Readiness checklist from `docs/RELEASE_READINESS_CHECKLIST.md` applies to this change and must be included in the PR description.
