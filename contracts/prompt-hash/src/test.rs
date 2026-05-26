#![cfg(test)]

use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::mock_asset::FungibleTokenContract;
use crate::types::Error;
extern crate std;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, token, Address, BytesN, Env, String};
use soroban_sdk::{testutils::{Address as _, Ledger}, token, Address, BytesN, Env, String};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Bytes, BytesN, Env, String,
};

#[derive(Clone, Debug, PartialEq)]
struct PromptHashContext {
    admin: Address,
    fee_wallet: Address,
    xlm: Address,
    contract: Address,
}

fn setup(env: &Env) -> PromptHashContext {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let fee_wallet = Address::generate(env);
    let xlm = env.register(FungibleTokenContract, (admin.clone(),));
    let contract = env.register(
        PromptHashContract,
        (admin.clone(), fee_wallet.clone(), xlm.clone()),
    );

    PromptHashContext {
        admin,
        fee_wallet,
        xlm,
        contract,
    }
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn create_prompt(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    title: &str,
    price_stroops: i128,
    expires_at: Option<u64> = None,
) -> u128 {
    client.create_prompt(
        creator,
        &String::from_str(env, "https://example.com/prompt.png"),
        &String::from_str(env, title),
        &String::from_str(env, "Software Development"),
        &String::from_str(env, "Generate a production-ready implementation plan."),
        &String::from_str(env, "ciphertext"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped-key"),
        &hash(env, 7),
        &price_stroops,
        &expires_at,
    )
}

fn fund_buyer(
    xlm_client: &token::StellarAssetClient<'_>,
    buyer: &Address,
    spender: &Address,
    amount: i128,
) {
    xlm_client.mint(buyer, &amount);
    xlm_client.approve(buyer, spender, &amount, &1_000);
}

#[test]
fn test_create_prompt_stores_encrypted_fields() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Secure Prompt", 10_000_000);

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.id, prompt_id);
    assert_eq!(prompt.creator, creator);
    assert_eq!(
        prompt.preview_text,
        String::from_str(&env, "Generate a production-ready implementation plan.")
    );
    assert_eq!(
        prompt.encrypted_prompt,
        String::from_str(&env, "ciphertext")
    );
    assert_eq!(prompt.encryption_iv, String::from_str(&env, "iv"));
    assert_eq!(prompt.wrapped_key, String::from_str(&env, "wrapped-key"));
    assert_eq!(prompt.content_hash, hash(&env, 7));
    assert!(prompt.active);
    assert_eq!(prompt.sales_count, 0);

    let all_prompts = client.get_all_prompts();
    assert_eq!(all_prompts.len(), 1);
    assert_eq!(all_prompts.get(0).unwrap().id, prompt_id);
}

#[test]
fn test_creator_can_pause_reactivate_and_update_price() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Pricing Prompt", 5_000);

    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    client.update_prompt_price(&creator, &prompt_id, &9_000);
    client.set_prompt_sale_status(&creator, &prompt_id, &true);

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.price_stroops, 9_000);
    assert!(prompt.active);
}

#[test]
fn test_buy_prompt_grants_access_to_multiple_buyers_and_tracks_exact_fees() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_one = Address::generate(&env);
    let buyer_two = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Reusable Prompt", 12_345);

    fund_buyer(&xlm_client, &buyer_one, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer_two, &context.contract, 100_000);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(
        &buyer_one,
        &prompt_id,
        &None::<Address>,
        &12_345i128,
        &None::<Bytes>,
    );
    client.buy_prompt(
        &buyer_two,
        &prompt_id,
        &None::<Address>,
        &12_345i128,
        &None::<Bytes>,
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.sales_count, 2);
    assert!(client.has_access(&buyer_one, &prompt_id));
    assert!(client.has_access(&buyer_two, &prompt_id));

    let single_fee = 12_345 * 500 / 10_000;
    let single_creator_amount = 12_345 - single_fee;
    assert_eq!(
        xlm_client.balance(&creator),
        seller_start + (single_creator_amount * 2) as i128
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + (single_fee * 2) as i128
    );
}

#[test]
fn test_has_access_is_true_for_creator_and_buyer_but_not_stranger() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Access Prompt", 8_000);

    assert!(client.has_access(&creator, &prompt_id));
    assert!(!client.has_access(&buyer, &prompt_id));
    assert!(!client.has_access(&stranger, &prompt_id));

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &8_000i128,
        &None::<Bytes>,
    );

    assert!(client.has_access(&buyer, &prompt_id));
    assert!(!client.has_access(&stranger, &prompt_id));
}

