#![cfg(test)]

use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::mock_asset::FungibleTokenContract;
use crate::types::Error;
extern crate std;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal, String,
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
    setup_contract(env)
}

fn setup_without_auth_mock(env: &Env) -> PromptHashContext {
    setup_contract(env)
}

fn setup_contract(env: &Env) -> PromptHashContext {

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
fn test_prompt_ids_are_sequential_and_all_prompts_are_ordered() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_a = create_prompt(&env, &client, &creator, "Prompt A", 10_000);
    let prompt_b = create_prompt(&env, &client, &creator, "Prompt B", 10_000);

    assert_eq!(prompt_a, 0);
    assert_eq!(prompt_b, 1);

    let all_prompts = client.get_all_prompts();
    assert_eq!(all_prompts.len(), 2);
    assert_eq!(all_prompts.get(0).unwrap().id, prompt_a);
    assert_eq!(all_prompts.get(1).unwrap().id, prompt_b);
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
fn test_update_prompt_price_requires_positive_price() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Price Guard", 5_000);

    let result = client.try_update_prompt_price(&creator, &prompt_id, &0);
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::InvalidPrice),
        other => panic!("unexpected invalid price update result: {:?}", other),
    }
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
    let prompt_b = create_prompt(&env, &client, &creator, "Prompt B", 9_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_a);

    let created = client.get_prompts_by_creator(&creator);
    assert_eq!(created.len(), 2);
    assert_eq!(created.get(0).unwrap().id, prompt_a);
    assert_eq!(created.get(1).unwrap().id, prompt_b);

    let purchased = client.get_prompts_by_buyer(&buyer);
    assert_eq!(purchased.len(), 1);
    assert_eq!(purchased.get(0).unwrap().id, prompt_a);
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
fn test_pausing_prompt_does_not_revoke_existing_access() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Pause Invariant", 4_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_id);
    assert!(client.has_access(&buyer, &prompt_id));

    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_non_creator_cannot_pause_or_update_price() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let attacker = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Creator Only", 4_000);

    let pause_attempt = client.try_set_prompt_sale_status(&attacker, &prompt_id, &false);
    match pause_attempt {
        Err(Ok(error)) => assert_eq!(error, Error::NotPromptCreator),
        other => panic!("unexpected pause attempt result: {:?}", other),
    }

    let price_attempt = client.try_update_prompt_price(&attacker, &prompt_id, &9_000);
    match price_attempt {
        Err(Ok(error)) => assert_eq!(error, Error::NotPromptCreator),
        other => panic!("unexpected price attempt result: {:?}", other),
    }
}

#[test]
fn test_create_prompt_enforces_title_length_limit() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let long_title: std::string::String = std::iter::repeat('a').take(121).collect();

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/prompt.png"),
        &String::from_str(&env, &long_title),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "Generate a production-ready implementation plan."),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 7),
        &10_000,
    );

    match result {
        Err(Ok(error)) => assert_eq!(error, Error::InvalidTitleLength),
        other => panic!("unexpected create_prompt result: {:?}", other),
    }
}

#[test]
fn test_buyer_index_preserves_purchase_order() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_a = create_prompt(&env, &client, &creator, "Prompt A", 8_000);
    let prompt_b = create_prompt(&env, &client, &creator, "Prompt B", 9_000);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_b);
    client.buy_prompt(&buyer, &prompt_a);

    let purchased = client.get_prompts_by_buyer(&buyer);
    assert_eq!(purchased.len(), 2);
    assert_eq!(purchased.get(0).unwrap().id, prompt_b);
    assert_eq!(purchased.get(1).unwrap().id, prompt_a);
}

#[test]
fn test_admin_fee_controls_require_owner_auth() {
    let env: Env = Default::default();
    let context = setup_without_auth_mock(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let new_fee_bps: u32 = 750;

    // No auth => fails.
    assert!(client.try_set_fee_percentage(&new_fee_bps).is_err());

    // Non-owner auth => fails.
    let attacker = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &context.contract,
            fn_name: "set_fee_percentage",
            args: (&new_fee_bps,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_set_fee_percentage(&new_fee_bps).is_err());

    // Owner auth => succeeds.
    env.mock_auths(&[MockAuth {
        address: &context.admin,
        invoke: &MockAuthInvoke {
            contract: &context.contract,
            fn_name: "set_fee_percentage",
            args: (&new_fee_bps,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.set_fee_percentage(&new_fee_bps);

    // Owner auth + invalid fee => typed error.
    let invalid_fee_bps: u32 = 10_001;
    env.mock_auths(&[MockAuth {
        address: &context.admin,
        invoke: &MockAuthInvoke {
            contract: &context.contract,
            fn_name: "set_fee_percentage",
            args: (&invalid_fee_bps,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let invalid_fee_attempt = client.try_set_fee_percentage(&invalid_fee_bps);
    match invalid_fee_attempt {
        Err(Ok(error)) => assert_eq!(error, Error::InvalidFeePercentage),
        other => panic!("unexpected invalid fee update result: {:?}", other),
    }

    // Owner auth => can update fee wallet.
    let new_fee_wallet = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &context.admin,
        invoke: &MockAuthInvoke {
            contract: &context.contract,
            fn_name: "set_fee_wallet",
            args: (&new_fee_wallet,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.set_fee_wallet(&new_fee_wallet);

    // Non-owner auth => cannot update fee wallet.
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &context.contract,
            fn_name: "set_fee_wallet",
            args: (&new_fee_wallet,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_set_fee_wallet(&new_fee_wallet).is_err());
}
