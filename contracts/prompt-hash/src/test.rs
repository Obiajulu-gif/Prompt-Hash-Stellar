#![cfg(test)]
use crate::contract::{PromptHashContract, PromptHashContractClient as PromptClient};
use crate::mock_asset::FungibleTokenContract;
use soroban_sdk::{testutils::Address as _, Address, Env, String, log};
extern crate std;

#[derive(Clone, Debug, PartialEq)]
struct PromptHashContext {
    admin: Address,
    fee_wallet: Address,
    xlm: Address,
    contract: Address,
}

fn prompthash(e: &Env) -> PromptHashContext {
    // Mock all auths before registering the contract
    // This is needed because the constructor requires auth
    e.mock_all_auths();

    let admin = Address::generate(e);
    let fee_wallet = Address::generate(e);
    let xlm = e.register(FungibleTokenContract, (admin.clone(),));
    let contract = e.register(
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

#[test]
fn test_create_prompt() {
    let env: Env = Default::default();

    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let image_url = String::from_str(&env, "https://example.com/image.png");
    let description = String::from_str(&env, "This is a prompt");
    let title = String::from_str(&env, "Prompt 1");
    let category = String::from_str(&env, "Category 1");
    let price = 1000;

    let token_id = client.create_prompt(
        &creator,
        &image_url,
        &description,
        &title,
        &category,
        &price,
    ) as u32;

    log!(&env, "Token ID: {}", token_id);

    let prompts = client.get_all_prompts();
    assert!(prompts.len() == 1, "Prompt not created");

    assert!(client.owner_of(&token_id) == creator, "Invalid owner");

    // Assert nft owner
    let opt_prompt = prompts.get(0);
    assert!(opt_prompt.is_some(), "Prompt not found");
    let prompt = opt_prompt.unwrap();
    let token_owner = prompt.owner;
    assert_eq!(token_owner, creator);
}
