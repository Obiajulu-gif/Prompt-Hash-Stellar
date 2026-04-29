#![cfg(test)]

use crate::{PromptHashContract, PromptHashContractClient};
use crate::types::Error;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env, IntoVal, String};

fn setup_env() -> (Env, Address, Address, Address, Address, Address, PromptHashContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PromptHashContract);
    let client = PromptHashContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_wallet = Address::generate(&env);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    client.initialize(&fee_wallet, &token_contract);

    (env, admin, fee_wallet, creator, buyer, token_contract, client)
}

fn create_native_token(env: &Env, admin: &Address) -> token::Client<'static> {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    token::Client::new(env, &sac)
}

fn create_prompt_with_supply(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    max_supply: u32,
    price: i128,
) -> u32 {
    client.create_prompt(
        creator,
        &String::from_str(env, "https://example.com/image.png"),
        &String::from_str(env, "Test Prompt"),
        &String::from_str(env, "testing"),
        &String::from_str(env, "preview"),
        &String::from_str(env, "encrypted"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped_key"),
        &String::from_str(env, "hash"),
        &price,
        &max_supply,
    )
}

#[test]
fn test_create_prompt_with_max_supply() {
    let (env, _admin, _fee_wallet, creator, _buyer, _token_contract, client) = setup_env();

    let id = create_prompt_with_supply(&env, &client, &creator, 10, 100);
    let prompt = client.get_prompt(&id);
    assert_eq!(prompt.max_supply, 10);
    assert_eq!(prompt.sales_count, 0);
}

#[test]
fn test_buy_prompt_within_max_supply_succeeds() {
    let (env, admin, _fee_wallet, creator, buyer, _token_contract, client) = setup_env();
    let token = create_native_token(&env, &admin);

    let id = create_prompt_with_supply(&env, &client, &creator, 3, 1000);

    token.mint(&buyer, &10000);
    token.approve(&buyer, &client.address, &1000, &1000);

    let result = client.buy_prompt(&buyer, &id);
    assert!(result.is_ok());

    let prompt = client.get_prompt(&id);
    assert_eq!(prompt.sales_count, 1);
    assert!(client.has_access(&buyer, &id));
}

#[test]
fn test_buy_prompt_reaches_exact_max_supply() {
    let (env, admin, _fee_wallet, creator, buyer, _token_contract, client) = setup_env();
    let token = create_native_token(&env, &admin);

    let id = create_prompt_with_supply(&env, &client, &creator, 2, 1000);

    token.mint(&buyer, &10000);
    token.approve(&buyer, &client.address, &10000, &1000);

    // First purchase succeeds
    client.buy_prompt(&buyer, &id).unwrap();

    // Second purchase succeeds (exactly at max supply)
    client.buy_prompt(&buyer, &id).unwrap();

    let prompt = client.get_prompt(&id);
    assert_eq!(prompt.sales_count, 2);
}

#[test]
fn test_buy_prompt_exceeds_max_supply_fails() {
    let (env, admin, _fee_wallet, creator, buyer, _token_contract, client) = setup_env();
    let token = create_native_token(&env, &admin);

    let id = create_prompt_with_supply(&env, &client, &creator, 1, 1000);

    token.mint(&buyer, &10000);
    token.approve(&buyer, &client.address, &10000, &1000);

    // First purchase succeeds
    client.buy_prompt(&buyer, &id).unwrap();

    // Second purchase fails because max_supply = 1
    let result = client.try_buy_prompt(&buyer, &id);
    assert_eq!(result, Err(Ok(Error::MaxSupplyReached)));
}

#[test]
fn test_max_supply_zero_is_unlimited() {
    let (env, admin, _fee_wallet, creator, buyer, _token_contract, client) = setup_env();
    let token = create_native_token(&env, &admin);

    let id = create_prompt_with_supply(&env, &client, &creator, 0, 1000);

    token.mint(&buyer, &100000);
    token.approve(&buyer, &client.address, &100000, &1000);

    // Multiple purchases should all succeed
    for _ in 0..5 {
        client.buy_prompt(&buyer, &id).unwrap();
    }

    let prompt = client.get_prompt(&id);
    assert_eq!(prompt.sales_count, 5);
}

#[test]
fn test_max_supply_one_allows_exactly_one_purchase() {
    let (env, admin, _fee_wallet, creator, buyer1, _token_contract, client) = setup_env();
    let token = create_native_token(&env, &admin);

    let id = create_prompt_with_supply(&env, &client, &creator, 1, 1000);

    token.mint(&buyer1, &10000);
    token.approve(&buyer1, &client.address, &10000, &1000);

    // First buyer succeeds
    client.buy_prompt(&buyer1, &id).unwrap();

    // Any further purchase fails
    let result = client.try_buy_prompt(&buyer1, &id);
    assert_eq!(result, Err(Ok(Error::MaxSupplyReached)));
}

#[test]
fn test_multiple_buyers_until_supply_exhausted() {
    let (env, admin, _fee_wallet, creator, buyer1, _token_contract, client) = setup_env();
    let token = create_native_token(&env, &admin);

    let buyer2 = Address::generate(&env);
    let buyer3 = Address::generate(&env);

    let id = create_prompt_with_supply(&env, &client, &creator, 2, 1000);

    token.mint(&buyer1, &10000);
    token.mint(&buyer2, &10000);
    token.mint(&buyer3, &10000);
    token.approve(&buyer1, &client.address, &10000, &1000);
    token.approve(&buyer2, &client.address, &10000, &1000);
    token.approve(&buyer3, &client.address, &10000, &1000);

    // Two buyers can purchase
    client.buy_prompt(&buyer1, &id).unwrap();
    client.buy_prompt(&buyer2, &id).unwrap();

    // Third buyer cannot
    let result = client.try_buy_prompt(&buyer3, &id);
    assert_eq!(result, Err(Ok(Error::MaxSupplyReached)));

    let prompt = client.get_prompt(&id);
    assert_eq!(prompt.sales_count, 2);
}

#[test]
fn test_supply_check_happens_before_payment() {
    let (env, admin, _fee_wallet, creator, buyer, _token_contract, client) = setup_env();
    let token = create_native_token(&env, &admin);

    let id = create_prompt_with_supply(&env, &client, &creator, 1, 1000);

    token.mint(&buyer, &10000);
    token.approve(&buyer, &client.address, &10000, &1000);

    // Exhaust supply
    client.buy_prompt(&buyer, &id).unwrap();

    // Capture balance before failed attempt
    let balance_before = token.balance(&buyer);

    // Attempt to buy again fails
    let result = client.try_buy_prompt(&buyer, &id);
    assert_eq!(result, Err(Ok(Error::MaxSupplyReached)));

    // Balance should not change because payment should not occur
    let balance_after = token.balance(&buyer);
    assert_eq!(balance_before, balance_after);
}