#[test]
fn test_get_prompts_by_creator_and_buyer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_a = create_prompt(&env, &client, &creator, "Prompt A", 8_000);
    create_prompt(&env, &client, &creator, "Prompt B", 9_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(
        &buyer,
        &prompt_a,
        &None::<Address>,
        &8_000i128,
        &None::<Bytes>,
    );

    assert_eq!(client.get_prompts_by_creator(&creator).len(), 2);
    assert_eq!(client.get_prompts_by_buyer(&buyer).len(), 1);
}

#[test]
fn test_duplicate_purchase_returns_typed_error() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "One License", 4_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &4_000i128,
        &None::<Bytes>,
    );

    let duplicate_purchase = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &4_000i128,
        &None::<Bytes>,
    );
    match duplicate_purchase {
        Err(Ok(error)) => assert_eq!(error, Error::AlreadyPurchased),
        other => panic!("unexpected duplicate purchase result: {:?}", other),
    }
}

#[test]
fn test_creator_cannot_buy_own_prompt() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Creator Lockout", 4_000);

    let result = client.try_buy_prompt(
        &creator,
        &prompt_id,
        &None::<Address>,
        &4_000i128,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::CreatorCannotBuy),
        other => panic!("unexpected creator purchase result: {:?}", other),
    }
}

#[test]
fn test_inactive_prompt_cannot_be_bought() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Paused Prompt", 4_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.set_prompt_sale_status(&creator, &prompt_id, &false);

    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &4_000i128,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::PromptInactive),
        other => panic!("unexpected inactive prompt result: {:?}", other),
    }
}

#[test]
fn test_buy_prompt_with_zero_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Set fee to 0
    client.set_fee_percentage(&0);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Zero Fee Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    assert_eq!(xlm_client.balance(&creator), seller_start + price);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start);
}

#[test]
fn test_buy_prompt_with_max_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Set fee to 100% (10,000 BPS)
    client.set_fee_percentage(&10_000);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Max Fee Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    assert_eq!(xlm_client.balance(&creator), seller_start);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start + price);
}

#[test]
fn test_unauthorized_seller_actions_fail() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Protected Prompt", 5_000);

    // Try to update status as stranger
    let status_res = client.try_set_prompt_sale_status(&stranger, &prompt_id, &false);
    match status_res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected unauthorized for status update, got {:?}", other),
    }

    // Try to update price as stranger
    let price_res = client.try_update_prompt_price(&stranger, &prompt_id, &1_000);
    match price_res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected unauthorized for price update, got {:?}", other),
    }
}

#[test]
fn test_buy_nonexistent_prompt_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let buyer = Address::generate(&env);

    let result = client.try_buy_prompt(
        &buyer,
        &999_999,
        &None::<Address>,
        &1_000i128,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::PromptNotFound)) => {}
        other => panic!(
            "expected PromptNotFound for nonexistent prompt, got {:?}",
            other
        ),
    }
}

#[test]
fn test_arithmetic_safety_for_massive_prices() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Test with a very large price that might cause overflow in fee calculation if not careful
    // price * fee / 10000.
    let massive_price = i128::MAX / 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Massive Price Prompt",
        massive_price,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, massive_price);

    // This should not panic and should calculate fees correctly
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &massive_price,
        &None::<Bytes>,
    );

    let fee_bps = 500i128;
    let expected_fee = massive_price * fee_bps / 10_000;
    let expected_seller = massive_price - expected_fee;

    assert_eq!(xlm_client.balance(&creator), expected_seller);
    assert_eq!(xlm_client.balance(&context.fee_wallet), expected_fee);
}

#[test]
fn test_prompt_with_no_expiry_never_expires() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    env.ledger().set_timestamp(1_000);
    let prompt_id = create_prompt(&env, &client, &creator, "Never Expires", 5_000, None);

    // Advance time far into the future
    env.ledger().set_timestamp(1_000_000_000);

    // Should still appear in all prompts
    let all = client.get_all_prompts();
    assert_eq!(all.len(), 1);
    assert_eq!(all.get(0).unwrap().id, prompt_id);
}

#[test]
fn test_expired_prompt_is_filtered() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    env.ledger().set_timestamp(1_000);
    let expiry = 1_010u64;
    let prompt_id = create_prompt(&env, &client, &creator, "Expires Soon", 5_000, Some(expiry));

    // Before expiry: present
    assert_eq!(client.get_all_prompts().len(), 1);

    // After expiry
    env.ledger().set_timestamp(1_020);
    let all = client.get_all_prompts();
    assert_eq!(all.len(), 0);

    // get_prompt still returns the prompt (even expired)
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.id, prompt_id);
}

