#![cfg(test)]

use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::mock_asset::FungibleTokenContract;
use crate::types::{CreatePromptParams, Error, Split};
extern crate std;
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, String, Vec};

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
) -> u128 {
    client.create_prompt(
        creator,
        &CreatePromptParams {
            image_url: String::from_str(env, "https://example.com/prompt.png"),
            title: String::from_str(env, title),
            category: String::from_str(env, "Software Development"),
            preview_text: String::from_str(env, "Generate a production-ready implementation plan."),
            encrypted_prompt: String::from_str(env, "ciphertext"),
            encryption_iv: String::from_str(env, "iv"),
            wrapped_key: String::from_str(env, "wrapped-key"),
            content_hash: hash(env, 7),
            price_stroops,
            splits: Vec::new(env),
        },
    )
}

fn fund_buyer(xlm_client: &token::StellarAssetClient<'_>, buyer: &Address, spender: &Address, amount: i128) {
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
    assert_eq!(prompt.encrypted_prompt, String::from_str(&env, "ciphertext"));
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

    client.buy_prompt(&buyer_one, &prompt_id);
    client.buy_prompt(&buyer_two, &prompt_id);

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
    client.buy_prompt(&buyer, &prompt_id);

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
    client.buy_prompt(&buyer, &prompt_a);

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
    client.buy_prompt(&buyer, &prompt_id);

    let duplicate_purchase = client.try_buy_prompt(&buyer, &prompt_id);
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

    let result = client.try_buy_prompt(&creator, &prompt_id);
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

    let result = client.try_buy_prompt(&buyer, &prompt_id);
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

    client.buy_prompt(&buyer, &prompt_id);

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

    client.buy_prompt(&buyer, &prompt_id);

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
        Err(Ok(Error::Unauthorized)) => {},
        other => panic!("expected unauthorized for status update, got {:?}", other),
    }

    // Try to update price as stranger
    let price_res = client.try_update_prompt_price(&stranger, &prompt_id, &1_000);
    match price_res {
        Err(Ok(Error::Unauthorized)) => {},
        other => panic!("expected unauthorized for price update, got {:?}", other),
    }
}

#[test]
fn test_buy_nonexistent_prompt_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let buyer = Address::generate(&env);

    let result = client.try_buy_prompt(&buyer, &999_999);
    match result {
        Err(Ok(Error::PromptNotFound)) => {},
        other => panic!("expected PromptNotFound for nonexistent prompt, got {:?}", other),
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
    let prompt_id = create_prompt(&env, &client, &creator, "Massive Price Prompt", massive_price);

    fund_buyer(&xlm_client, &buyer, &context.contract, massive_price);

    // This should not panic and should calculate fees correctly
    client.buy_prompt(&buyer, &prompt_id);
    
    let fee_bps = 500i128;
    let expected_fee = massive_price * fee_bps / 10_000;
    let expected_seller = massive_price - expected_fee;
    
    assert_eq!(xlm_client.balance(&creator), expected_seller);
    assert_eq!(xlm_client.balance(&context.fee_wallet), expected_fee);
}

#[test]
fn test_buy_prompt_distributes_splits_correctly() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;

    // fee = 500 BPS (5%), co_creator split = 2000 BPS (20%), creator gets remainder 7500 BPS (75%)
    let mut splits = Vec::new(&env);
    splits.push_back(Split { recipient: co_creator.clone(), bps: 2000 });

    client.create_prompt(
        &creator,
        &CreatePromptParams {
            image_url: String::from_str(&env, "https://example.com/prompt.png"),
            title: String::from_str(&env, "Split Prompt"),
            category: String::from_str(&env, "Software Development"),
            preview_text: String::from_str(&env, "Generate a production-ready implementation plan."),
            encrypted_prompt: String::from_str(&env, "ciphertext"),
            encryption_iv: String::from_str(&env, "iv"),
            wrapped_key: String::from_str(&env, "wrapped-key"),
            content_hash: hash(&env, 7),
            price_stroops: price,
            splits,
        },
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let co_creator_start = xlm_client.balance(&co_creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &0u128);

    let fee_amount = price * 500 / 10_000;           // 500
    let co_creator_amount = price * 2000 / 10_000;   // 2000
    let creator_amount = price - fee_amount - co_creator_amount; // 7500

    assert_eq!(xlm_client.balance(&creator), creator_start + creator_amount);
    assert_eq!(xlm_client.balance(&co_creator), co_creator_start + co_creator_amount);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start + fee_amount);
}

