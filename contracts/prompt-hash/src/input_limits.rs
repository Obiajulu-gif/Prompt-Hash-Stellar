//! Strict input size and cardinality limits for `PromptHashContract`.
//!
//! Centralizes byte-length ceilings, aggregate payload budgets, and collection
//! cardinality bounds so every mutation and batch query enforces deterministic,
//! bounded Soroban CPU/memory/storage footprints without breaking existing
//! contract ABIs or error codes.

use crate::types::{Error, Split};
use soroban_sdk::{Address, Bytes, String, Vec};

// ============================================================================
// String & Byte Size Limits
// ============================================================================

pub const MIN_NON_EMPTY_LEN: u32 = 1;
pub const MAX_TITLE_LEN: u32 = 120;
pub const MAX_CATEGORY_LEN: u32 = 40;
pub const MAX_PREVIEW_LEN: u32 = 280;
pub const MAX_ENCRYPTED_PROMPT_LEN: u32 = 4_096;
pub const MAX_WRAPPED_KEY_LEN: u32 = 256;
pub const MAX_IMAGE_URL_LEN: u32 = 512;
pub const MAX_IV_LEN: u32 = 64;
pub const MAX_TAG_LEN: u32 = 32;
pub const MAX_VOUCHER_BYTES: u32 = 256;

/// Aggregate byte-length ceiling across all string fields + tags in a single
/// prompt listing so combined near-max fields cannot bloat ledger entries.
pub const MAX_TOTAL_LISTING_BYTES: u32 = 5_500;

// ============================================================================
// Collection Cardinality Limits
// ============================================================================

pub const MAX_SPLITS: u32 = 10;
pub const MAX_TAGS: u32 = 8;
pub const MAX_BUNDLE_PROMPTS: u32 = 20;
pub const MAX_BULK_PURCHASE_SIZE: u32 = 20;
pub const MAX_BATCH_QUERY_IDS: u32 = 50;
pub const MAX_SPLIT_BPS: u32 = 10_000;

/// Validates that `value.len()` falls within `[min_len, max_len]` inclusive.
pub fn validate_string_bounds(
    value: &String,
    min_len: u32,
    max_len: u32,
    err: Error,
) -> Result<u32, Error> {
    let len = value.len();
    if len < min_len || len > max_len {
        return Err(err);
    }
    Ok(len)
}

/// Validates all string fields, tag cardinality, tag uniqueness, and aggregate
/// payload byte budget for a prompt listing.
#[allow(clippy::too_many_arguments)]
pub fn validate_listing_fields(
    image_url: &String,
    title: &String,
    category: &String,
    preview: &String,
    encrypted_prompt: &String,
    iv: &String,
    wrapped_key: &String,
    tags: &Vec<String>,
) -> Result<u32, Error> {
    let mut total_bytes: u32 = 0;

    total_bytes = total_bytes
        .checked_add(validate_string_bounds(
            image_url,
            MIN_NON_EMPTY_LEN,
            MAX_IMAGE_URL_LEN,
            Error::InvalidImageUrlLength,
        )?)
        .ok_or(Error::ArithmeticOverflow)?;
    total_bytes = total_bytes
        .checked_add(validate_string_bounds(
            title,
            MIN_NON_EMPTY_LEN,
            MAX_TITLE_LEN,
            Error::InvalidTitleLength,
        )?)
        .ok_or(Error::ArithmeticOverflow)?;
    total_bytes = total_bytes
        .checked_add(validate_string_bounds(
            category,
            MIN_NON_EMPTY_LEN,
            MAX_CATEGORY_LEN,
            Error::InvalidCategoryLength,
        )?)
        .ok_or(Error::ArithmeticOverflow)?;
    total_bytes = total_bytes
        .checked_add(validate_string_bounds(
            preview,
            MIN_NON_EMPTY_LEN,
            MAX_PREVIEW_LEN,
            Error::InvalidPreviewLength,
        )?)
        .ok_or(Error::ArithmeticOverflow)?;
    total_bytes = total_bytes
        .checked_add(validate_string_bounds(
            encrypted_prompt,
            MIN_NON_EMPTY_LEN,
            MAX_ENCRYPTED_PROMPT_LEN,
            Error::InvalidEncryptedPromptLength,
        )?)
        .ok_or(Error::ArithmeticOverflow)?;
    total_bytes = total_bytes
        .checked_add(validate_string_bounds(
            iv,
            MIN_NON_EMPTY_LEN,
            MAX_IV_LEN,
            Error::InvalidIvLength,
        )?)
        .ok_or(Error::ArithmeticOverflow)?;
    total_bytes = total_bytes
        .checked_add(validate_string_bounds(
            wrapped_key,
            MIN_NON_EMPTY_LEN,
            MAX_WRAPPED_KEY_LEN,
            Error::InvalidWrappedKeyLength,
        )?)
        .ok_or(Error::ArithmeticOverflow)?;

    let tag_count = tags.len();
    if tag_count > MAX_TAGS {
        return Err(Error::InvalidCategoryLength);
    }

    for i in 0..tag_count {
        let tag = tags.get(i).ok_or(Error::InvalidCategoryLength)?;
        let tag_len =
            validate_string_bounds(&tag, MIN_NON_EMPTY_LEN, MAX_TAG_LEN, Error::InvalidCategoryLength)?;
        total_bytes = total_bytes
            .checked_add(tag_len)
            .ok_or(Error::ArithmeticOverflow)?;

        // Reject duplicate tags to keep index cardinality tight.
        for j in (i + 1)..tag_count {
            let other = tags.get(j).ok_or(Error::InvalidCategoryLength)?;
            if tag == other {
                return Err(Error::InvalidCategoryLength);
            }
        }
    }

    if total_bytes > MAX_TOTAL_LISTING_BYTES {
        return Err(Error::InvalidMetadata);
    }

    Ok(total_bytes)
}