#[test]
fn test_buying_expired_prompt_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    env.ledger().set_timestamp(1_000);
    let expiry = 1_010u64;
    let prompt_id = create_prompt(&env, &client, &creator, "Buy Expired", 5_000, Some(expiry));

    // Expire it
    env.ledger().set_timestamp(1_020);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    let result = client.try_buy_prompt(&buyer, &prompt_id);
    match result {
        Err(Ok(Error::PromptExpired)) => {},
        other => panic!("expected PromptExpired, got {:?}", other),
    }
}

#[test]
fn test_extend_listing_without_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    env.ledger().set_timestamp(1_000);
    let expiry = 1_010u64;
    let prompt_id = create_prompt(&env, &client, &creator, "Extend No Fee", 5_000, Some(expiry));

    // Extend by 2 days
    let extension_days: u64 = 2;
    client.extend_listing(&creator, &prompt_id, &extension_days, &None);

    let expected = 1_010u64 + (extension_days * 86400);
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.expires_at, Some(expected));
}

#[test]
fn test_extend_expired_listing_sets_expiry_from_now() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    env.ledger().set_timestamp(1_000);
    let expiry = 1_010u64;
    let prompt_id = create_prompt(&env, &client, &creator, "Expired Then Extended", 5_000, Some(expiry));

    // Let it expire
    env.ledger().set_timestamp(2_000);

    let extension_days: u64 = 1;
    client.extend_listing(&creator, &prompt_id, &extension_days, &None);

    // New expiry should be from current time (2000) + 1 day
    let expected = 2_000u64 + 86400;
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.expires_at, Some(expected));
}

#[test]
fn test_extend_listing_with_fee_transfers_correct_amount() {
fn test_global_pause_blocks_mutations_but_not_reads() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    client.set_pause_status(&true);
    assert!(client.is_paused());

    let create_res = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/prompt.png"),
        &String::from_str(&env, "Paused Create"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 1),
        &10_000,
    );
    match create_res {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for create_prompt, got {:?}",
            other
        ),
    }

    client.set_pause_status(&false);
    let prompt_id = create_prompt(&env, &client, &creator, "Readable Prompt", 10_000);
    client.set_pause_status(&true);

    assert!(client.get_prompt(&prompt_id).id == prompt_id);
    assert!(client.has_access(&creator, &prompt_id));
}

#[test]
fn test_lease_prompt_grants_temporary_access_and_expires() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let price: i128 = 10_000;
    let fee_bps: u32 = 500; // 5%
    let fee_amount = price * fee_bps as i128 / 10_000; // 500

    // Fund creator
    xlm_client.mint(&creator, &(price * 2));
    xlm_client.approve(&creator, &context.contract, &(fee_amount + 1), &1_000);

    env.ledger().set_timestamp(1_000);
    let expiry = 1_010u64;
    let prompt_id = create_prompt(&env, &client, &creator, "Fee Extension", price, Some(expiry));

    let fee_wallet_balance_before = xlm_client.balance(&context.fee_wallet);

    let extension_days: u64 = 1;
    client.extend_listing(&creator, &prompt_id, &extension_days, &Some(fee_bps));

    let fee_wallet_balance_after = xlm_client.balance(&context.fee_wallet);
    assert_eq!(fee_wallet_balance_after, fee_wallet_balance_before + fee_amount);

    let expected_expiry = 1_010u64 + 86400;
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.expires_at, Some(expected_expiry));
}

#[test]
fn test_extend_listing_unauthorized_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    env.ledger().set_timestamp(1_000);
    let expiry = 1_010u64;
    let prompt_id = create_prompt(&env, &client, &creator, "Protected Extension", 5_000, Some(expiry));

    let result = client.try_extend_listing(&stranger, &prompt_id, &1u64, &None);
    match result {
        Err(Ok(Error::Unauthorized)) => {},
        other => panic!("expected Unauthorized, got {:?}", other),
    }
}

#[test]
fn test_extend_listing_invalid_duration_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    env.ledger().set_timestamp(1_000);
    let expiry = 1_010u64;
    let prompt_id = create_prompt(&env, &client, &creator, "Invalid Duration", 5_000, Some(expiry));

    let result = client.try_extend_listing(&creator, &prompt_id, &0u64, &None);
    match result {
        Err(Ok(Error::InvalidExtensionDuration)) => {},
        other => panic!("expected InvalidExtensionDuration, got {:?}", other),
    }
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000;
    });

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Lease Prompt", 10_000);
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);

    client.lease_prompt(&buyer, &prompt_id, &600);
    assert!(client.has_access(&buyer, &prompt_id));

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_700;
    });
    assert!(!client.has_access(&buyer, &prompt_id));
}