#[test]
fn test_create_prompt_rejects_splits_exceeding_available_bps() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    // fee = 500 BPS, split = 9600 BPS → total 10100 > 10000, must fail
    let mut splits = Vec::new(&env);
    splits.push_back(Split { recipient: co_creator.clone(), bps: 9600 });

    let result = client.try_create_prompt(
        &creator,
        &CreatePromptParams {
            image_url: String::from_str(&env, "https://example.com/prompt.png"),
            title: String::from_str(&env, "Overflow Split Prompt"),
            category: String::from_str(&env, "Software Development"),
            preview_text: String::from_str(&env, "Generate a production-ready implementation plan."),
            encrypted_prompt: String::from_str(&env, "ciphertext"),
            encryption_iv: String::from_str(&env, "iv"),
            wrapped_key: String::from_str(&env, "wrapped-key"),
            content_hash: hash(&env, 7),
            price_stroops: 10_000i128,
            splits,
        },
    );

    match result {
        Err(Ok(Error::InvalidSplits)) => {}
        other => panic!("expected InvalidSplits, got {:?}", other),
    }
}

#[test]
fn test_create_prompt_rejects_zero_bps_split() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    let mut splits = Vec::new(&env);
    splits.push_back(Split { recipient: co_creator.clone(), bps: 0 });

    let result = client.try_create_prompt(
        &creator,
        &CreatePromptParams {
            image_url: String::from_str(&env, "https://example.com/prompt.png"),
            title: String::from_str(&env, "Zero BPS Split Prompt"),
            category: String::from_str(&env, "Software Development"),
            preview_text: String::from_str(&env, "Generate a production-ready implementation plan."),
            encrypted_prompt: String::from_str(&env, "ciphertext"),
            encryption_iv: String::from_str(&env, "iv"),
            wrapped_key: String::from_str(&env, "wrapped-key"),
            content_hash: hash(&env, 7),
            price_stroops: 10_000i128,
            splits,
        },
    );

    match result {
        Err(Ok(Error::InvalidSplits)) => {}
        other => panic!("expected InvalidSplits for zero BPS, got {:?}", other),
    }
}

#[test]
fn test_buy_prompt_with_multiple_splits() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let partner_a = Address::generate(&env);
    let partner_b = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;

    // fee=500, partner_a=1500, partner_b=1000, creator=7000
    let mut splits = Vec::new(&env);
    splits.push_back(Split { recipient: partner_a.clone(), bps: 1500 });
    splits.push_back(Split { recipient: partner_b.clone(), bps: 1000 });

    client.create_prompt(
        &creator,
        &CreatePromptParams {
            image_url: String::from_str(&env, "https://example.com/prompt.png"),
            title: String::from_str(&env, "Multi Split Prompt"),
            category: String::from_str(&env, "Software Development"),
            preview_text: String::from_str(&env, "Generate a production-ready implementation plan."),
            encrypted_prompt: String::from_str(&env, "ciphertext"),
            encryption_iv: String::from_str(&env, "iv"),
            wrapped_key: String::from_str(&env, "wrapped-key"),
            content_hash: hash(&env, 7),
            price_stroops: price,
            splits,
        },
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &0u128);

    assert_eq!(xlm_client.balance(&partner_a), 1500i128);
    assert_eq!(xlm_client.balance(&partner_b), 1000i128);
    assert_eq!(xlm_client.balance(&creator), 7000i128);
    assert_eq!(xlm_client.balance(&context.fee_wallet), 500i128);
}
