# Strict Destination and Content Allow-Lists

This document describes the strict destination and content allow-list module in [`src/allowlist.rs`](src/allowlist.rs) for `PromptHashContract`.

## Purpose

Restricts settlement/payout destinations, marketplace content categories, and content media URL schemes to explicitly allow-listed values so unauthorized payout targets, unapproved categories, or unsafe URL schemes (`http://`, `javascript:`, `data:`, `file:`) are deterministically rejected before state mutation.

## Components

| Component | Limit / Policy | Error on Violation |
| --- | --- | --- |
| `DestinationAllowlist` | Explicit admin-managed `Address` set (max `64` entries) | `Error::Unauthorized` (unlisted / non-admin), `Error::InvalidMetadata` (cap exceeded) |
| `CategoryAllowlist` | Explicit admin-managed `String` set (max `32` entries, non-empty) | `Error::InvalidCategoryLength` (unlisted / empty), `Error::Unauthorized` (non-admin), `Error::InvalidMetadata` (cap exceeded) |
| `validate_content_url_scheme` | Strictly allows `https://`, `ipfs://`, and `ar://` with non-empty host/CID and `<= 512` bytes | `Error::InvalidImageUrlLength` |
| `validate_listing_allowlists` | Unified gate enforcing destination, category, and URL scheme allow-lists | First failing check's `Error` |

## Edge Cases & Recovery / Rollback Behavior

1. **Idempotent Retries on Admin Additions**: Calling `add` with an already-allowed destination or category is a no-op returning `Ok(())` without duplicating entries or consuming cardinality budget.
2. **Immediate Rollback / Revocation**: Calling `remove` strips the target destination or category immediately so subsequent payouts or listings targeting that entry fail with `Error::Unauthorized` / `Error::InvalidCategoryLength`.
3. **Retry After Allow-Listing**: A listing or payout rejected due to an unlisted destination/category leaves no state mutated and succeeds immediately on retry once the admin adds the entry.
4. **Strict Admin Authorization**: Both `add` and `remove` verify `caller == admin` before any mutation, rejecting non-admin callers with `Error::Unauthorized` and leaving the allow-list untouched.
5. **Scheme-Only Empty URLs Rejected**: Bare prefixes such as `"https://"`, `"ipfs://"`, or `"ar://"` with no host/CID suffix are rejected with `Error::InvalidImageUrlLength`.

## Contract Compatibility & Migration

- **Zero ABI / Storage Breaking Changes**: Reuses existing `Error` variants (`Unauthorized`, `InvalidCategoryLength`, `InvalidImageUrlLength`, `InvalidMetadata`) and does not alter existing contract entrypoints or storage layouts. No migration is required.

## Running the Tests

```bash
cargo test -p prompt-hash --lib allowlist
```