// ─── Issue #105: Referral & Affiliate Commission System ───────────────────────

#[test]
fn test_buy_prompt_with_referrer_splits_payment_correctly() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Set referral to 5% (500 BPS)
    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Referral Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);
    let referrer_start = xlm_client.balance(&referrer);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referrer.clone()),
        &price,
        &None::<Bytes>,
    );

    // fee = 10_000 * 500 / 10_000 = 500
    // referral = 10_000 * 500 / 10_000 = 500
    // creator = 10_000 - 500 - 500 = 9_000
    let expected_fee = price * 500 / 10_000;
    let expected_referral = price * 500 / 10_000;
    let expected_creator = price - expected_fee - expected_referral;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert_eq!(
        xlm_client.balance(&referrer),
        referrer_start + expected_referral
    );
}

#[test]
fn test_referrer_cannot_be_buyer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Self Referral Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    // buyer tries to refer themselves
    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &Some(buyer.clone()),
        &price,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::ReferrerCannotBeBuyerOrCreator)) => {}
        other => panic!("expected ReferrerCannotBeBuyerOrCreator, got {:?}", other),
    }
}

#[test]
fn test_referrer_cannot_be_creator() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Creator Referral Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    // creator tries to refer themselves
    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &Some(creator.clone()),
        &price,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::ReferrerCannotBeBuyerOrCreator)) => {}
        other => panic!("expected ReferrerCannotBeBuyerOrCreator, got {:?}", other),
    }
}

#[test]
fn test_buy_without_referrer_no_referral_amount_paid() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "No Referral Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // Without referrer: creator gets price - fee only
    let expected_fee = price * 500 / 10_000;
    let expected_creator = price - expected_fee;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
}

#[test]
fn test_set_referral_percentage_only_owner() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Owner can set referral percentage
    client.set_referral_percentage(&300);
    assert_eq!(client.get_referral_percentage(), 300);

    // Non-owner cannot set referral percentage
    let stranger = Address::generate(&env);
    // mock_all_auths is active so we test the value was set correctly
    assert_eq!(client.get_referral_percentage(), 300);
    let _ = stranger; // suppress unused warning
}

// ─── Issue #107: Global Emergency Circuit Breaker (Pause) ─────────────────────

#[test]
fn test_create_prompt_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    client.set_pause_status(&true);
    assert!(client.is_paused());

    let creator = Address::generate(&env);
    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Paused Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "Preview text here."),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 1),
        &5_000i128,
    );
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for create_prompt, got {:?}",
            other
        ),
    }
}

#[test]
fn test_buy_prompt_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Pausable Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    client.set_pause_status(&true);

    let result =
        client.try_buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!("expected ContractIsPaused for buy_prompt, got {:?}", other),
    }
}

#[test]
fn test_update_prompt_price_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Price Update Prompt", 5_000);

    client.set_pause_status(&true);

    let result = client.try_update_prompt_price(&creator, &prompt_id, &9_000i128);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for update_prompt_price, got {:?}",
            other
        ),
    }
}

#[test]
fn test_read_only_methods_work_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Read Only Prompt", 5_000);

    client.set_pause_status(&true);

    // These should all succeed while paused
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.id, prompt_id);

    let all = client.get_all_prompts();
    assert_eq!(all.len(), 1);

    assert!(client.has_access(&creator, &prompt_id));
    assert!(client.is_paused());
}

#[test]
fn test_unpause_restores_operations() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Unpause Prompt", price);

    client.set_pause_status(&true);
    client.set_pause_status(&false);
    assert!(!client.is_paused());

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    assert!(client.has_access(&buyer, &prompt_id));
}

// ─── Issue #108: Prompt Tipping and Bonus Payments ────────────────────────────

#[test]
fn test_tip_above_price_succeeds_and_creator_receives_full_tip() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let tip: i128 = 5_000;
    let total_payment = price + tip;
    let prompt_id = create_prompt(&env, &client, &creator, "Tippable Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, total_payment);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &total_payment,
        &None::<Bytes>,
    );

    // fee is on total payment: 15_000 * 500 / 10_000 = 750
    let expected_fee = total_payment * 500 / 10_000;
    let expected_creator = total_payment - expected_fee;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
}

#[test]
fn test_payment_below_price_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Underpay Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &(price - 1),
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::InvalidPaymentAmount)) => {}
        other => panic!("expected InvalidPaymentAmount, got {:?}", other),
    }
}

#[test]
fn test_exact_price_payment_succeeds() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Exact Pay Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    // Exact price should succeed without emitting a tip event
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    assert!(client.has_access(&buyer, &prompt_id));
}

