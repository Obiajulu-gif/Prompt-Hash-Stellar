# Strict Input Size and Cardinality Limits

This document describes the centralized input size and cardinality limit module in [`src/input_limits.rs`](src/input_limits.rs) for `PromptHashContract`.

## Purpose

Unbounded strings, oversized batches, duplicate collection entries, and combined near-maximum fields can exhaust Soroban CPU/memory/storage budgets or inflate persistent ledger entries. `input_limits` centralizes strict, deterministic bounds and reusable validators for all listing, split, batch, and voucher inputs.

## Enforced Limits

### String & Payload Byte Bounds

| Constant | Limit | Error on Violation |
| --- | --- | --- |
| `MIN_NON_EMPTY_LEN` | `1` byte | Field-specific `Invalid*Length` |
| `MAX_TITLE_LEN` | `120` bytes | `Error::InvalidTitleLength` |
| `MAX_CATEGORY_LEN` | `40` bytes | `Error::InvalidCategoryLength` |
| `MAX_PREVIEW_LEN` | `280` bytes | `Error::InvalidPreviewLength` |
| `MAX_ENCRYPTED_PROMPT_LEN` | `4,096` bytes | `Error::InvalidEncryptedPromptLength` |
| `MAX_WRAPPED_KEY_LEN` | `256` bytes | `Error::InvalidWrappedKeyLength` |
| `MAX_IMAGE_URL_LEN` | `512` bytes | `Error::InvalidImageUrlLength` |
| `MAX_IV_LEN` | `64` bytes | `Error::InvalidIvLength` |
| `MAX_TAG_LEN` | `32` bytes | `Error::InvalidCategoryLength` |
| `MAX_VOUCHER_BYTES` | `256` bytes | `Error::InvalidVoucher` |
| `MAX_TOTAL_LISTING_BYTES` | `5,500` bytes (aggregate) | `Error::InvalidMetadata` |

### Collection Cardinality Bounds

| Constant | Limit | Error on Violation |
| --- | --- | --- |
| `MAX_SPLITS` | `10` unique recipients (`<= 10,000` bps total, non-zero bps each) | `Error::TooManySplits` / `Error::DuplicateSplitRecipient` / `Error::InvalidSplits` |
| `MAX_TAGS` | `8` unique tags | `Error::InvalidCategoryLength` |
| `MAX_BUNDLE_PROMPTS` | `20` unique prompt IDs | `Error::InvalidBundle` / `Error::DuplicatePromptId` |
| `MAX_BULK_PURCHASE_SIZE` | `20` unique prompt IDs | `Error::BulkPurchaseTooLarge` / `Error::DuplicatePromptId` |
| `MAX_BATCH_QUERY_IDS` | `50` unique prompt IDs | Caller-supplied error / `Error::DuplicatePromptId` |

## Edge Cases & Recovery / Rollback Behavior

1. **Pure Pre-Mutation Validation (Zero Partial Writes)**: Every validator in `input_limits` is pure and side-effect-free. Rejecting an oversized string, aggregate payload overflow, duplicate tag/recipient/ID, or oversized batch occurs before any storage write or token transfer, guaranteeing atomic rollback with zero state drift.
2. **Checked Arithmetic**: Aggregate byte-length and split basis-point sums use `checked_add`, returning `Error::ArithmeticOverflow` rather than wrapping.
3. **Retryability**: Because failed validations leave no state or nonce consumed, callers can trim or deduplicate their payload and immediately retry the same operation.
4. **Authorization Ordering**: `validate_authorized_splits_update` checks `caller == expected_owner` first and returns `Error::Unauthorized` before evaluating cardinality rules, preventing unauthorized callers from mutating or probing owner-only configuration.

## Contract Compatibility & Migration

- **Zero ABI / Storage Breaking Changes**: All limits match or refine existing contract invariants and reuse existing `Error` variants. Existing on-chain prompts, bundles, and splits remain valid; no storage migration is required.

## Running the Tests

```bash
cargo test -p prompt-hash --lib input_limits
```