/// Validates revenue split cardinality, non-zero basis points, total bps
/// ceiling (`<= 10_000`), and recipient uniqueness.
pub fn validate_splits_cardinality(splits: &Vec<Split>) -> Result<u32, Error> {
    let count = splits.len();
    if count > MAX_SPLITS {
        return Err(Error::TooManySplits);
    }

    let mut total_bps: u32 = 0;
    for i in 0..count {
        let split = splits.get(i).ok_or(Error::InvalidSplits)?;
        if split.bps == 0 || split.bps > MAX_SPLIT_BPS {
            return Err(Error::InvalidSplits);
        }
        total_bps = total_bps
            .checked_add(split.bps)
            .ok_or(Error::ArithmeticOverflow)?;
        if total_bps > MAX_SPLIT_BPS {
            return Err(Error::InvalidSplits);
        }

        for j in (i + 1)..count {
            let other = splits.get(j).ok_or(Error::InvalidSplits)?;
            if split.recipient == other.recipient {
                return Err(Error::DuplicateSplitRecipient);
            }
        }
    }

    Ok(total_bps)
}

/// Validates a batch of prompt IDs for non-emptiness, strict maximum
/// cardinality, and uniqueness (no duplicate prompt IDs).
pub fn validate_batch_prompt_ids(
    prompt_ids: &Vec<u64>,
    max_cardinality: u32,
    too_large_err: Error,
) -> Result<u32, Error> {
    let count = prompt_ids.len();
    if count == 0 || count > max_cardinality {
        return Err(too_large_err);
    }

    for i in 0..count {
        let id = prompt_ids.get(i).ok_or(too_large_err)?;
        for j in (i + 1)..count {
            let other = prompt_ids.get(j).ok_or(too_large_err)?;
            if id == other {
                return Err(Error::DuplicatePromptId);
            }
        }
    }

    Ok(count)
}

/// Validates a voucher payload byte length is within `[1, MAX_VOUCHER_BYTES]`.
pub fn validate_voucher_size(voucher: &Bytes) -> Result<u32, Error> {
    let len = voucher.len();
    if len < MIN_NON_EMPTY_LEN || len > MAX_VOUCHER_BYTES {
        return Err(Error::InvalidVoucher);
    }
    Ok(len)
}

