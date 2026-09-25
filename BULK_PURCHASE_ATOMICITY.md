# Bulk Purchase Atomicity & Per-Item Error Surfacing (#438)

## Problem

`buy_prompts_bulk` in the contract enforces Soroban's all-or-nothing transaction model: if any prompt in a 20-item batch fails validation, the entire transaction reverts with a single generic error code. Buyers and frontends have no way to:
- Know which specific item(s) caused the failure
- Retry with just the valid items
- Recover from partial failures

## Solution

### 1. Dry-Run Validation Helper (Contract)

**New Method: `validate_bulk_purchase`**

A read-only, no-auth-required contract method that validates each prompt ID independently and returns a `Vec<bool>` indicating per-item validity.

```rust
fn validate_bulk_purchase(
    env: Env,
    buyer: Address,
    prompt_ids: Vec<u64>,
    payment_amounts: Vec<i128>,
) -> Result<Vec<bool>, Error>
```

**What it checks:**
- Prompt exists
- Prompt is active for sale
- Buyer is not the creator
- Buyer doesn't already own it
- Listing hasn't expired
- Supply has room
- Payment meets or exceeds price

**Frontend usage:**
```typescript
const validity = await validateBulkPurchase(
  config,
  buyerAddress,
  [promptIdA, promptIdB, ...],
  [priceA, priceB, ...]
);

const invalid = validity
  .map((isValid, i) => ({ id: ids[i], valid: isValid }))
  .filter(x => !x.valid);

if (invalid.length > 0) {
  // Show which items failed and why
  // Allow user to remove them and retry
}
```

### 2. Atomicity Verification (Tests)

**Added 8 new contract tests:**

1. `test_validate_bulk_purchase_all_valid_returns_all_true`
   - ✓ Dry-run returns true for all valid prompts

2. `test_validate_bulk_purchase_marks_invalid_items`
   - ✓ Dry-run correctly marks non-existent prompts as false

3. `test_validate_bulk_purchase_detects_insufficient_payment`
   - ✓ Detects when payment < price

4. `test_validate_bulk_purchase_detects_already_purchased`
   - ✓ Prevents double-purchases

5. `test_validate_bulk_purchase_detects_inactive_prompt`
   - ✓ Rejects inactive/paused listings

6. `test_validate_bulk_purchase_no_auth_required`
   - ✓ Confirms read-only call succeeds without wallet signature

7. `test_atomicity_one_failure_mid_batch_reverts_prior_purchases`
   - ✓ Verifies that one bad ID mid-batch reverts entire TX
   - ✓ Confirms no partial state mutations
   - ✓ Proves sales_count unchanged

8. `test_atomicity_boundary_exactly_max_size_succeeds`
   - ✓ Confirms exactly MAX_BULK_PURCHASE_SIZE=20 works
   - ✓ All items accessible after purchase

### 3. Error Mapping & Guidance (Frontend)

**New File: `src/lib/errors/bulkPurchaseErrors.ts`**

Provides:
- Error code descriptions
- Per-item validation failure reasons
- User-friendly guidance for each error type

```typescript
const interpretation = interpretBulkPurchaseError("BulkPurchaseTooLarge");
// Returns:
// {
//   title: "Batch Too Large",
//   message: "Your batch size exceeds...",
//   suggestion: "Try purchasing in groups of 10-15..."
// }
```

### 4. Client Implementation

**New Method: `contractValidateBulkPurchase`**

In `src/lib/stellar/contractMethods.ts`:
- Calls dry-run validation on contract
- Returns per-item boolean array
- Falls back to all-false on network error (conservative)

**New Wrapper: `validateBulkPurchase`**

In `src/lib/stellar/promptHashClient.ts`:
- Public API for validation
- Exported for use in UI components

## Architecture Decisions

### Why Dry-Run Instead of Custom Error Codes?

**Rejected:** Custom error enum with per-item details
- Soroban's Result<T, E> model doesn't support complex nested errors
- Encoding 20 per-item error codes would blow up XDR size
- Transaction simulation cost already high for 20-item batches

