use crate::storage::{Storage, PERSISTENT_BUMP_AMOUNT, PERSISTENT_LIFETIME_THRESHOLD};
use crate::ttl_policy::{get_ttl_dependency, topologically_sort_keys, validate_ttl_dependency};
use crate::types::{DataKey, Error, TtlDependency};
extern crate std;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, Vec};

fn dummy_hash() -> BytesN<32> {
    BytesN::from_array(&Env::default(), &[0u8; 32])
}

// ---------------------------------------------------------------------------
// get_ttl_dependency unit tests
// ---------------------------------------------------------------------------

#[test]
fn classify_independent_keys() {
    let env = Env::default();
    let addr = Address::generate(&env);
    let cases: Vec<(DataKey, TtlDependency)> = soroban_sdk::vec![
        &env,
        (DataKey::Prompt(1), TtlDependency::Independent),
        (DataKey::PromptCounter, TtlDependency::Independent),
        (DataKey::FeePercentage, TtlDependency::Independent),
        (DataKey::FeeWallet, TtlDependency::Independent),
        (DataKey::XlmAddress, TtlDependency::Independent),
        (DataKey::CreatorPrompts(addr.clone()), TtlDependency::Independent),
        (DataKey::BuyerPrompts(addr.clone()), TtlDependency::Independent),
        (DataKey::Reentrancy, TtlDependency::Independent),
        (DataKey::ReferralPercentage, TtlDependency::Independent),
        (DataKey::IsPaused, TtlDependency::Independent),
    ];
    for i in 0..cases.len() {
        let (key, expected) = cases.get(i).unwrap();
        assert_eq!(get_ttl_dependency(&key), expected, "key mismatch: {:?}", key);
    }
}

#[test]
fn classify_dependent_keys() {
    let env = Env::default();
    let buyer = Address::generate(&env);
    let hash = BytesN::from_array(&env, &[42u8; 32]);

    assert_eq!(
        get_ttl_dependency(&DataKey::Purchase(1, buyer.clone())),
        TtlDependency::DependsOn(DataKey::Prompt(1))
    );
    assert_eq!(
        get_ttl_dependency(&DataKey::VoucherKey(1, hash.clone())),
        TtlDependency::DependsOn(DataKey::Prompt(1))
    );
    assert_eq!(
        get_ttl_dependency(&DataKey::ListingRevision(1, 0)),
        TtlDependency::DependsOn(DataKey::Prompt(1))
    );
    assert_eq!(
        get_ttl_dependency(&DataKey::PurchaseDispute(1, buyer.clone())),
        TtlDependency::DependsOn(DataKey::Purchase(1, buyer.clone()))
    );
}

// ---------------------------------------------------------------------------
// validate_ttl_dependency – runtime checks
// ---------------------------------------------------------------------------

#[test]
fn validate_independent_key_always_ok() {
    let env = Env::default();
    assert_eq!(
        validate_ttl_dependency(&env, &DataKey::PromptCounter),
        Ok(())
    );
}

#[test]
fn validate_dependent_key_missing_parent_errs() {
    let env = Env::default();
    let buyer = Address::generate(&env);
    // Prompt(99) does not exist → InvalidTtlPolicy.
    assert_eq!(
        validate_ttl_dependency(&env, &DataKey::Purchase(99, buyer)),
        Err(Error::InvalidTtlPolicy)
    );
}

#[test]
fn validate_dependent_key_low_ttl_parent_errs() {
    let env = Env::default();
    let buyer = Address::generate(&env);
    let parent = DataKey::Prompt(1);
    // Store parent but do NOT extend TTL → remaining is 0.
    env.storage().persistent().set(&parent, &true);
    assert_eq!(
        validate_ttl_dependency(&env, &DataKey::Purchase(1, buyer)),
        Err(Error::InvalidTtlPolicy)
    );
}

