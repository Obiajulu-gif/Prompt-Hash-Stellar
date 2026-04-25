#![cfg(test)]

use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::mock_asset::FungibleTokenContract;
use crate::types::Error;
extern crate std;
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, String};

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
        &String::from_str(env, "https://example.com/prompt.png"),
        &String::from_str(env, title),
        &String::from_str(env, "Software Development"),
        &String::from_str(env, "Generate a production-ready implementation plan."),
        &String::from_str(env, "ciphertext"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped-key"),
        &hash(env, 7),
        &price_stroops,
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

// ─── Emergency Pause Tests ──────────────────────────────────────────────────

#[test]
fn test_admin_can_pause_and_unpause() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    assert!(!client.is_paused());

    client.pause();
    assert!(client.is_paused());

    client.unpause();
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_unauthorized_cannot_pause() {
    let env: Env = Default::default();
    let context = setup(&env);

    // Create a new env without mock_all_auths to enforce authorization
    let env2: Env = Default::default();
    let non_admin = Address::generate(&env2);

    // Re-register contract in env2 to get a clean auth context
    let admin = Address::generate(&env2);
    let fee_wallet = Address::generate(&env2);
    let xlm = env2.register(FungibleTokenContract, (admin.clone(),));
    let contract = env2.register(
        PromptHashContract,
        (admin.clone(), fee_wallet.clone(), xlm.clone()),
    );

    let client = PromptHashContractClient::new(&env2, &contract);
    // Don't mock auths — this should fail because non_admin is not the owner
    client.pause();
}

#[test]
fn test_buy_prompt_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Paused Buy", 5_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);

    client.pause();

    let result = client.try_buy_prompt(&buyer, &prompt_id);
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::ContractPaused),
        other => panic!("expected ContractPaused, got: {:?}", other),
    }
}

#[test]
fn test_create_prompt_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    client.pause();

    let creator = Address::generate(&env);
    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Blocked Prompt"),
        &String::from_str(&env, "AI"),
        &String::from_str(&env, "Preview text"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 8),
        &10_000,
    );
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::ContractPaused),
        other => panic!("expected ContractPaused, got: {:?}", other),
    }
}

#[test]
fn test_set_sale_status_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Status Block", 5_000);

    client.pause();

    let result = client.try_set_prompt_sale_status(&creator, &prompt_id, &false);
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::ContractPaused),
        other => panic!("expected ContractPaused, got: {:?}", other),
    }
}

#[test]
fn test_update_price_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Price Block", 5_000);

    client.pause();

    let result = client.try_update_prompt_price(&creator, &prompt_id, &9_000);
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::ContractPaused),
        other => panic!("expected ContractPaused, got: {:?}", other),
    }
}

#[test]
fn test_read_methods_work_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Readable", 5_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_id);

    // Pause the protocol
    client.pause();

    // All read-only methods should still work
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.id, prompt_id);

    let all = client.get_all_prompts();
    assert_eq!(all.len(), 1);

    let by_creator = client.get_prompts_by_creator(&creator);
    assert_eq!(by_creator.len(), 1);

    let by_buyer = client.get_prompts_by_buyer(&buyer);
    assert_eq!(by_buyer.len(), 1);

    assert!(client.has_access(&buyer, &prompt_id));
    assert!(client.has_access(&creator, &prompt_id));
}

#[test]
fn test_admin_ops_work_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    client.pause();

    // Admin operations should not be blocked by pause
    let new_wallet = Address::generate(&env);
    client.set_fee_percentage(&300);
    client.set_fee_wallet(&new_wallet);
}

#[test]
fn test_unpause_resumes_operations() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Pause, then unpause
    client.pause();
    client.unpause();

    // All operations should work again
    let prompt_id = create_prompt(&env, &client, &creator, "Resumed Prompt", 5_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_id);

    assert!(client.has_access(&buyer, &prompt_id));
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);

    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    assert!(!client.get_prompt(&prompt_id).active);

    client.set_prompt_sale_status(&creator, &prompt_id, &true);
    client.update_prompt_price(&creator, &prompt_id, &7_000);
    assert_eq!(client.get_prompt(&prompt_id).price_stroops, 7_000);
}
