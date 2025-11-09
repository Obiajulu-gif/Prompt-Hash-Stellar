#![cfg(test)]
use crate::contract::{PromptHashContract, PromptHashContractClient as PromptClient};
use crate::mock_asset::FungibleTokenContract;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};
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

// Helper function to create a prompt with default values
fn create_test_prompt(
    env: &Env,
    client: &PromptClient,
    creator: &Address,
    title: &str,
    price: u128,
) -> u128 {
    let image_url = String::from_str(env, "https://example.com/image.png");
    let description = String::from_str(env, "Test prompt description");
    let title_str = String::from_str(env, title);
    let category = String::from_str(env, "AI Art");

    client.create_prompt(
        creator,
        &image_url,
        &description,
        &title_str,
        &category,
        &price,
    )
}

// ============================================================================
// Test: Create Prompt
// ============================================================================

#[test]
fn test_create_prompt() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let token_id = create_test_prompt(&env, &client, &creator, "My First Prompt", 1000);

    // Verify prompt was created
    let prompts = client.get_all_prompts();
    assert_eq!(prompts.len(), 1, "Prompt not created");

    // Verify NFT ownership
    assert_eq!(
        client.owner_of(&(token_id as u32)),
        creator,
        "Invalid owner"
    );

    // Verify prompt data
    let prompt = prompts.get(0).unwrap();
    assert_eq!(prompt.owner, creator);
    assert_eq!(prompt.id, token_id);
    assert_eq!(prompt.price, 1000);
    assert_eq!(prompt.for_sale, false);
    assert_eq!(prompt.sold, false);
}

#[test]
fn test_create_multiple_prompts() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator1 = Address::generate(&env);
    let creator2 = Address::generate(&env);

    // Create 3 prompts
    let token_id_1 = create_test_prompt(&env, &client, &creator1, "Prompt 1", 1000);
    let token_id_2 = create_test_prompt(&env, &client, &creator2, "Prompt 2", 2000);
    let token_id_3 = create_test_prompt(&env, &client, &creator1, "Prompt 3", 3000);

    // Verify all prompts were created
    let prompts = client.get_all_prompts();
    assert_eq!(prompts.len(), 3, "Not all prompts created");

    // Verify token IDs are sequential
    assert_eq!(token_id_1, 0);
    assert_eq!(token_id_2, 1);
    assert_eq!(token_id_3, 2);

    // Verify ownership
    assert_eq!(client.owner_of(&(token_id_1 as u32)), creator1);
    assert_eq!(client.owner_of(&(token_id_2 as u32)), creator2);
    assert_eq!(client.owner_of(&(token_id_3 as u32)), creator1);
}

#[test]
fn test_get_next_token() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);

    // Initially, next token should be 0
    let next_token = client.get_next_token();
    assert_eq!(next_token, 0);

    // Create a prompt
    create_test_prompt(&env, &client, &creator, "Prompt 1", 1000);

    // Next token should now be 1
    let next_token = client.get_next_token();
    assert_eq!(next_token, 1);

    // Create another prompt
    create_test_prompt(&env, &client, &creator, "Prompt 2", 2000);

    // Next token should now be 2
    let next_token = client.get_next_token();
    assert_eq!(next_token, 2);
}

// ============================================================================
// Test: List Prompt for Sale
// ============================================================================

#[test]
fn test_list_prompt_for_sale() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let token_id = create_test_prompt(&env, &client, &creator, "Prompt 1", 1000);

    // List prompt for sale
    client.list_prompt_for_sale(&creator, &token_id, &5000);

    // Verify prompt is listed
    let prompts = client.get_all_prompts();
    let prompt = prompts.get(0).unwrap();
    assert_eq!(prompt.for_sale, true);
    assert_eq!(prompt.price, 5000);
    assert_eq!(prompt.sold, false);
}

#[test]
#[should_panic(expected = "Only the owner can list the prompt for sale")]
fn test_list_prompt_for_sale_not_owner() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let non_owner = Address::generate(&env);
    let token_id = create_test_prompt(&env, &client, &creator, "Prompt 1", 1000);

    // Try to list prompt as non-owner (should panic)
    client.list_prompt_for_sale(&non_owner, &token_id, &5000);
}

#[test]
fn test_update_listing_price() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let token_id = create_test_prompt(&env, &client, &creator, "Prompt 1", 1000);

    // List prompt for sale
    client.list_prompt_for_sale(&creator, &token_id, &5000);

    // Update price
    client.list_prompt_for_sale(&creator, &token_id, &7500);

    // Verify price was updated
    let prompts = client.get_all_prompts();
    let prompt = prompts.get(0).unwrap();
    assert_eq!(prompt.price, 7500);
    assert_eq!(prompt.for_sale, true);
}