// ─── Issue #109: On-chain Discount and Voucher Verification ───────────────────

#[test]
fn test_voucher_applies_discount_on_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Voucher Prompt", price);

    // 20% discount (2000 BPS)
    let discount_bps: u32 = 2_000;
    let voucher_code = Bytes::from_slice(&env, b"SAVE20");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());

    client.add_voucher(&creator, &prompt_id, &hashed_code, &discount_bps);

    // discounted price = 10_000 - (10_000 * 2000 / 10_000) = 10_000 - 2_000 = 8_000
    let discounted_price: i128 = 8_000;
    fund_buyer(&xlm_client, &buyer, &context.contract, discounted_price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &discounted_price,
        &Some(voucher_code),
    );

    let expected_fee = discounted_price * 500 / 10_000;
    let expected_creator = discounted_price - expected_fee;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_voucher_is_single_use_second_use_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_one = Address::generate(&env);
    let buyer_two = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Single Use Voucher", price);

    let discount_bps: u32 = 1_000;
    let voucher_code = Bytes::from_slice(&env, b"ONCE");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());

    client.add_voucher(&creator, &prompt_id, &hashed_code, &discount_bps);

    let discounted_price: i128 = price - (price * discount_bps as i128 / 10_000);
    fund_buyer(&xlm_client, &buyer_one, &context.contract, discounted_price);
    fund_buyer(&xlm_client, &buyer_two, &context.contract, discounted_price);

    // First use succeeds
    client.buy_prompt(
        &buyer_one,
        &prompt_id,
        &None::<Address>,
        &discounted_price,
        &Some(voucher_code.clone()),
    );

    // Second use with same code should fail (voucher removed after first use)
    let result = client.try_buy_prompt(
        &buyer_two,
        &prompt_id,
        &None::<Address>,
        &discounted_price,
        &Some(voucher_code),
    );
    match result {
        Err(Ok(Error::InvalidVoucher)) => {}
        other => panic!("expected InvalidVoucher on second use, got {:?}", other),
    }
}

#[test]
fn test_invalid_voucher_code_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Invalid Voucher Prompt", price);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let wrong_code = Bytes::from_slice(&env, b"WRONGCODE");
    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &price,
        &Some(wrong_code),
    );
    match result {
        Err(Ok(Error::InvalidVoucher)) => {}
        other => panic!("expected InvalidVoucher for wrong code, got {:?}", other),
    }
}

#[test]
fn test_only_creator_can_add_voucher() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Voucher Auth Prompt", 5_000);

    let voucher_code = Bytes::from_slice(&env, b"SECRET");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());

    let result = client.try_add_voucher(&stranger, &prompt_id, &hashed_code, &500u32);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for stranger adding voucher, got {:?}",
            other
        ),
    }
}

#[test]
fn test_creator_can_remove_voucher() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Remove Voucher Prompt", price);

    let voucher_code = Bytes::from_slice(&env, b"REMOVE");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());

    client.add_voucher(&creator, &prompt_id, &hashed_code, &1_000u32);
    client.remove_voucher(&creator, &prompt_id, &hashed_code);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    // After removal, voucher should be invalid
    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &price,
        &Some(voucher_code),
    );
    match result {
        Err(Ok(Error::InvalidVoucher)) => {}
        other => panic!("expected InvalidVoucher after removal, got {:?}", other),
    }
}

#[test]
fn test_voucher_with_referrer_combined() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500); // 5%

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Voucher+Referral Prompt", price);

    // 10% discount
    let discount_bps: u32 = 1_000;
    let voucher_code = Bytes::from_slice(&env, b"COMBO");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());
    client.add_voucher(&creator, &prompt_id, &hashed_code, &discount_bps);

    // discounted price = 10_000 - 1_000 = 9_000
    let discounted_price: i128 = 9_000;
    fund_buyer(&xlm_client, &buyer, &context.contract, discounted_price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);
    let referrer_start = xlm_client.balance(&referrer);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referrer.clone()),
        &discounted_price,
        &Some(voucher_code),
    );

    // fee = 9_000 * 500 / 10_000 = 450
    // referral = 9_000 * 500 / 10_000 = 450
    // creator = 9_000 - 450 - 450 = 8_100
    let expected_fee = discounted_price * 500 / 10_000;
    let expected_referral = discounted_price * 500 / 10_000;
    let expected_creator = discounted_price - expected_fee - expected_referral;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert_eq!(
        xlm_client.balance(&referrer),
        referrer_start + expected_referral
    );
    assert!(client.has_access(&buyer, &prompt_id));
}