/// Enforces caller authorization before validating batch/split cardinality so
/// unauthorized callers are deterministically rejected with `Error::Unauthorized`.
pub fn validate_authorized_splits_update(
    caller: &Address,
    expected_owner: &Address,
    splits: &Vec<Split>,
) -> Result<u32, Error> {
    if caller != expected_owner {
        return Err(Error::Unauthorized);
    }
    validate_splits_cardinality(splits)
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn repeated_str(env: &Env, ch: char, len: usize) -> String {
        let s: std::string::String = core::iter::repeat(ch).take(len).collect();
        String::from_str(env, &s)
    }

    #[test]
    fn normal_path_accepts_exact_boundary_inputs() {
        let env = Env::default();

        let image_url = repeated_str(&env, 'a', MAX_IMAGE_URL_LEN as usize);
        let title = repeated_str(&env, 't', MAX_TITLE_LEN as usize);
        let category = repeated_str(&env, 'c', MAX_CATEGORY_LEN as usize);
        let preview = repeated_str(&env, 'p', MAX_PREVIEW_LEN as usize);
        let encrypted = repeated_str(&env, 'e', MAX_ENCRYPTED_PROMPT_LEN as usize);
        let iv = repeated_str(&env, 'i', MAX_IV_LEN as usize);
        let wrapped_key = repeated_str(&env, 'k', MAX_WRAPPED_KEY_LEN as usize);

        let mut tags = Vec::new(&env);
        for idx in 0..MAX_TAGS {
            tags.push_back(String::from_str(&env, &std::format!("tag-{}", idx)));
        }

        let total = validate_listing_fields(
            &image_url,
            &title,
            &category,
            &preview,
            &encrypted,
            &iv,
            &wrapped_key,
            &tags,
        )
        .expect("exact boundary listing fields should be accepted");
        assert!(total <= MAX_TOTAL_LISTING_BYTES);

        // Exact MAX_SPLITS unique recipients summing to 10_000 bps.
        let mut splits = Vec::new(&env);
        for _ in 0..MAX_SPLITS {
            splits.push_back(Split {
                recipient: Address::generate(&env),
                bps: 1_000,
            });
        }
        assert_eq!(validate_splits_cardinality(&splits), Ok(10_000));

        // Exact MAX_BULK_PURCHASE_SIZE unique prompt IDs.
        let mut ids = Vec::new(&env);
        for id in 1..=(MAX_BULK_PURCHASE_SIZE as u64) {
            ids.push_back(id);
        }
        assert_eq!(
            validate_batch_prompt_ids(&ids, MAX_BULK_PURCHASE_SIZE, Error::BulkPurchaseTooLarge),
            Ok(MAX_BULK_PURCHASE_SIZE)
        );

        // Exact MAX_VOUCHER_BYTES voucher.
        let voucher = Bytes::from_slice(&env, &[7u8; MAX_VOUCHER_BYTES as usize]);
        assert_eq!(validate_voucher_size(&voucher), Ok(MAX_VOUCHER_BYTES));
    }

    #[test]
    fn failure_path_rejects_oversized_empty_and_duplicate_inputs() {
        let env = Env::default();
        let ok_str = String::from_str(&env, "valid");
        let empty = String::from_str(&env, "");
        let empty_tags = Vec::new(&env);

        // Empty title rejected.
        assert_eq!(
            validate_listing_fields(
                &ok_str,
                &empty,
                &ok_str,
                &ok_str,
                &ok_str,
                &ok_str,
                &ok_str,
                &empty_tags
            ),
            Err(Error::InvalidTitleLength)
        );

        // Title exceeding MAX_TITLE_LEN rejected.
        let long_title = repeated_str(&env, 't', (MAX_TITLE_LEN + 1) as usize);
        assert_eq!(
            validate_listing_fields(
                &ok_str,
                &long_title,
                &ok_str,
                &ok_str,
                &ok_str,
                &ok_str,
                &ok_str,
                &empty_tags
            ),
            Err(Error::InvalidTitleLength)
        );

        // Duplicate tags rejected.
        let mut dup_tags = Vec::new(&env);
        dup_tags.push_back(String::from_str(&env, "ai"));
        dup_tags.push_back(String::from_str(&env, "ai"));
        assert_eq!(
            validate_listing_fields(
                &ok_str, &ok_str, &ok_str, &ok_str, &ok_str, &ok_str, &ok_str, &dup_tags
            ),
            Err(Error::InvalidCategoryLength)
        );

        // Too many splits rejected.
        let mut too_many_splits = Vec::new(&env);
        for _ in 0..=MAX_SPLITS {
            too_many_splits.push_back(Split {
                recipient: Address::generate(&env),
                bps: 100,
            });
        }
        assert_eq!(
            validate_splits_cardinality(&too_many_splits),
            Err(Error::TooManySplits)
        );

        // Duplicate split recipient rejected.
        let same = Address::generate(&env);
        let mut dup_splits = Vec::new(&env);
        dup_splits.push_back(Split {
            recipient: same.clone(),
            bps: 500,
        });
        dup_splits.push_back(Split {
            recipient: same,
            bps: 500,
        });
        assert_eq!(
            validate_splits_cardinality(&dup_splits),
            Err(Error::DuplicateSplitRecipient)
        );

        // Empty batch and oversized batch rejected.
        let empty_ids: Vec<u64> = Vec::new(&env);
        assert_eq!(
            validate_batch_prompt_ids(&empty_ids, MAX_BULK_PURCHASE_SIZE, Error::BulkPurchaseTooLarge),
            Err(Error::BulkPurchaseTooLarge)
        );

        let mut dup_ids = Vec::new(&env);
        dup_ids.push_back(1);
        dup_ids.push_back(1);
        assert_eq!(
            validate_batch_prompt_ids(&dup_ids, MAX_BULK_PURCHASE_SIZE, Error::BulkPurchaseTooLarge),
            Err(Error::DuplicatePromptId)
        );

        // Oversized voucher rejected.
        let oversized_voucher = Bytes::from_slice(&env, &[1u8; (MAX_VOUCHER_BYTES + 1) as usize]);
        assert_eq!(
            validate_voucher_size(&oversized_voucher),
            Err(Error::InvalidVoucher)
        );
    }

    #[test]
    fn retry_path_succeeds_after_correcting_oversized_or_duplicate_payload() {
        let env = Env::default();

        // First attempt: oversized batch fails deterministically.
        let mut bad_ids = Vec::new(&env);
        for id in 1..=((MAX_BULK_PURCHASE_SIZE + 1) as u64) {
            bad_ids.push_back(id);
        }
        assert_eq!(
            validate_batch_prompt_ids(&bad_ids, MAX_BULK_PURCHASE_SIZE, Error::BulkPurchaseTooLarge),
            Err(Error::BulkPurchaseTooLarge)
        );

        // Retry with trimmed batch succeeds.
        let mut trimmed_ids = Vec::new(&env);
        for id in 1..=(MAX_BULK_PURCHASE_SIZE as u64) {
            trimmed_ids.push_back(id);
        }
        assert_eq!(
            validate_batch_prompt_ids(
                &trimmed_ids,
                MAX_BULK_PURCHASE_SIZE,
                Error::BulkPurchaseTooLarge
            ),
            Ok(MAX_BULK_PURCHASE_SIZE)
        );
    }

    #[test]
    fn authorization_path_rejects_unauthorized_caller_before_limit_checks() {
        let env = Env::default();
        let owner = Address::generate(&env);
        let attacker = Address::generate(&env);

        let mut valid_splits = Vec::new(&env);
        valid_splits.push_back(Split {
            recipient: Address::generate(&env),
            bps: 2_500,
        });

        // Unauthorized caller is rejected with Unauthorized.
        assert_eq!(
            validate_authorized_splits_update(&attacker, &owner, &valid_splits),
            Err(Error::Unauthorized)
        );

        // Authorized owner succeeds with valid splits.
        assert_eq!(
            validate_authorized_splits_update(&owner, &owner, &valid_splits),
            Ok(2_500)
        );

        // Authorized owner still bound by cardinality limits.
        let mut too_many = Vec::new(&env);
        for _ in 0..=MAX_SPLITS {
            too_many.push_back(Split {
                recipient: Address::generate(&env),
                bps: 100,
            });
        }
        assert_eq!(
            validate_authorized_splits_update(&owner, &owner, &too_many),
            Err(Error::TooManySplits)
        );
    }
}