// ============================================================================
// Test: Buy Prompt
// ============================================================================

#[test]
fn test_buy_prompt() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Mint XLM to buyer for payment
    xlm_client.mint(&buyer, &100000);

    // Create and list prompt
    let token_id = create_test_prompt(&env, &client, &seller, "Prompt 1", 10000);
    client.list_prompt_for_sale(&seller, &token_id, &10000);

    // Buyer approves contract to spend XLM
    xlm_client.approve(&buyer, &context.contract, &100000, &1000);

    // Seller approves contract to transfer NFT
    client.approve(&seller, &context.contract, &(token_id as u32), &1000);

    // Get initial balances
    let initial_seller_balance = xlm_client.balance(&seller);
    let initial_fee_wallet_balance = xlm_client.balance(&context.fee_wallet);

    // Buy prompt
    client.buy_prompt(&buyer, &token_id);

    // Verify ownership transferred
    assert_eq!(client.owner_of(&(token_id as u32)), buyer);

    // Verify prompt status updated
    let prompts = client.get_all_prompts();
    let prompt = prompts.get(0).unwrap();
    assert_eq!(prompt.owner, buyer);
    assert_eq!(prompt.sold, true);
    assert_eq!(prompt.for_sale, false);

    // Verify payments (fee is 5% = 500 basis points)
    let fee_amount = 10000 * 500 / 10000; // 500
    let seller_amount = 10000 - fee_amount; // 9500

    assert_eq!(
        xlm_client.balance(&seller),
        initial_seller_balance + seller_amount as i128
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        initial_fee_wallet_balance + fee_amount as i128
    );
}

#[test]
#[should_panic(expected = "Prompt is not for sale")]
fn test_buy_prompt_not_for_sale() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create prompt but don't list it
    let token_id = create_test_prompt(&env, &client, &seller, "Prompt 1", 10000);

    // Try to buy (should panic)
    client.buy_prompt(&buyer, &token_id);
}

#[test]
#[should_panic(expected = "Cannot buy your own prompt")]
fn test_buy_own_prompt() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let seller = Address::generate(&env);

    // Create and list prompt
    let token_id = create_test_prompt(&env, &client, &seller, "Prompt 1", 10000);
    client.list_prompt_for_sale(&seller, &token_id, &10000);

    // Try to buy own prompt (should panic)
    client.buy_prompt(&seller, &token_id);
}

#[test]
#[should_panic(expected = "Prompt has already been sold")]
fn test_buy_already_sold_prompt() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let seller = Address::generate(&env);
    let buyer1 = Address::generate(&env);
    let buyer2 = Address::generate(&env);

    // Mint XLM to buyers
    xlm_client.mint(&buyer1, &100000);
    xlm_client.mint(&buyer2, &100000);

    // Create and list prompt
    let token_id = create_test_prompt(&env, &client, &seller, "Prompt 1", 10000);
    client.list_prompt_for_sale(&seller, &token_id, &10000);

    // Approvals for first buyer
    xlm_client.approve(&buyer1, &context.contract, &100000, &1000);
    client.approve(&seller, &context.contract, &(token_id as u32), &1000);

    // First buyer purchases
    client.buy_prompt(&buyer1, &token_id);

    // Approvals for second buyer
    xlm_client.approve(&buyer2, &context.contract, &100000, &1000);

    // Second buyer tries to purchase (should panic)
    client.buy_prompt(&buyer2, &token_id);
}

// ============================================================================
// Test: Admin Functions - Fee Management
// ============================================================================

#[test]
fn test_set_fee_percentage() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    // Admin sets new fee percentage (10% = 1000 basis points)
    client.set_fee_percentage(&1000);

    // Verify fee is applied correctly in a sale
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    xlm_client.mint(&buyer, &100000);

    let token_id = create_test_prompt(&env, &client, &seller, "Prompt 1", 10000);
    client.list_prompt_for_sale(&seller, &token_id, &10000);

    // Approvals
    xlm_client.approve(&buyer, &context.contract, &100000, &1000);
    client.approve(&seller, &context.contract, &(token_id as u32), &1000);

    let initial_fee_wallet_balance = xlm_client.balance(&context.fee_wallet);
    client.buy_prompt(&buyer, &token_id);

    // Fee should be 10% of 10000 = 1000
    let fee_amount = 10000 * 1000 / 10000;
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        initial_fee_wallet_balance + fee_amount as i128
    );
}