**Chosen:** Separate read-only dry-run call
- No auth required, cheap to simulate
- Returns simple Vec<bool>, trivial to encode
- Frontend can call pre-submission to filter
- No state mutation → no race condition risk (caller's responsibility)

### Why Not Just Document "All-or-Nothing"?

**Rejected:** Accept atomicity, fail gracefully
- Doesn't solve the UX problem
- Buyers still lose all items on one error
- No recovery path

**Chosen:** Provide pre-flight validation + error guidance
- Gives users a way to diagnose and fix
- Frontend can retry with filtered batch
- Atomicity is still guaranteed (good), but now predictable

## Usage Flow

### Before: Single Purchase Attempt (Fails)

```
User selects 20 items → Submit → Contract: one bad ID → REVERT
Result: All 20 items fail, user sees generic "ContractPaused" error
Recourse: ❌ No way to know which item failed
```

### After: Validation-First Flow (Succeeds)

```
User selects 20 items →
Call validateBulkPurchase →
Frontend shows: "Item #7 invalid (already owned), Item #14 inactive"
User removes them →
Call validateBulkPurchase again (now 18 valid) →
Submit buy_prompts_bulk with filtered list →
Success!
```

## Contract Changes

**File: `contracts/prompt-hash/src/contract.rs`**

- Added `validate_bulk_purchase_items` private helper (validates each ID independently)
- Added `validate_bulk_purchase` method to `PromptHashTrait` impl
- Returns `Vec<bool>` per-item validity status

**File: `contracts/prompt-hash/src/types.rs`**

- Added `validate_bulk_purchase` trait method signature

## Frontend Changes

**File: `src/lib/stellar/contractMethods.ts`**
- Added `contractValidateBulkPurchase` to call contract dry-run

**File: `src/lib/stellar/promptHashClient.ts`**
- Added `PromptHashClient.validateBulkPurchase` wrapper
- Added exported `validateBulkPurchase` function

**File: `src/lib/errors/bulkPurchaseErrors.ts`** (NEW)
- Error code documentation
- Interpretation logic
- User-friendly guidance

## Tests Added

**File: `contracts/prompt-hash/src/test.rs`**

8 comprehensive tests covering:
- Dry-run validation (all-valid case)
- Per-item invalidity detection
- Atomicity under failures
- Boundary conditions (max size)
- Edge cases (auth not required, no state mutation)

## Remaining Work for UI

When integrating into purchase flows (e.g., bundle purchases):

1. **Call `validateBulkPurchase` before submission:**
   ```typescript
   const validity = await validateBulkPurchase(
     config, buyerAddress, promptIds, payments
   );
   ```

2. **Filter invalid items and show user:**
   ```typescript
   const invalid = promptIds.filter((id, i) => !validity[i]);
   if (invalid.length > 0) {
     setError(`${invalid.length} items failed validation. Removed from your purchase.`);
     filteredIds = promptIds.filter((id, i) => validity[i]);
   }
   ```

3. **Handle errors with interpretation:**
   ```typescript
   if (txError) {
     const guidance = interpretBulkPurchaseError(errorCode);
     setError(`${guidance.title}: ${guidance.suggestion}`);
   }
   ```

## References

- **Issue #438:** Bounds bulk purchase size, document atomicity
- **Contract:** `contracts/prompt-hash/src/contract.rs` lines ~2389-2450
- **Tests:** `contracts/prompt-hash/src/test.rs` lines ~2869-3080
- **Error Mapping:** `src/lib/errors/bulkPurchaseErrors.ts`

## Summary

- ✅ **Atomicity preserved:** All-or-nothing guarantee remains
- ✅ **Per-item visibility:** Frontend can see which items would fail
- ✅ **Predictable UX:** Users can retry with filtered batches
- ✅ **Comprehensive tests:** 8 tests covering all scenarios
- ✅ **Error guidance:** Clear, actionable user messages