#[test]
fn validate_dependent_key_valid_parent_ok() {
    let env = Env::default();
    let buyer = Address::generate(&env);
    let parent = DataKey::Prompt(1);
    env.storage().persistent().set(&parent, &true);
    env.storage()
        .persistent()
        .extend_ttl(&parent, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    assert_eq!(
        validate_ttl_dependency(&env, &DataKey::Purchase(1, buyer)),
        Ok(())
    );
}

#[test]
fn validate_nested_dependency_chain() {
    let env = Env::default();
    let buyer = Address::generate(&env);

    // Store Prompt(1) with full TTL.
    let prompt_key = DataKey::Prompt(1);
    env.storage().persistent().set(&prompt_key, &true);
    env.storage().persistent().extend_ttl(
        &prompt_key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );

    // Store Purchase(1, buyer) with full TTL.
    let purchase_key = DataKey::Purchase(1, buyer.clone());
    env.storage().persistent().set(&purchase_key, &true);
    env.storage().persistent().extend_ttl(
        &purchase_key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );

    // PurchaseDispute depends on Purchase, which depends on Prompt.
    // Both parents exist with adequate TTL → OK.
    assert_eq!(
        validate_ttl_dependency(&env, &DataKey::PurchaseDispute(1, buyer.clone())),
        Ok(())
    );

    // Remove the Purchase → PurchaseDispute should fail.
    env.storage().persistent().remove(&purchase_key);
    assert_eq!(
        validate_ttl_dependency(&env, &DataKey::PurchaseDispute(1, buyer.clone())),
        Err(Error::InvalidTtlPolicy)
    );
}

// ---------------------------------------------------------------------------
// Storage::renew_key – integration with TTL policy
// ---------------------------------------------------------------------------

#[test]
fn renew_key_independent_always_ok() {
    let env = Env::default();
    let key = DataKey::PromptCounter;
    env.storage().persistent().set(&key, &true);
    assert_eq!(Storage::renew_key(&env, &key), Ok(()));
}

#[test]
fn renew_key_dependent_missing_parent_errs() {
    let env = Env::default();
    let buyer = Address::generate(&env);
    assert_eq!(
        Storage::renew_key(&env, &DataKey::Purchase(42, buyer)),
        Err(Error::InvalidTtlPolicy)
    );
}

#[test]
fn renew_key_dependent_valid_parent_ok() {
    let env = Env::default();
    let buyer = Address::generate(&env);

    // Create parent Prompt(1) with full TTL.
    let prompt_key = DataKey::Prompt(1);
    env.storage().persistent().set(&prompt_key, &true);
    env.storage().persistent().extend_ttl(
        &prompt_key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );

    // Create Purchase(1, buyer).
    let purchase_key = DataKey::Purchase(1, buyer.clone());
    env.storage().persistent().set(&purchase_key, &true);

    // renew_key validates the dependency and extends the child TTL.
    assert_eq!(Storage::renew_key(&env, &purchase_key), Ok(()));
}

// ---------------------------------------------------------------------------
// Storage::renew_critical_keys – batch renewal with topological sort
// ---------------------------------------------------------------------------

#[test]
fn renew_critical_keys_parents_before_children() {
    let env = Env::default();
    let buyer = Address::generate(&env);

    // Create Prompt(1).
    let prompt_key = DataKey::Prompt(1);
    env.storage().persistent().set(&prompt_key, &true);
    env.storage().persistent().extend_ttl(
        &prompt_key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );

    // Create Purchase(1, buyer) and VoucherKey(1, hash).
    let purchase_key = DataKey::Purchase(1, buyer.clone());
    env.storage().persistent().set(&purchase_key, &true);

    let voucher_key = DataKey::VoucherKey(1, dummy_hash());
    env.storage().persistent().set(&voucher_key, &true);

    // Provide keys in child-first order – the function must sort them.
    let keys = soroban_sdk::vec![
        &env,
        DataKey::Purchase(1, buyer.clone()),
        DataKey::VoucherKey(1, dummy_hash()),
        DataKey::Prompt(1),
    ];

    assert_eq!(Storage::renew_critical_keys(&env, &keys), Ok(()));
}

#[test]
fn renew_critical_keys_fails_on_broken_dependency() {
    let env = Env::default();
    let buyer = Address::generate(&env);

    // No Prompt(1) exists → Purchase(1, buyer) should fail.
    let keys = soroban_sdk::vec![
        &env,
        DataKey::Prompt(1),
        DataKey::Purchase(1, buyer.clone()),
    ];

    assert_eq!(
        Storage::renew_critical_keys(&env, &keys),
        Err(Error::InvalidTtlPolicy)
    );
}

#[test]
fn renew_critical_keys_empty_list_ok() {
    let env = Env::default();
    let keys = soroban_sdk::vec![&env,];
    assert_eq!(Storage::renew_critical_keys(&env, &keys), Ok(()));
}

#[test]
fn renew_critical_keys_only_independents_ok() {
    let env = Env::default();
    let keys = soroban_sdk::vec![
        &env,
        DataKey::PromptCounter,
        DataKey::FeePercentage,
        DataKey::FeeWallet,
    ];
    assert_eq!(Storage::renew_critical_keys(&env, &keys), Ok(()));
}

// ---------------------------------------------------------------------------
// Topological sort correctness
// ---------------------------------------------------------------------------

#[test]
fn topological_sort_preserves_independent_order() {
    let env = Env::default();
    let keys = soroban_sdk::vec![
        &env,
        DataKey::FeePercentage,
        DataKey::FeeWallet,
        DataKey::PromptCounter,
    ];
    let sorted = topologically_sort_keys(&env, &keys);
    assert_eq!(sorted.len(), 3);
    assert_eq!(sorted.get(0).unwrap(), DataKey::FeePercentage);
    assert_eq!(sorted.get(1).unwrap(), DataKey::FeeWallet);
    assert_eq!(sorted.get(2).unwrap(), DataKey::PromptCounter);
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
        DataKey::ListingRevision(1, 0),
    ];
    let sorted = topologically_sort_keys(&env, &keys);
    // Prompt(1) must be first among these.
    assert_eq!(sorted.get(0).unwrap(), DataKey::Prompt(1));
}

#[test]
fn topological_sort_three_level_chain() {
    let env = Env::default();
    let buyer = Address::generate(&env);
    // PurchaseDispute → Purchase → Prompt
    let keys = soroban_sdk::vec![
        &env,
        DataKey::PurchaseDispute(1, buyer.clone()),
        DataKey::Purchase(1, buyer.clone()),
        DataKey::Prompt(1),
    ];
    let sorted = topologically_sort_keys(&env, &keys);
    // Verify ordering: Prompt < Purchase < PurchaseDispute
    let prompt_idx = find(&sorted, &DataKey::Prompt(1));
    let purchase_idx = find(&sorted, &DataKey::Purchase(1, buyer.clone()));
    let dispute_idx = find(&sorted, &DataKey::PurchaseDispute(1, buyer.clone()));
    assert!(prompt_idx < purchase_idx, "Prompt must come before Purchase");
    assert!(
        purchase_idx < dispute_idx,
        "Purchase must come before PurchaseDispute"
    );
}

fn find(list: &Vec<DataKey>, target: &DataKey) -> usize {
    for i in 0..list.len() {
        if list.get(i).unwrap() == *target {
            return i as usize;
        }
    }
    usize::MAX
}