#[test]
fn test_set_fee_wallet() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let new_fee_wallet = Address::generate(&env);

    // Admin sets new fee wallet
    client.set_fee_wallet(&new_fee_wallet);

    // Verify fees go to new wallet
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    xlm_client.mint(&buyer, &100000);

    let token_id = create_test_prompt(&env, &client, &seller, "Prompt 1", 10000);
    client.list_prompt_for_sale(&seller, &token_id, &10000);

    // Approvals
    xlm_client.approve(&buyer, &context.contract, &100000, &1000);
    client.approve(&seller, &context.contract, &(token_id as u32), &1000);

    let initial_new_wallet_balance = xlm_client.balance(&new_fee_wallet);
    client.buy_prompt(&buyer, &token_id);

    // Fee should go to new wallet
    let fee_amount = 10000 * 500 / 10000; // 5% default fee
    assert_eq!(
        xlm_client.balance(&new_fee_wallet),
        initial_new_wallet_balance + fee_amount as i128
    );
}

// ============================================================================
// Test: NFT Standard Functions
// ============================================================================

#[test]
fn test_nft_transfer() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_id = create_test_prompt(&env, &client, &owner, "Prompt 1", 1000);

    // Transfer NFT
    client.transfer(&owner, &recipient, &(token_id as u32));

    // Verify ownership transferred
    assert_eq!(client.owner_of(&(token_id as u32)), recipient);

    // Verify prompt owner is NOT updated (only NFT ownership changes)
    let prompts = client.get_all_prompts();
    let prompt = prompts.get(0).unwrap();
    assert_eq!(prompt.owner, owner); // Prompt owner stays the same
}

#[test]
fn test_nft_approve_and_transfer_from() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let owner = Address::generate(&env);
    let approved = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_id = create_test_prompt(&env, &client, &owner, "Prompt 1", 1000);

    // Approve another address
    client.approve(&owner, &approved, &(token_id as u32), &1000);
    let approved_opt = client.get_approved(&(token_id as u32));
    assert!(approved_opt.is_some(), "Approval failed");
    // Verify approval
    assert_eq!(approved_opt.unwrap(), approved);

    // Approved address transfers the NFT
    client.transfer_from(&approved, &owner, &recipient, &(token_id as u32));

    // Verify ownership transferred
    assert_eq!(client.owner_of(&(token_id as u32)), recipient);
}

#[test]
fn test_nft_burn() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let owner = Address::generate(&env);
    let token_id = create_test_prompt(&env, &client, &owner, "Prompt 1", 1000);

    // Verify NFT exists
    assert_eq!(client.owner_of(&(token_id as u32)), owner);

    // Burn the NFT
    client.burn(&owner, &(token_id as u32));

    // Note: After burning, owner_of will panic or return error
    // The prompt data still exists in storage but NFT is burned
}

#[test]
fn test_nft_balance() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let owner = Address::generate(&env);

    // Initially balance is 0
    assert_eq!(client.balance(&owner), 0);

    // Create 3 prompts
    create_test_prompt(&env, &client, &owner, "Prompt 1", 1000);
    create_test_prompt(&env, &client, &owner, "Prompt 2", 2000);
    create_test_prompt(&env, &client, &owner, "Prompt 3", 3000);

    // Balance should be 3
    assert_eq!(client.balance(&owner), 3);
}

// ============================================================================
// Test: Ownership Management
// ============================================================================

#[test]
fn test_transfer_contract_ownership() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let new_owner = Address::generate(&env);

    // Current owner is admin
    assert_eq!(client.get_owner().unwrap(), context.admin);

    // Transfer ownership
    client.transfer_ownership(&new_owner, &10000);

    // Ownership should still be with admin (pending acceptance)
    assert_eq!(client.get_owner().unwrap(), context.admin);

    // New owner accepts
    client.accept_ownership();

    // Now ownership is transferred
    assert_eq!(client.get_owner().unwrap(), new_owner);
}

#[test]
fn test_renounce_ownership() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    // Admin renounces ownership
    client.renounce_ownership();

    // Owner should be zero address (no owner)
    // Note: This makes the contract unmanageable
}

// ============================================================================
// Test: Edge Cases and Integration Tests
// ============================================================================

#[test]
fn test_multiple_sales_lifecycle() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer1 = Address::generate(&env);
    let _buyer2 = Address::generate(&env);

    // Mint XLM to buyers
    xlm_client.mint(&buyer1, &100000);

    // Create prompt
    let token_id = create_test_prompt(&env, &client, &creator, "Prompt 1", 5000);

    // First sale: creator -> buyer1
    client.list_prompt_for_sale(&creator, &token_id, &5000);

    // Approvals
    xlm_client.approve(&buyer1, &context.contract, &100000, &1000);
    client.approve(&creator, &context.contract, &(token_id as u32), &1000);

    client.buy_prompt(&buyer1, &token_id);

    assert_eq!(client.owner_of(&(token_id as u32)), buyer1);

    // Buyer1 cannot list it again (prompt is marked as sold)
    // This is a limitation - once sold, cannot be resold through the marketplace
    let prompts = client.get_all_prompts();
    let prompt = prompts.get(0).unwrap();
    assert_eq!(prompt.sold, true);
    assert_eq!(prompt.for_sale, false);
}

