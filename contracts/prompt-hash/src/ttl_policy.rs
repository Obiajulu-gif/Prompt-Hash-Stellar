use soroban_sdk::{Env, Vec};

use super::storage::{PERSISTENT_BUMP_AMOUNT, PERSISTENT_LIFETIME_THRESHOLD};
use super::types::{DataKey, Error, TtlDependency};

/// Classify the TTL dependency of a storage key.
///
/// Keys that are logically children of another key return
/// `DependsOn(parent_key)` so that the renewal flow can guarantee the parent
/// is renewed first (or together with the child) and never outlives it.
pub fn get_ttl_dependency(key: &DataKey) -> TtlDependency {
    match key {
        // ── Independent / root keys ───────────────────────────────────
        DataKey::Prompt(_)
        | DataKey::PromptCounter
        | DataKey::FeePercentage
        | DataKey::FeeWallet
        | DataKey::XlmAddress
        | DataKey::CreatorPrompts(_)
        | DataKey::BuyerPrompts(_)
        | DataKey::Reentrancy
        | DataKey::ReferralPercentage
        | DataKey::IsPaused => TtlDependency::Independent,

        // ── Purchase depends on its parent Prompt ─────────────────────
        DataKey::Purchase(prompt_id, buyer) => {
            TtlDependency::DependsOn(DataKey::Prompt(*prompt_id))
        }

        // ── Voucher depends on its parent Prompt ──────────────────────
        DataKey::VoucherKey(prompt_id, _) => {
            TtlDependency::DependsOn(DataKey::Prompt(*prompt_id))
        }

        // ── ListingRevision depends on its parent Prompt ──────────────
        DataKey::ListingRevision(prompt_id, _) => {
            TtlDependency::DependsOn(DataKey::Prompt(*prompt_id))
        }

        // ── PurchaseDispute depends on its parent Purchase ────────────
        DataKey::PurchaseDispute(prompt_id, buyer) => {
            TtlDependency::DependsOn(DataKey::Purchase(*prompt_id, buyer.clone()))
        }
    }
}

/// Validate that `key` does not violate its TTL dependency invariant.
///
/// For independent keys this is always `Ok`. For a dependent key the check
/// verifies that:
/// 1. The parent key exists in persistent storage.
/// 2. If the parent exists, its remaining TTL is at least as large as the
///    threshold we would bump the child to.
///
/// Returns `Err(Error::InvalidTtlPolicy)` on violation.
pub fn validate_ttl_dependency(env: &Env, key: &DataKey) -> Result<(), Error> {
    match get_ttl_dependency(key) {
        TtlDependency::Independent => Ok(()),
        TtlDependency::DependsOn(parent) => {
            // Parent must exist.
            if !env.storage().persistent().has(&parent) {
                return Err(Error::InvalidTtlPolicy);
            }

            // Check that the parent's TTL is sufficient – it should be at
            // least the lifetime threshold so it won't expire before the
            // child's next renewal window.
            let parent_ttl = env
                .storage()
                .persistent()
                .get_ttl(&parent)
                .unwrap_or(0);
            if parent_ttl < PERSISTENT_LIFETIME_THRESHOLD {
                return Err(Error::InvalidTtlPolicy);
            }

            Ok(())
        }
    }
}

/// Topologically sort a list of `DataKey`s so that every parent key appears
/// before its children. This guarantees `renew_critical_keys` can walk the
/// list linearly without needing back-tracking.
///
/// Keys without dependencies (Independent) are placed first in their
/// original order, then dependents follow in dependency order.
pub fn topologically_sort_keys(env: &Env, keys: &Vec<DataKey>) -> Vec<DataKey> {
    let len = keys.len();
    let mut result = soroban_sdk::Vec::new(env);

    // Collect independent keys first (stable order).
    for i in 0..len {
        let key = keys.get(i).unwrap();
        if let TtlDependency::Independent = get_ttl_dependency(&key) {
            result.push_back(key);
        }
    }

    // Then collect dependent keys. We do a simple iterative pass: repeat
    // until all dependents are placed, advancing once a dependent's parent
    // is already in `result`.
    let mut placed = result.len();
    let mut attempts = 0u32;
    while placed < len && attempts < len * 2 {
        for i in 0..len {
            let key = keys.get(i).unwrap();
            if let TtlDependency::DependsOn(ref parent) = get_ttl_dependency(&key) {
                // Skip if already placed (check by iterating – small lists).
                if already_present(&result, &key) {
                    continue;
                }
                if already_present(&result, parent) {
                    result.push_back(key);
                }
            }
        }
        let new_placed = result.len();
        if new_placed == placed {
            // No progress – remaining keys form a cycle or are orphaned.
            // Append them as-is to avoid an infinite loop; the validation
            // step will catch policy violations.
            for i in 0..len {
                let key = keys.get(i).unwrap();
                if !already_present(&result, &key) {
                    result.push_back(key);
                }
            }
            break;
        }
        placed = new_placed;
        attempts += 1;
    }

    result
}