#[test]
fn test_zero_price_prompt() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);

    // Create prompt with zero price
    let _token_id = create_test_prompt(&env, &client, &creator, "Free Prompt", 0);

    // Verify prompt was created
    let prompts = client.get_all_prompts();
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts.get(0).unwrap().price, 0);
}

#[test]
fn test_high_price_prompt() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);

    // Create prompt with very high price
    let high_price = u128::MAX / 2;
    let _token_id = create_test_prompt(&env, &client, &creator, "Expensive Prompt", high_price);

    // Verify prompt was created
    let prompts = client.get_all_prompts();
    assert_eq!(prompts.get(0).unwrap().price, high_price);
}

#[test]
fn test_get_all_prompts_empty() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    // Get all prompts when none exist
    let prompts = client.get_all_prompts();
    assert_eq!(prompts.len(), 0);
}

#[test]
fn test_nft_metadata() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    // Verify NFT metadata
    assert_eq!(client.name(), String::from_str(&env, "PromptHash"));
    assert_eq!(client.symbol(), String::from_str(&env, "PHASH"));
}

#[test]
fn test_token_uri() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let token_id = create_test_prompt(&env, &client, &creator, "Prompt 1", 1000);

    // Get token URI
    let uri = client.token_uri(&(token_id as u32));

    // Should return base URI + token ID
    // Base URI is "https://api.example.com/v1/"
    // Just verify we got a URI back (Soroban String doesn't have to_string)
    assert_eq!(uri, String::from_str(&env, "https://api.example.com/v1/0"));
}

#[test]
fn test_concurrent_listings() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let creator1 = Address::generate(&env);
    let creator2 = Address::generate(&env);
    let creator3 = Address::generate(&env);

    // Create multiple prompts from different creators
    let token_id_1 = create_test_prompt(&env, &client, &creator1, "Prompt 1", 1000);
    let token_id_2 = create_test_prompt(&env, &client, &creator2, "Prompt 2", 2000);
    let token_id_3 = create_test_prompt(&env, &client, &creator3, "Prompt 3", 3000);

    // List all for sale
    client.list_prompt_for_sale(&creator1, &token_id_1, &1500);
    client.list_prompt_for_sale(&creator2, &token_id_2, &2500);
    client.list_prompt_for_sale(&creator3, &token_id_3, &3500);

    // Verify all are listed
    let prompts = client.get_all_prompts();
    assert_eq!(prompts.len(), 3);

    for i in 0..3 {
        let prompt = prompts.get(i).unwrap();
        assert_eq!(prompt.for_sale, true);
    }
}

#[test]
fn test_fee_calculation_precision() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Set fee to 2.5% (250 basis points)
    client.set_fee_percentage(&250);

    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    xlm_client.mint(&buyer, &100000);

    // Price that doesn't divide evenly
    let price = 12345_u128;
    let token_id = create_test_prompt(&env, &client, &seller, "Prompt 1", price);
    client.list_prompt_for_sale(&seller, &token_id, &price);

    // Approvals
    xlm_client.approve(&buyer, &context.contract, &100000, &1000);
    client.approve(&seller, &context.contract, &(token_id as u32), &1000);

    let initial_seller_balance = xlm_client.balance(&seller);
    let initial_fee_wallet_balance = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &token_id);

    // Calculate expected amounts
    let fee_amount = price * 250 / 10000; // 308 (rounded down)
    let seller_amount = price - fee_amount; // 12037

    assert_eq!(
        xlm_client.balance(&seller),
        initial_seller_balance + seller_amount as i128
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        initial_fee_wallet_balance + fee_amount as i128
    );
}

#[test]
#[should_panic(expected = "Prompt not found")]
fn test_list_nonexistent_prompt() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let seller = Address::generate(&env);

    // Try to list a prompt that doesn't exist
    client.list_prompt_for_sale(&seller, &999, &5000);
}

#[test]
#[should_panic] // Will panic with Error(Contract, #200) from owner_of call
fn test_buy_nonexistent_prompt() {
    let env: Env = Default::default();
    let context = prompthash(&env);
    let client = PromptClient::new(&env, &context.contract);

    let buyer = Address::generate(&env);

    // Try to buy a prompt that doesn't exist
    // This will panic when trying to get the owner of a non-existent NFT
    client.buy_prompt(&buyer, &999);
}