fn already_present(list: &Vec<DataKey>, target: &DataKey) -> bool {
    for i in 0..list.len() {
        if list.get(i).unwrap() == *target {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

    fn dummy_hash() -> BytesN<32> {
        BytesN::from_array(&Env::default(), &[0u8; 32])
    }

    #[test]
    fn independent_keys_are_independent() {
        let keys = [
            DataKey::Prompt(1),
            DataKey::PromptCounter,
            DataKey::FeePercentage,
            DataKey::FeeWallet,
            DataKey::XlmAddress,
            DataKey::Reentrancy,
            DataKey::ReferralPercentage,
            DataKey::IsPaused,
        ];
        for key in &keys {
            assert_eq!(get_ttl_dependency(key), TtlDependency::Independent);
        }
    }

    #[test]
    fn purchase_depends_on_prompt() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let dep = get_ttl_dependency(&DataKey::Purchase(42, buyer.clone()));
        assert_eq!(dep, TtlDependency::DependsOn(DataKey::Prompt(42)));
    }

    #[test]
    fn voucher_depends_on_prompt() {
        let hash = dummy_hash();
        let dep = get_ttl_dependency(&DataKey::VoucherKey(7, hash.clone()));
        assert_eq!(dep, TtlDependency::DependsOn(DataKey::Prompt(7)));
    }

    #[test]
    fn listing_revision_depends_on_prompt() {
        let dep = get_ttl_dependency(&DataKey::ListingRevision(5, 2));
        assert_eq!(dep, TtlDependency::DependsOn(DataKey::Prompt(5)));
    }

    #[test]
    fn purchase_dispute_depends_on_purchase() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let dep = get_ttl_dependency(&DataKey::PurchaseDispute(3, buyer.clone()));
        assert_eq!(
            dep,
            TtlDependency::DependsOn(DataKey::Purchase(3, buyer))
        );
    }

    #[test]
    fn validate_independent_always_ok() {
        let env = Env::default();
        assert_eq!(
            validate_ttl_dependency(&env, &DataKey::PromptCounter),
            Ok(())
        );
    }

    #[test]
    fn validate_dependent_missing_parent_errs() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        // Parent Prompt(99) does not exist in storage.
        assert_eq!(
            validate_ttl_dependency(&env, &DataKey::Purchase(99, buyer)),
            Err(Error::InvalidTtlPolicy)
        );
    }

    #[test]
    fn validate_dependent_with_valid_parent_ok() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let key = DataKey::Prompt(1);
        // Store the parent with a generous TTL.
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
        // Now validate a child of that parent.
        assert_eq!(
            validate_ttl_dependency(&env, &DataKey::Purchase(1, buyer)),
            Ok(())
        );
    }

    #[test]
    fn validate_dependent_with_low_ttl_parent_errs() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let key = DataKey::Prompt(1);
        // Store the parent but do NOT extend its TTL – it will have 0
        // remaining which is below the threshold.
        env.storage().persistent().set(&key, &true);
        assert_eq!(
            validate_ttl_dependency(&env, &DataKey::Purchase(1, buyer)),
            Err(Error::InvalidTtlPolicy)
        );
    }

    #[test]
    fn topological_sort_parents_before_children() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let keys = soroban_sdk::vec![
            &env,
            DataKey::Purchase(1, buyer.clone()),
            DataKey::Prompt(1),
            DataKey::VoucherKey(1, dummy_hash()),
        ];
        let sorted = topologically_sort_keys(&env, &keys);
        // Prompt(1) must come before Purchase and VoucherKey.
        let prompt_pos = find_position(&sorted, &DataKey::Prompt(1));
        let purchase_pos = find_position(&sorted, &DataKey::Purchase(1, buyer.clone()));
        let voucher_pos = find_position(&sorted, &DataKey::VoucherKey(1, dummy_hash()));
        assert!(prompt_pos < purchase_pos);
        assert!(prompt_pos < voucher_pos);
    }

    fn find_position(list: &Vec<DataKey>, target: &DataKey) -> usize {
        for i in 0..list.len() {
            if list.get(i).unwrap() == *target {
                return i as usize;
            }
        }
        usize::MAX
    }
}
