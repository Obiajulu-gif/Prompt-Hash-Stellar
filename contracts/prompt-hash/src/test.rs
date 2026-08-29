#![cfg(test)]

extern crate std;

use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::mock_asset::FungibleTokenContract;
use crate::types::{DisputeReason, Error, ListingConfig, PromptSaleStatus, Split};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Bytes, BytesN, Env, String, Vec,
};
use std::format;

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

fn setup_env() -> (
    Env,
    Address,
    Address,
    Address,
    Address,
    Address,
    PromptHashContractClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let fee_wallet = Address::generate(&env);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let token_contract = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register(
        PromptHashContract,
        (admin.clone(), fee_wallet.clone(), token_contract.clone()),
    );
    let client = PromptHashContractClient::new(&env, &contract_id);

    (
        env,
        admin,
        fee_wallet,
        creator,
        buyer,
        token_contract,
        client,
    )
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Convenience helper: creates a prompt with no expiry and no splits.
fn create_prompt(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    title: &str,
    price_stroops: i128,
    asset: &Address,
) -> u64 {
    client.create_prompt(
        creator,
        &String::from_str(env, "https://example.com/image.png"),
        &String::from_str(env, title),
        &String::from_str(env, "Software Development"),
        &String::from_str(env, "preview"),
        &String::from_str(env, "encrypted"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped-key"),
        &hash(env, 7),
        &ListingConfig {
            price: price_stroops,
            asset: asset.clone(),
            expires_at: 0,
            splits: Vec::new(env),
            tags: Vec::new(env),
            max_supply: 0,
        },
    )
}

fn create_prompt_with_supply(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    max_supply: u32,
    price: i128,
) -> u64 {
    let asset = {
        let admin = Address::generate(env);
        env.register_stellar_asset_contract_v2(admin).address()
    };
    client.create_prompt(
        creator,
        &String::from_str(env, "https://example.com/image.png"),
        &String::from_str(env, "Supply Prompt"),
        &String::from_str(env, "Software Development"),
        &String::from_str(env, "preview"),
        &String::from_str(env, "encrypted"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped-key"),
        &hash(env, 8),
        &ListingConfig {
            price,
            asset,
            expires_at: 0,
            splits: Vec::new(env),
            tags: Vec::new(env),
            max_supply: max_supply as u64,
        },
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

fn create_prompt_with_splits(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    title: &str,
    price_stroops: i128,
    asset: &Address,
    splits: Vec<Split>,
) -> u64 {
    client.create_prompt(
        creator,
        &String::from_str(env, "https://example.com/prompt.png"),
        &String::from_str(env, title),
        &String::from_str(env, "Software Development"),
        &String::from_str(env, "Generate a production-ready implementation plan."),
        &String::from_str(env, "ciphertext"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped-key"),
        &hash(env, 17),
        &ListingConfig {
            price: price_stroops,
            asset: asset.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(env),
            max_supply: 0,
        },
    )
}

#[test]
fn test_create_prompt_stores_encrypted_fields() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Secure Prompt",
        10_000_000,
        &context.xlm,
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.id, prompt_id);
    assert_eq!(prompt.creator, creator);
    assert_eq!(prompt.preview_text, String::from_str(&env, "preview"));
    assert_eq!(
        prompt.encrypted_payload,
        String::from_str(&env, "encrypted")
    );
    assert_eq!(prompt.encryption_iv, String::from_str(&env, "iv"));
    assert_eq!(prompt.wrapped_key, String::from_str(&env, "wrapped-key"));
    assert_eq!(prompt.content_hash, hash(&env, 7));
    assert_eq!(prompt.status, PromptSaleStatus::Active);
    assert_eq!(prompt.sales_count, 0);
    assert_eq!(prompt.expires_at, 0);
    assert_eq!(prompt.splits.len(), 0);

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Pricing Prompt",
        5_000,
        &context.xlm,
    );

    client.set_prompt_sale_status(&creator, &prompt_id, &PromptSaleStatus::Paused);
    client.update_prompt_price(&creator, &prompt_id, &9_000);
    client.set_prompt_sale_status(&creator, &prompt_id, &PromptSaleStatus::Active);

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.price_stroops, 9_000);
    assert_eq!(prompt.status, PromptSaleStatus::Active);
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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Reusable Prompt",
        12_345,
        &context.xlm,
    );

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

    client.settle_purchase(&context.admin, &prompt_id, &buyer_one);
    client.settle_purchase(&context.admin, &prompt_id, &buyer_two);

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
fn test_fee_routing_pays_seller_and_platform_wallet_for_exact_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 25_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Fee Routed Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let buyer_start = xlm_client.balance(&buyer);
    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    let expected_fee = price * 500 / 10_000;
    let expected_seller_payout = price - expected_fee;

    assert_eq!(xlm_client.balance(&buyer), buyer_start - price);
    assert_eq!(
        xlm_client.balance(&creator),
        seller_start + expected_seller_payout
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert!(client.has_access(&buyer, &prompt_id));
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);
}

#[test]
fn test_small_price_fee_rounding_keeps_fractional_fee_with_seller() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 19;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Tiny Rounded Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    assert_eq!(price * 500 / 10_000, 0);
    assert_eq!(xlm_client.balance(&creator), seller_start + price);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_seller_payout_split_rounding_uses_integer_stroops() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 101;

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 333,
    });

    let prompt_id = create_prompt_with_splits(
        &env,
        &client,
        &creator,
        "Rounded Split Prompt",
        price,
        &context.xlm,
        splits,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let co_creator_start = xlm_client.balance(&co_creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    let expected_fee = price * 500 / 10_000;
    let expected_split = price * 333 / 10_000;
    let expected_seller_payout = price - expected_fee - expected_split;

    assert_eq!(expected_fee, 5);
    assert_eq!(expected_split, 3);
    assert_eq!(
        xlm_client.balance(&creator),
        seller_start + expected_seller_payout
    );
    assert_eq!(
        xlm_client.balance(&co_creator),
        co_creator_start + expected_split
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
}

#[test]
fn test_failed_purchase_does_not_grant_access_or_route_partial_payouts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Failed Purchase Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let buyer_start = xlm_client.balance(&buyer);
    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

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

    assert_eq!(xlm_client.balance(&buyer), buyer_start);
    assert_eq!(xlm_client.balance(&creator), seller_start);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start);
    assert!(!client.has_access(&buyer, &prompt_id));
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 0);
}

// ---------- Platform fee governance tests ----------

#[test]
fn test_admin_can_update_platform_fee_within_bounds() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // admin sets platform fee to 300 BPS (3%)
    client.update_platform_fee(&context.admin, &300u32);
    assert_eq!(client.get_platform_fee(), 300u32);
}

#[test]
fn test_unauthorized_cannot_update_platform_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);
    let res = client.try_update_platform_fee(&stranger, &200u32);
    match res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized, got {:?}", other),
    }
}

#[test]
fn test_admin_cannot_exceed_max_platform_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Try to set above MAX_PLATFORM_FEE (1_000 BPS). Expect FeeExceedsMaximum.
    let res = client.try_update_platform_fee(&context.admin, &2000u32);
    match res {
        Err(Ok(Error::FeeExceedsMaximum)) => {}
        other => panic!("expected FeeExceedsMaximum, got {:?}", other),
    }
}

#[test]
fn test_update_platform_fee_emits_event() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Capture event count before
    let before = env.events().all().events().len();
    client.update_platform_fee(&context.admin, &400u32);
    let after = env.events().all().events().len();
    assert!(after > before, "expected at least one new event");
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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Access Prompt",
        8_000,
        &context.xlm,
    );

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
    let prompt_a = create_prompt(&env, &client, &creator, "Prompt A", 8_000, &context.xlm);
    create_prompt(&env, &client, &creator, "Prompt B", 9_000, &context.xlm);

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
fn test_license_owner_can_transfer_and_creator_receives_royalty() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Transferable Prompt",
        10_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &seller, &context.contract, 100_000);
    client.buy_prompt(
        &seller,
        &prompt_id,
        &None::<Address>,
        &10_000i128,
        &None::<Bytes>,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    let creator_before = xlm_client.balance(&creator);
    let seller_before = xlm_client.balance(&seller);
    let buyer_before = xlm_client.balance(&buyer);
    let resale_price = 20_000i128;

    client.transfer_license(&seller, &prompt_id, &buyer, &resale_price);

    let royalty = resale_price * 500 / 10_000;
    let seller_proceeds = resale_price - royalty;
    assert_eq!(xlm_client.balance(&creator), creator_before + royalty);
    assert_eq!(xlm_client.balance(&seller), seller_before + seller_proceeds);
    assert_eq!(xlm_client.balance(&buyer), buyer_before - resale_price);
    assert!(!client.has_access(&seller, &prompt_id));
    assert!(client.has_access(&buyer, &prompt_id));
    assert_eq!(client.get_prompts_by_buyer(&seller).len(), 0);
    assert_eq!(client.get_prompts_by_buyer(&buyer).len(), 1);
}

#[test]
fn test_non_owner_cannot_transfer_license() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let owner = Address::generate(&env);
    let stranger = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Protected Transfer Prompt",
        10_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &owner, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(
        &owner,
        &prompt_id,
        &None::<Address>,
        &10_000i128,
        &None::<Bytes>,
    );

    let result = client.try_transfer_license(&stranger, &prompt_id, &buyer, &20_000i128);
    match result {
        Err(Ok(Error::LicenseNotFound)) => {}
        other => panic!(
            "expected LicenseNotFound for non-owner transfer, got {:?}",
            other
        ),
    }
    assert!(client.has_access(&owner, &prompt_id));
    assert!(!client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_transfer_license_rejects_zero_price_and_self_transfer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Invalid Transfer Prompt",
        10_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &owner, &context.contract, 100_000);
    client.buy_prompt(
        &owner,
        &prompt_id,
        &None::<Address>,
        &10_000i128,
        &None::<Bytes>,
    );

    let zero_price = client.try_transfer_license(&owner, &prompt_id, &buyer, &0i128);
    match zero_price {
        Err(Ok(Error::InvalidPaymentAmount)) => {}
        other => panic!(
            "expected InvalidPaymentAmount for zero resale, got {:?}",
            other
        ),
    }

    let self_transfer = client.try_transfer_license(&owner, &prompt_id, &owner, &20_000i128);
    match self_transfer {
        Err(Ok(Error::InvalidLicenseTransfer)) => {}
        other => panic!(
            "expected InvalidLicenseTransfer for self transfer, got {:?}",
            other
        ),
    }
}

#[test]
fn test_duplicate_purchase_returns_typed_error() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "One License", 4_000, &context.xlm);

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

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.sales_count, 1);
}

#[test]
fn test_creator_cannot_buy_own_prompt() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Creator Lockout",
        4_000,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Paused Prompt",
        4_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.set_prompt_sale_status(&creator, &prompt_id, &PromptSaleStatus::Paused);

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Zero Fee Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    assert_eq!(xlm_client.balance(&creator), seller_start + price);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start);
}

#[test]
fn test_multiple_buyers_until_supply_exhausted() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer1 = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let buyer3 = Address::generate(&env);
    let price = 10_000;

    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Max Fee Prompt",
        price,
        &context.xlm,
    );

    // Set max supply to 2
    client.set_prompt_max_supply(&creator, &prompt_id, &2);

    fund_buyer(&xlm_client, &buyer1, &context.contract, price);
    fund_buyer(&xlm_client, &buyer2, &context.contract, price);
    fund_buyer(&xlm_client, &buyer3, &context.contract, price);

    // Two buyers can purchase
    client.buy_prompt(
        &buyer1,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    client.buy_prompt(
        &buyer2,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );

    // Third buyer cannot
    let result = client.try_buy_prompt(
        &buyer3,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    assert_eq!(result, Err(Ok(Error::MaxSupplyReached)));
}

#[test]
fn test_buy_prompt_with_max_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Set fee to the unified ceiling (MAX_PLATFORM_FEE = 1,000 BPS = 10%).
    // Prior to #566 this test exercised 10,000 BPS (100%) via
    // `set_fee_percentage`, which was only possible because that entrypoint
    // enforced a looser bound than `update_platform_fee` — see
    // `test_set_fee_percentage_cannot_exceed_platform_fee_ceiling` below for
    // proof that gap is now closed.
    client.set_fee_percentage(&1_000);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Max Fee Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    assert_eq!(
        xlm_client.balance(&creator),
        seller_start + price - price / 10
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + price / 10
    );
}

#[test]
fn test_set_fee_percentage_cannot_exceed_platform_fee_ceiling() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Before #566, `set_fee_percentage` accepted anything up to MAX_BPS
    // (10,000 = 100%), bypassing `update_platform_fee`'s tighter
    // MAX_PLATFORM_FEE ceiling since both wrote the same storage key. Both
    // entrypoints now delegate to the same bounded internal path.
    let res = client.try_set_fee_percentage(&10_000u32);
    match res {
        Err(Ok(Error::FeeExceedsMaximum)) => {}
        other => panic!("expected FeeExceedsMaximum, got {:?}", other),
    }

    let res = client.try_update_platform_fee(&context.admin, &10_000u32);
    match res {
        Err(Ok(Error::FeeExceedsMaximum)) => {}
        other => panic!("expected FeeExceedsMaximum, got {:?}", other),
    }
}

#[test]
fn test_set_fee_percentage_and_update_platform_fee_emit_same_event_shape() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    client.set_fee_percentage(&600u32);
    assert_eq!(client.get_fee_percentage(), 600u32);
    assert_eq!(client.get_platform_fee(), 600u32);

    client.update_platform_fee(&context.admin, &700u32);
    assert_eq!(client.get_fee_percentage(), 700u32);
    assert_eq!(client.get_platform_fee(), 700u32);
}

#[test]
fn test_migrate_platform_fee_bound_clamps_legacy_value() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Simulate a legacy deployment where `set_fee_percentage` had already
    // stored a value above the now-unified MAX_PLATFORM_FEE ceiling before
    // this fix shipped. `set_fee_percentage` itself now rejects it, so this
    // models the pre-upgrade stored state directly.
    env.as_contract(&context.contract, || {
        crate::storage::InstanceStorage::set_fee_percentage(&env, &5_000u32);
    });
    assert_eq!(client.get_fee_percentage(), 5_000u32);

    client.migrate_platform_fee_bound(&context.admin);
    assert_eq!(client.get_fee_percentage(), 1_000u32);

    // Idempotent: calling again once already within bound is a no-op.
    client.migrate_platform_fee_bound(&context.admin);
    assert_eq!(client.get_fee_percentage(), 1_000u32);
}

#[test]
fn test_unauthorized_seller_actions_fail() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Protected Prompt",
        5_000,
        &context.xlm,
    );

    // Try to update status as stranger
    let status_res =
        client.try_set_prompt_sale_status(&stranger, &prompt_id, &PromptSaleStatus::Paused);
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
fn test_massive_price_does_not_overflow() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Test with a very large price that might cause overflow in fee calculation
    let massive_price = i128::MAX / 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Massive Price Prompt",
        massive_price,
        &context.xlm,
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

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    let fee_bps = 500i128;
    let expected_fee = massive_price * fee_bps / 10_000;
    let expected_seller = massive_price - expected_fee;

    assert_eq!(xlm_client.balance(&creator), expected_seller);
    assert_eq!(xlm_client.balance(&context.fee_wallet), expected_fee);
}

#[test]
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
        &ListingConfig {
            price: 10_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );
    match create_res {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for create_prompt, got {:?}",
            other
        ),
    }

    client.set_pause_status(&false);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Readable Prompt",
        10_000,
        &context.xlm,
    );
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

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000;
    });

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Lease Prompt",
        10_000,
        &context.xlm,
    );
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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Referral Prompt",
        price,
        &context.xlm,
    );

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

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Self Referral Prompt",
        price,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Creator Referral Prompt",
        price,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "No Referral Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

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
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 0,
        },
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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Pausable Prompt",
        price,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Price Update Prompt",
        5_000,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Read Only Prompt",
        5_000,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Unpause Prompt",
        price,
        &context.xlm,
    );

    client.set_pause_status(&true);
    client.set_pause_status(&false);
    assert!(!client.is_paused());

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    assert!(client.has_access(&buyer, &prompt_id));
}

// ─── Issue #28: Emergency Pause – additional coverage ─────────────────────────

/// Verifies that set_pause_status is restricted to the owner. The #[only_owner]
/// macro enforces this at the auth level; here we confirm the happy path works
/// and that extend_listing is also blocked while paused.
#[test]
fn test_extend_listing_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Pause Extend Prompt",
        5_000,
        &context.xlm,
    );

    client.set_pause_status(&true);

    let result = client.try_extend_listing(&creator, &prompt_id, &2_000u64);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for extend_listing while paused, got {:?}",
            other
        ),
    }
}

#[test]
fn test_bulk_purchase_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Bulk Pause", 1_000, &context.xlm);

    client.set_pause_status(&true);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_id);
    let mut amounts = Vec::new(&env);
    amounts.push_back(1_000i128);

    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for buy_prompts_bulk while paused, got {:?}",
            other
        ),
    }
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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Tippable Prompt",
        price,
        &context.xlm,
    );

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

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Underpay Prompt",
        price,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Exact Pay Prompt",
        price,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Voucher Prompt",
        price,
        &context.xlm,
    );

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

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Single Use Voucher",
        price,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Invalid Voucher Prompt",
        price,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Voucher Auth Prompt",
        5_000,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Remove Voucher Prompt",
        price,
        &context.xlm,
    );

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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Voucher+Referral Prompt",
        price,
        &context.xlm,
    );

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

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

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

// ─── Issue #47: Multi-Currency Pricing ──────────────────────────────────────────

#[test]
fn test_buy_prompt_with_non_xlm_asset() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Register a second token (e.g., USDC)
    let usdc = env.register(FungibleTokenContract, (context.admin.clone(),));
    let usdc_client = token::StellarAssetClient::new(&env, &usdc);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000_000; // 5 USDC (6 decimals)
    let prompt_id = create_prompt(&env, &client, &creator, "USDC Prompt", price, &usdc);

    // Fund buyer with USDC
    usdc_client.mint(&buyer, &price);
    usdc_client.approve(&buyer, &context.contract, &price, &1_000);

    let creator_start = usdc_client.balance(&creator);
    let fee_start = usdc_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    let expected_fee = price * 500 / 10_000;
    let expected_creator = price - expected_fee;

    assert_eq!(
        usdc_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        usdc_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_create_and_buy_different_assets() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Register a second token
    let usdc = env.register(FungibleTokenContract, (context.admin.clone(),));
    let usdc_client = token::StellarAssetClient::new(&env, &usdc);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create one prompt priced in XLM, another in USDC
    let xlm_price: i128 = 10_000;
    let usdc_price: i128 = 2_000_000;
    let prompt_xlm = create_prompt(
        &env,
        &client,
        &creator,
        "XLM Prompt",
        xlm_price,
        &context.xlm,
    );
    let prompt_usdc = create_prompt(&env, &client, &creator, "USDC Prompt", usdc_price, &usdc);

    // Fund buyer with both tokens
    fund_buyer(&xlm_client, &buyer, &context.contract, xlm_price);
    usdc_client.mint(&buyer, &usdc_price);
    usdc_client.approve(&buyer, &context.contract, &usdc_price, &1_000);

    // Buy the XLM prompt - XLM balances should change, USDC should not
    let creator_xlm_before = xlm_client.balance(&creator);
    let creator_usdc_before = usdc_client.balance(&creator);

    client.buy_prompt(
        &buyer,
        &prompt_xlm,
        &None::<Address>,
        &xlm_price,
        &None::<Bytes>,
    );

    client.settle_purchase(&context.admin, &prompt_xlm, &buyer);

    let xlm_fee = xlm_price * 500 / 10_000;
    assert_eq!(
        xlm_client.balance(&creator),
        creator_xlm_before + xlm_price - xlm_fee
    );
    assert_eq!(usdc_client.balance(&creator), creator_usdc_before);

    // Buy the USDC prompt - USDC balances should change
    let creator_usdc_before = usdc_client.balance(&creator);
    client.buy_prompt(
        &buyer,
        &prompt_usdc,
        &None::<Address>,
        &usdc_price,
        &None::<Bytes>,
    );

    client.settle_purchase(&context.admin, &prompt_usdc, &buyer);

    let usdc_fee = usdc_price * 500 / 10_000;
    assert_eq!(
        usdc_client.balance(&creator),
        creator_usdc_before + usdc_price - usdc_fee
    );

    assert!(client.has_access(&buyer, &prompt_xlm));
    assert!(client.has_access(&buyer, &prompt_usdc));
}

#[test]
fn test_lease_prompt_with_non_xlm_asset() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000;
    });

    // Register a second token
    let usdc = env.register(FungibleTokenContract, (context.admin.clone(),));
    let usdc_client = token::StellarAssetClient::new(&env, &usdc);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000_000;
    let prompt_id = create_prompt(&env, &client, &creator, "USDC Lease Prompt", price, &usdc);

    // Lease price = 40% of base price
    let lease_price = price * 4_000 / 10_000;
    usdc_client.mint(&buyer, &lease_price);
    usdc_client.approve(&buyer, &context.contract, &lease_price, &1_000);

    let creator_start = usdc_client.balance(&creator);

    client.lease_prompt(&buyer, &prompt_id, &600);

    let expected_fee = lease_price * 500 / 10_000;
    let expected_seller = lease_price - expected_fee;
    assert_eq!(
        usdc_client.balance(&creator),
        creator_start + expected_seller
    );
    assert!(client.has_access(&buyer, &prompt_id));

    // Verify lease expires
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_700;
    });
    assert!(!client.has_access(&buyer, &prompt_id));
}

// ─── Issue #49: Time-Bound Listing Expiry ────────────────────────────────────

#[test]
fn test_create_prompt_with_expiry_stores_expires_at() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let expires_at: u64 = 10_000;

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Expiring Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 2),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.expires_at, expires_at);
}

#[test]
fn test_expired_listing_excluded_from_get_all_prompts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);

    // Create one prompt that expires at t=2000 and one that never expires
    let _expiring = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Expiring"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 3),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 2_000,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );
    let persistent = create_prompt(&env, &client, &creator, "Persistent", 5_000, &context.xlm);

    // Both visible before expiry
    assert_eq!(client.get_all_prompts().len(), 2);

    // Advance time past the first prompt's expiry
    env.ledger().with_mut(|l| l.timestamp = 3_000);

    let visible = client.get_all_prompts();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible.get(0).unwrap().id, persistent);
}

#[test]
fn test_buy_expired_listing_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Short-lived Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 4),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 2_000,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, 10_000);

    // Purchase before expiry succeeds
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &5_000i128,
        &None::<Bytes>,
    );
    assert!(client.has_access(&buyer, &prompt_id));

    // After expiry a new buyer is rejected
    env.ledger().with_mut(|l| l.timestamp = 3_000);
    let buyer2 = Address::generate(&env);
    fund_buyer(&xlm_client, &buyer2, &context.contract, 10_000);

    let result = client.try_buy_prompt(
        &buyer2,
        &prompt_id,
        &None::<Address>,
        &5_000i128,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::ListingExpired)) => {}
        other => panic!("expected ListingExpired, got {:?}", other),
    }
}

#[test]
fn test_extend_listing_pushes_expiry_and_allows_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Extend Me"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 5),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 2_000, // expires at t=2000
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    // Advance past original expiry
    env.ledger().with_mut(|l| l.timestamp = 2_500);

    // Extend to t=5000
    client.extend_listing(&creator, &prompt_id, &5_000u64);
    assert_eq!(client.get_prompt(&prompt_id).expires_at, 5_000);

    // Purchase now succeeds
    fund_buyer(&xlm_client, &buyer, &context.contract, 10_000);
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &5_000i128,
        &None::<Bytes>,
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_only_creator_can_extend_listing() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Auth Extend", 5_000, &context.xlm);

    let result = client.try_extend_listing(&stranger, &prompt_id, &9_000u64);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for stranger extend_listing, got {:?}",
            other
        ),
    }
}

// ─── Issue #50: Seller Revenue Sharing (Splits) ───────────────────────────────

#[test]
fn test_create_prompt_with_splits_stores_split_data() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 2_000, // 20%
    });

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Split Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 6),
        &ListingConfig {
            price: 10_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.splits.len(), 1);
    assert_eq!(prompt.splits.get(0).unwrap().bps, 2_000);
}

#[test]
fn test_buy_prompt_with_splits_distributes_correctly() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;

    // Platform fee = 500 BPS (5%), split = 2000 BPS (20%)
    // creator receives 10_000 - 500 - 2_000 = 7_500 (75%)
    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 2_000,
    });

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Split Buy Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 8),
        &ListingConfig {
            price,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let co_creator_start = xlm_client.balance(&co_creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    let expected_fee = price * 500 / 10_000; // 500
    let expected_split = price * 2_000 / 10_000; // 2_000
    let expected_creator = price - expected_fee - expected_split; // 7_500

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&co_creator),
        co_creator_start + expected_split
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_splits_exceeding_max_bps_minus_fee_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);

    // Platform fee = 500 BPS; split = 9_600 BPS → total = 10_100 > MAX_BPS
    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co1.clone(),
        bps: 9_600,
    });

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Bad Splits"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 9),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );
    match result {
        Err(Ok(Error::InvalidSplits)) => {}
        other => panic!(
            "expected InvalidSplits for over-allocated splits, got {:?}",
            other
        ),
    }
}

#[test]
fn test_multiple_splits_distribute_all_recipients() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let co2 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;

    // fee=500, co1=1000, co2=1500 → total=3000, creator gets 7000
    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co1.clone(),
        bps: 1_000,
    });
    splits.push_back(Split {
        recipient: co2.clone(),
        bps: 1_500,
    });

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Multi Split"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 10),
        &ListingConfig {
            price,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let co1_start = xlm_client.balance(&co1);
    let co2_start = xlm_client.balance(&co2);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + price * (10_000 - 500 - 1_000 - 1_500) / 10_000
    );
    assert_eq!(xlm_client.balance(&co1), co1_start + price * 1_000 / 10_000);
    assert_eq!(xlm_client.balance(&co2), co2_start + price * 1_500 / 10_000);
}

// ─── Issue #51: Bulk Purchase ─────────────────────────────────────────────────

#[test]
fn test_buy_prompts_bulk_purchases_all_and_grants_access() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price_a: i128 = 5_000;
    let price_b: i128 = 8_000;

    let prompt_a = create_prompt(&env, &client, &creator, "Bulk A", price_a, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Bulk B", price_b, &context.xlm);

    let total = price_a + price_b;
    fund_buyer(&xlm_client, &buyer, &context.contract, total);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);
    ids.push_back(prompt_b);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price_a);
    amounts.push_back(price_b);

    client.buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);

    client.settle_purchase(&context.admin, &prompt_a, &buyer);
    client.settle_purchase(&context.admin, &prompt_b, &buyer);

    assert!(client.has_access(&buyer, &prompt_a));
    assert!(client.has_access(&buyer, &prompt_b));

    let fee_bps = 500i128;
    let expected_creator =
        (price_a - price_a * fee_bps / 10_000) + (price_b - price_b * fee_bps / 10_000);
    let expected_fee = price_a * fee_bps / 10_000 + price_b * fee_bps / 10_000;
    assert_eq!(xlm_client.balance(&creator), expected_creator);
    assert_eq!(xlm_client.balance(&context.fee_wallet), expected_fee);
}

#[test]
fn test_buy_prompts_bulk_atomicity_one_failure_reverts_all() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;
    let prompt_a = create_prompt(&env, &client, &creator, "Bulk Ok", price, &context.xlm);
    // prompt 999_999 does not exist

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);
    ids.push_back(999_999u64); // non-existent

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);
    amounts.push_back(price);

    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);
    match result {
        Err(Ok(Error::PromptNotFound)) => {}
        other => panic!(
            "expected PromptNotFound for bulk with bad ID, got {:?}",
            other
        ),
    }

    // First prompt must not have been purchased (whole tx reverted)
    assert!(!client.has_access(&buyer, &prompt_a));
}

#[test]
fn test_buy_prompts_bulk_mismatched_lengths_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_a = create_prompt(&env, &client, &creator, "Mismatch", 5_000, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);

    let amounts: Vec<i128> = Vec::new(&env); // empty — mismatch

    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);
    match result {
        Err(Ok(Error::InvalidPrice)) => {}
        other => panic!(
            "expected InvalidPrice for mismatched bulk lengths, got {:?}",
            other
        ),
    }
}

#[test]
fn test_buy_prompts_bulk_with_referrer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500); // 5%

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);

    let price: i128 = 10_000;
    let prompt_a = create_prompt(&env, &client, &creator, "Bulk Ref A", price, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Bulk Ref B", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price * 2);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);
    ids.push_back(prompt_b);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);
    amounts.push_back(price);

    let referrer_start = xlm_client.balance(&referrer);
    client.buy_prompts_bulk(&buyer, &ids, &amounts, &Some(referrer.clone()));

    client.settle_purchase(&context.admin, &prompt_a, &buyer);
    client.settle_purchase(&context.admin, &prompt_b, &buyer);

    // referral = 10_000 * 500 / 10_000 = 500 per prompt × 2
    let expected_referral = price * 500 / 10_000 * 2;
    assert_eq!(
        xlm_client.balance(&referrer),
        referrer_start + expected_referral
    );
    assert!(client.has_access(&buyer, &prompt_a));
    assert!(client.has_access(&buyer, &prompt_b));
}

// ─── Issue #438: Bulk purchase bounds and duplicate-id rejection ────────────

#[test]
fn test_buy_prompts_bulk_rejects_batch_over_max_size() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 1_000;

    // MAX_BULK_PURCHASE_SIZE is 20 — build a batch of 21 distinct, otherwise-valid ids.
    let mut ids = Vec::new(&env);
    let mut amounts = Vec::new(&env);
    for i in 0..21 {
        let title = if i % 2 == 0 {
            "Over Max A"
        } else {
            "Over Max B"
        };
        let prompt_id = create_prompt(&env, &client, &creator, title, price, &context.xlm);
        ids.push_back(prompt_id);
        amounts.push_back(price);
    }
    fund_buyer(&xlm_client, &buyer, &context.contract, price * 21);

    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);
    match result {
        Err(Ok(Error::BulkPurchaseTooLarge)) => {}
        other => panic!(
            "expected BulkPurchaseTooLarge for a 21-item batch, got {:?}",
            other
        ),
    }
}

#[test]
fn test_buy_prompts_bulk_allows_exactly_max_size() {
    let env: Env = Default::default();
    // A 20-prompt bulk purchase legitimately exceeds the default simulated
    // mainnet footprint/resource limits; this only relaxes the local test
    // harness limit, not the contract's own MAX_BULK_PURCHASE_SIZE bound
    // under test.
    env.cost_estimate().disable_resource_limits();
    env.cost_estimate().budget().reset_unlimited();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 1_000;

    // Exactly MAX_BULK_PURCHASE_SIZE (20) distinct ids must be accepted.
    let mut ids = Vec::new(&env);
    let mut amounts = Vec::new(&env);
    for i in 0..20 {
        let title = if i % 2 == 0 { "At Max A" } else { "At Max B" };
        let prompt_id = create_prompt(&env, &client, &creator, title, price, &context.xlm);
        ids.push_back(prompt_id);
        amounts.push_back(price);
    }
    fund_buyer(&xlm_client, &buyer, &context.contract, price * 20);

    client.buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);

    for i in 0..ids.len() {
        assert!(client.has_access(&buyer, &ids.get(i).unwrap()));
    }
}

#[test]
fn test_buy_prompts_bulk_rejects_duplicate_prompt_ids() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000;
    let prompt_a = create_prompt(&env, &client, &creator, "Dup Target", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price * 2);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);
    ids.push_back(prompt_a); // duplicate

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);
    amounts.push_back(price);

    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);
    match result {
        Err(Ok(Error::DuplicatePromptId)) => {}
        other => panic!(
            "expected DuplicatePromptId for a repeated id, got {:?}",
            other
        ),
    }

    // No partial purchase should have gone through.
    assert!(!client.has_access(&buyer, &prompt_a));
}

// ─── Issue #438: Dry-run validation and per-item error surfacing ──────────────

#[test]
fn test_validate_bulk_purchase_all_valid_returns_all_true() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;
    let prompt_a = create_prompt(&env, &client, &creator, "Valid A", price, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Valid B", price, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);
    ids.push_back(prompt_b);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);
    amounts.push_back(price);

    // No auth required, read-only check
    let validity = client.validate_bulk_purchase(&buyer, &ids, &amounts);

    assert_eq!(validity.len(), 2);
    assert!(validity.get(0).unwrap()); // prompt_a is valid
    assert!(validity.get(1).unwrap()); // prompt_b is valid
}

#[test]
fn test_validate_bulk_purchase_marks_invalid_items() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let _xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;
    let prompt_valid = create_prompt(&env, &client, &creator, "Valid", price, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_valid);
    ids.push_back(999_999u64); // Does not exist

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);
    amounts.push_back(price);

    let validity = client.validate_bulk_purchase(&buyer, &ids, &amounts);

    assert_eq!(validity.len(), 2);
    assert!(validity.get(0).unwrap()); // Valid prompt
    assert!(!validity.get(1).unwrap()); // Non-existent prompt
}

#[test]
fn test_validate_bulk_purchase_detects_insufficient_payment() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;
    let prompt = create_prompt(&env, &client, &creator, "Expensive", price, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price - 1); // Insufficient

    let validity = client.validate_bulk_purchase(&buyer, &ids, &amounts);

    assert_eq!(validity.len(), 1);
    assert!(!validity.get(0).unwrap()); // Insufficient payment
}

#[test]
fn test_validate_bulk_purchase_detects_already_purchased() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;
    let prompt = create_prompt(&env, &client, &creator, "AlreadyOwned", price, &context.xlm);

    // Buy once
    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt, &None::<Address>, &price, &None::<Bytes>);

    // Try to validate a second purchase of the same prompt
    let mut ids = Vec::new(&env);
    ids.push_back(prompt);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);

    let validity = client.validate_bulk_purchase(&buyer, &ids, &amounts);

    assert_eq!(validity.len(), 1);
    assert!(!validity.get(0).unwrap()); // Already purchased
}

#[test]
fn test_validate_bulk_purchase_detects_inactive_prompt() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;
    let prompt = create_prompt(
        &env,
        &client,
        &creator,
        "Soon Inactive",
        price,
        &context.xlm,
    );

    // Set it inactive
    client.set_prompt_sale_status(&creator, &prompt, &PromptSaleStatus::Paused);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);

    let validity = client.validate_bulk_purchase(&buyer, &ids, &amounts);

    assert_eq!(validity.len(), 1);
    assert!(!validity.get(0).unwrap()); // Inactive
}

#[test]
fn test_validate_bulk_purchase_no_auth_required() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;
    let prompt = create_prompt(&env, &client, &creator, "Public", price, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);

    // No auth required — this should not panic or error
    let validity = client.validate_bulk_purchase(&buyer, &ids, &amounts);
    assert_eq!(validity.len(), 1);
}

#[test]
fn test_atomicity_one_failure_mid_batch_reverts_prior_purchases() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;

    let prompt_1 = create_prompt(&env, &client, &creator, "Valid 1", price, &context.xlm);
    let prompt_2 = create_prompt(&env, &client, &creator, "Valid 2", price, &context.xlm);
    let prompt_3 = create_prompt(&env, &client, &creator, "Valid 3", price, &context.xlm);

    // Make prompt_2 inactive mid-batch
    client.set_prompt_sale_status(&creator, &prompt_2, &PromptSaleStatus::Paused);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_1);
    ids.push_back(prompt_2);
    ids.push_back(prompt_3);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);
    amounts.push_back(price);
    amounts.push_back(price);

    // Fund enough for all 3
    fund_buyer(&xlm_client, &buyer, &context.contract, price * 3);

    // Purchase should fail atomically
    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);
    assert!(result.is_err());

    // Prompt 1 should NOT be purchased (atomic rollback)
    assert!(!client.has_access(&buyer, &prompt_1));
    assert_eq!(client.get_prompt(&prompt_1).sales_count, 0);

    // Prompt 2 should NOT be purchased
    assert!(!client.has_access(&buyer, &prompt_2));
    assert_eq!(client.get_prompt(&prompt_2).sales_count, 0);
}

#[test]
fn test_atomicity_boundary_exactly_max_size_succeeds() {
    let env: Env = Default::default();
    env.cost_estimate().disable_resource_limits();
    env.cost_estimate().budget().reset_unlimited();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 1_000;

    // Create exactly MAX_BULK_PURCHASE_SIZE (20) prompts
    let mut ids = Vec::new(&env);
    let mut amounts = Vec::new(&env);
    for _i in 0..20 {
        let prompt_id = create_prompt(&env, &client, &creator, "Bulk Item", price, &context.xlm);
        ids.push_back(prompt_id);
        amounts.push_back(price);
    }

    fund_buyer(&xlm_client, &buyer, &context.contract, price * 20);

    // Should succeed without error
    client.buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Address>);

    // All prompts should be accessible
    for i in 0..ids.len() {
        assert!(client.has_access(&buyer, &ids.get(i).unwrap()));
    }
}

// ─── Issue #226: Listing revision tests ─────────────────────────────────────

#[test]
fn test_buy_bundle_grants_access_to_all_prompts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let prompt_a = create_prompt(&env, &client, &creator, "Bundle A", 7_000, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Bundle B", 9_000, &context.xlm);
    let bundle_price: i128 = 12_000;
    fund_buyer(&xlm_client, &buyer, &context.contract, bundle_price);

    let mut prompt_ids = Vec::new(&env);
    prompt_ids.push_back(prompt_a);
    prompt_ids.push_back(prompt_b);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Launch Bundle"),
        &prompt_ids,
        &bundle_price,
        &context.xlm,
        &0,
    );

    client.buy_bundle(&buyer, &bundle_id, &bundle_price);

    assert!(client.has_access(&buyer, &prompt_a));
    assert!(client.has_access(&buyer, &prompt_b));

    let bundle = client.get_bundle(&bundle_id);
    assert_eq!(bundle.sales_count, 1);
    assert_eq!(client.get_prompt(&prompt_a).sales_count, 1);
    assert_eq!(client.get_prompt(&prompt_b).sales_count, 1);
}

// ─── Issue #596: Bundle price dust-loss regression ───────────────────────────
//
// When the bundle price does not divide evenly by the number of prompts,
// integer division previously silently dropped the remainder ("dust").  The
// stored original_price values must now sum exactly to the total payment.

#[test]
fn test_buy_bundle_price_allocation_no_dust_loss_three_prompts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // 10_001 stroops / 3 prompts = 3_333 each with integer division → only
    // 9_999 recorded, 2 stroops lost.  With the fix the first prompt receives
    // 3_335 (= 3_333 + 2) and the rest receive 3_333, summing to 10_001.
    let bundle_price: i128 = 10_001;
    let prompt_a = create_prompt(&env, &client, &creator, "Dust A", 3_000, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Dust B", 3_000, &context.xlm);
    let prompt_c = create_prompt(&env, &client, &creator, "Dust C", 3_000, &context.xlm);

    let mut prompt_ids = Vec::new(&env);
    prompt_ids.push_back(prompt_a);
    prompt_ids.push_back(prompt_b);
    prompt_ids.push_back(prompt_c);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Dust Bundle"),
        &prompt_ids,
        &bundle_price,
        &context.xlm,
        &0,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, bundle_price);
    client.buy_bundle(&buyer, &bundle_id, &bundle_price);

    assert!(client.has_access(&buyer, &prompt_a));
    assert!(client.has_access(&buyer, &prompt_b));
    assert!(client.has_access(&buyer, &prompt_c));

    // Read back the stored purchase records via the internal storage layer and
    // verify that the sum of original_price values equals the full payment.
    let (price_a, price_b, price_c) = env.as_contract(&context.contract, || {
        let pa = crate::storage::Storage::get_purchase(&env, prompt_a, &buyer)
            .unwrap()
            .original_price;
        let pb = crate::storage::Storage::get_purchase(&env, prompt_b, &buyer)
            .unwrap()
            .original_price;
        let pc = crate::storage::Storage::get_purchase(&env, prompt_c, &buyer)
            .unwrap()
            .original_price;
        (pa, pb, pc)
    });

    // The sum must be lossless — no stroops dust dropped.
    assert_eq!(
        price_a + price_b + price_c,
        bundle_price,
        "sum of stored original_price values must equal total payment (no dust loss)"
    );

    // The remainder (10_001 % 3 = 2) goes to the first prompt; the rest get
    // the base share (10_001 / 3 = 3_333).
    let base = bundle_price / 3;
    let rem = bundle_price % 3;
    assert_eq!(price_a, base + rem, "first prompt absorbs the remainder");
    assert_eq!(price_b, base, "second prompt gets base share");
    assert_eq!(price_c, base, "third prompt gets base share");
}

#[test]
fn test_buy_bundle_price_allocation_evenly_divisible_unchanged() {
    // Regression guard: bundles whose price divides evenly must not be
    // affected — behaviour is identical to before the fix.
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // 12_000 / 2 = 6_000 exactly — no remainder.
    let bundle_price: i128 = 12_000;
    let prompt_a = create_prompt(&env, &client, &creator, "Even A", 5_000, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Even B", 7_000, &context.xlm);

    let mut prompt_ids = Vec::new(&env);
    prompt_ids.push_back(prompt_a);
    prompt_ids.push_back(prompt_b);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Even Bundle"),
        &prompt_ids,
        &bundle_price,
        &context.xlm,
        &0,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, bundle_price);
    client.buy_bundle(&buyer, &bundle_id, &bundle_price);

    let (price_a, price_b) = env.as_contract(&context.contract, || {
        let pa = crate::storage::Storage::get_purchase(&env, prompt_a, &buyer)
            .unwrap()
            .original_price;
        let pb = crate::storage::Storage::get_purchase(&env, prompt_b, &buyer)
            .unwrap()
            .original_price;
        (pa, pb)
    });

    assert_eq!(price_a + price_b, bundle_price, "evenly-split prices must sum to bundle price");
    assert_eq!(price_a, 6_000, "first prompt gets equal share");
    assert_eq!(price_b, 6_000, "second prompt gets equal share");
}

#[test]
fn test_access_pass_grants_time_bound_catalog_access() {
    let env: Env = Default::default();
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000;
    });
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Catalog A", 8_000, &context.xlm);
    let pass_price: i128 = 15_000;
    fund_buyer(&xlm_client, &buyer, &context.contract, pass_price);

    let pass_id = client.create_access_pass(
        &creator,
        &String::from_str(&env, "30 Day Catalog"),
        &2_000,
        &pass_price,
        &context.xlm,
        &0u32,
    );

    client.buy_access_pass(&buyer, &pass_id, &pass_price);
    assert!(client.has_access(&buyer, &prompt_id));

    let future_prompt = create_prompt(&env, &client, &creator, "Catalog B", 9_000, &context.xlm);
    assert!(client.has_access(&buyer, &future_prompt));

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 3_001;
    });
    assert!(!client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_revise_listing_increments_revision_and_snapshots_old_metadata() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Original Title",
        1_000,
        &context.xlm,
    );

    // Revision starts at 0
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.revision, 0);

    let new_revision = client.revise_listing(
        &creator,
        &prompt_id,
        &String::from_str(&env, "Updated Title"),
        &String::from_str(&env, "Updated Category"),
        &String::from_str(&env, "Updated preview text for the prompt."),
        &String::from_str(&env, "https://example.com/new-image.png"),
        &2_000_i128,
    );
    assert_eq!(new_revision, 1);

    // Live listing reflects updates
    let updated = client.get_prompt(&prompt_id);
    assert_eq!(updated.revision, 1);
    assert_eq!(updated.price_stroops, 2_000);

    // Revision 0 snapshot preserves original metadata
    let snapshot = client.get_listing_revision(&prompt_id, &0);
    assert_eq!(snapshot.revision, 0);
    assert_eq!(snapshot.price_stroops, 1_000);
    assert_eq!(snapshot.prompt_id, prompt_id);
}

#[test]
fn test_revise_listing_multiple_times_each_revision_preserved() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "V0 Title", 100, &context.xlm);

    client.revise_listing(
        &creator,
        &prompt_id,
        &String::from_str(&env, "V1 Title"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "Preview v1"),
        &String::from_str(&env, "https://example.com/img1.png"),
        &200_i128,
    );

    client.revise_listing(
        &creator,
        &prompt_id,
        &String::from_str(&env, "V2 Title"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "Preview v2"),
        &String::from_str(&env, "https://example.com/img2.png"),
        &300_i128,
    );

    assert_eq!(client.get_prompt(&prompt_id).revision, 2);
    assert_eq!(
        client.get_listing_revision(&prompt_id, &0).price_stroops,
        100
    );
    assert_eq!(
        client.get_listing_revision(&prompt_id, &1).price_stroops,
        200
    );
}

#[test]
fn test_revise_listing_unauthorized_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let other = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "My Prompt", 500, &context.xlm);

    let result = client.try_revise_listing(
        &other,
        &prompt_id,
        &String::from_str(&env, "Hijacked Title"),
        &String::from_str(&env, "Cat"),
        &String::from_str(&env, "Preview"),
        &String::from_str(&env, "https://example.com/img.png"),
        &100_i128,
    );
    assert_eq!(result, Err(Ok(crate::types::Error::Unauthorized)));
}

#[test]
fn test_revise_listing_buyer_retains_access_after_revision() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000;

    let prompt_id = create_prompt(&env, &client, &creator, "My Prompt", price, &context.xlm);
    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None, &price, &None);

    // Revise after purchase — buyer must still have access
    client.revise_listing(
        &creator,
        &prompt_id,
        &String::from_str(&env, "New Title After Sale"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "New Preview"),
        &String::from_str(&env, "https://example.com/new.png"),
        &9_999_i128,
    );

    assert!(client.has_access(&buyer, &prompt_id));
}

// ─── Issue #217: Collaborator Split Management ──────────────────────────────

#[test]
fn test_update_splits_replaces_existing_splits() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let co2 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;

    let mut initial_splits = Vec::<Split>::new(&env);
    initial_splits.push_back(Split {
        recipient: co1.clone(),
        bps: 1_000,
    });

    let prompt_id = create_prompt_with_splits(
        &env,
        &client,
        &creator,
        "Updatable Splits",
        price,
        &context.xlm,
        initial_splits,
    );
    assert_eq!(client.get_prompt(&prompt_id).splits.len(), 1);

    let mut new_splits = Vec::<Split>::new(&env);
    new_splits.push_back(Split {
        recipient: co1.clone(),
        bps: 500,
    });
    new_splits.push_back(Split {
        recipient: co2.clone(),
        bps: 1_500,
    });
    client.update_splits(&creator, &prompt_id, &new_splits);

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.splits.len(), 2);
    assert_eq!(prompt.splits.get(0).unwrap().bps, 500);
    assert_eq!(prompt.splits.get(1).unwrap().bps, 1_500);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    let co1_start = xlm_client.balance(&co1);
    let co2_start = xlm_client.balance(&co2);
    let creator_start = xlm_client.balance(&creator);

    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    let expected_fee = price * 500 / 10_000;
    let expected_co1 = price * 500 / 10_000;
    let expected_co2 = price * 1_500 / 10_000;
    let expected_creator = price - expected_fee - expected_co1 - expected_co2;

    assert_eq!(xlm_client.balance(&co1), co1_start + expected_co1);
    assert_eq!(xlm_client.balance(&co2), co2_start + expected_co2);
    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
}

#[test]
fn test_update_splits_clears_all_splits() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);

    let mut initial_splits = Vec::<Split>::new(&env);
    initial_splits.push_back(Split {
        recipient: co1.clone(),
        bps: 1_000,
    });

    let prompt_id = create_prompt_with_splits(
        &env,
        &client,
        &creator,
        "Clear Splits",
        5_000,
        &context.xlm,
        initial_splits,
    );

    let empty_splits = Vec::<Split>::new(&env);
    client.update_splits(&creator, &prompt_id, &empty_splits);
    assert_eq!(client.get_prompt(&prompt_id).splits.len(), 0);
}

#[test]
fn test_update_splits_rejects_unauthorized_caller() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Auth Splits", 5_000, &context.xlm);

    let splits = Vec::<Split>::new(&env);
    let result = client.try_update_splits(&stranger, &prompt_id, &splits);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for stranger update_splits, got {:?}",
            other
        ),
    }
}

#[test]
fn test_update_splits_rejects_invalid_total_bps() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Bad Splits", 5_000, &context.xlm);

    let mut bad_splits = Vec::<Split>::new(&env);
    bad_splits.push_back(Split {
        recipient: co1.clone(),
        bps: 9_600,
    });

    let result = client.try_update_splits(&creator, &prompt_id, &bad_splits);
    match result {
        Err(Ok(Error::InvalidSplits)) => {}
        other => panic!(
            "expected InvalidSplits for over-allocated update, got {:?}",
            other
        ),
    }
}

#[test]
fn test_update_splits_rejects_duplicate_recipients() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Dup Splits", 5_000, &context.xlm);

    let mut dup_splits = Vec::<Split>::new(&env);
    dup_splits.push_back(Split {
        recipient: co1.clone(),
        bps: 500,
    });
    dup_splits.push_back(Split {
        recipient: co1.clone(),
        bps: 500,
    });

    let result = client.try_update_splits(&creator, &prompt_id, &dup_splits);
    match result {
        Err(Ok(Error::DuplicateSplitRecipient)) => {}
        other => panic!("expected DuplicateSplitRecipient, got {:?}", other),
    }
}

#[test]
fn test_create_prompt_rejects_duplicate_split_recipients() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);

    let mut dup_splits = Vec::<Split>::new(&env);
    dup_splits.push_back(Split {
        recipient: co1.clone(),
        bps: 500,
    });
    dup_splits.push_back(Split {
        recipient: co1.clone(),
        bps: 500,
    });

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Dup Create Splits"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview text here"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 30),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: dup_splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );
    match result {
        Err(Ok(Error::DuplicateSplitRecipient)) => {}
        other => panic!(
            "expected DuplicateSplitRecipient on create, got {:?}",
            other
        ),
    }
}

#[test]
fn test_update_splits_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Pause Splits", 5_000, &context.xlm);

    client.set_pause_status(&true);
    let result = client.try_update_splits(&creator, &prompt_id, &Vec::new(&env));
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for update_splits, got {:?}",
            other
        ),
    }
}

#[test]
fn test_create_prompt_tags_and_category_filters() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let mut tags = Vec::new(&env);
    tags.push_back(String::from_str(&env, "testing"));
    tags.push_back(String::from_str(&env, "rust"));

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/prompt.png"),
        &String::from_str(&env, "Tagged Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "Generate tests."),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 91),
        &ListingConfig {
            price: 1_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
            tags: Vec::from_array(
                &env,
                [
                    String::from_str(&env, "testing"),
                    String::from_str(&env, "rust"),
                ],
            ),
            max_supply: 0,
        },
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.tags.len(), 2);
    assert_eq!(
        prompt.tags.get(0).unwrap(),
        String::from_str(&env, "testing")
    );

    let by_category =
        client.get_prompts_by_category(&String::from_str(&env, "Software Development"));
    assert_eq!(by_category.len(), 1);
    assert_eq!(by_category.get(0).unwrap().id, prompt_id);

    let by_tag = client.get_prompts_by_tag(&String::from_str(&env, "rust"));
    assert_eq!(by_tag.len(), 1);
    assert_eq!(by_tag.get(0).unwrap().id, prompt_id);
}

#[test]
fn test_buyer_can_open_and_admin_can_resolve_refund_dispute() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Refundable", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // Funds are now held in the contract escrow (issue #454), so no
    // separate mint is needed — the contract already has the balance.

    client.open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::FailedIntegrityVerification,
    );
    let open = client.get_dispute(&prompt_id, &buyer);
    assert_eq!(open.status, crate::types::DisputeStatus::Open);

    let buyer_before = xlm_client.balance(&buyer);
    client.resolve_dispute(&context.admin, &prompt_id, &buyer, &true);
    let resolved = client.get_dispute(&prompt_id, &buyer);
    assert_eq!(resolved.status, crate::types::DisputeStatus::Refunded);
    assert_eq!(xlm_client.balance(&buyer), buyer_before + price);
    assert!(!client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_invalid_dispute_requires_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "No Purchase", 10_000, &context.xlm);

    let res = client.try_open_dispute(
        &stranger,
        &prompt_id,
        &crate::types::DisputeReason::MissingMetadata,
    );
    match res {
        Err(Ok(Error::LicenseNotFound)) => {}
        other => panic!("expected LicenseNotFound, got {:?}", other),
    }
}

#[test]
fn test_resolved_dispute_cannot_be_resolved_twice() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Resolved", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    client.open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::InvalidEncryptedPayload,
    );
    client.resolve_dispute(&context.admin, &prompt_id, &buyer, &false);

    let res = client.try_resolve_dispute(&context.admin, &prompt_id, &buyer, &false);
    match res {
        Err(Ok(Error::DisputeResolved)) => {}
        other => panic!("expected DisputeResolved, got {:?}", other),
    }
}

// ─── Issue #293: Additional edge-case tests ──────────────────────────────────

#[test]
fn test_max_supply_enforced_on_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer1 = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let price = 5_000;

    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Limited Supply",
        price,
        &context.xlm,
    );

    // Set max supply to 1
    client.set_prompt_max_supply(&creator, &prompt_id, &1);

    // First purchase succeeds
    fund_buyer(&xlm_client, &buyer1, &context.contract, price);
    client.buy_prompt(
        &buyer1,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );

    // Second purchase fails — max supply reached
    fund_buyer(&xlm_client, &buyer2, &context.contract, price);
    let res = client.try_buy_prompt(
        &buyer2,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    match res {
        Err(Ok(Error::MaxSupplyReached)) => {}
        other => panic!("expected MaxSupplyReached, got {:?}", other),
    }
}

#[test]
fn test_max_supply_zero_means_unlimited() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let price = 5_000;

    let prompt_id = create_prompt(&env, &client, &creator, "Unlimited", price, &context.xlm);

    // Default max_supply is 0 (unlimited) — multiple purchases should succeed
    for _ in 0..5 {
        let buyer = Address::generate(&env);
        fund_buyer(&xlm_client, &buyer, &context.contract, price);
        client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    }

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.sales_count, 5);
}

#[test]
fn test_dispute_rejection_does_not_refund() {
    // ─── Issue #106: Fixed Supply (Limited Edition) Prompts ──────────────────────
}
#[test]
fn test_create_prompt_with_max_supply_stores_correctly() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Limited Edition"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "Only 3 copies available."),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 80),
        &ListingConfig {
            price: 10_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 3,
        },
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.max_supply, 3);
    assert_eq!(prompt.sales_count, 0);
}

#[test]
fn test_limited_edition_exhausts_after_max_supply_sales() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Dispute Reject",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    let balance_before = xlm_client.balance(&buyer);

    client.open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::InvalidEncryptedPayload,
    );

    // Admin rejects the dispute (refund = false)
    client.resolve_dispute(&context.admin, &prompt_id, &buyer, &false);

    // Buyer should NOT receive a refund
    let balance_after = xlm_client.balance(&buyer);
    assert_eq!(balance_before, balance_after);

    // Buyer should still have access
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_only_owner_can_set_pause_status() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let _non_admin = Address::generate(&env); // <-- Renamed from _non_admin

    // Tell the environment to expect an authorization block from our non_admin address
    env.set_auths(&[]);

    let res = client.try_set_pause_status(&true); // <-- Removed .as_invoker()
    match res {
        Err(Err(_)) => {} // Accurately catches the native Soroban auth abort
        other => panic!("expected native auth abort, got {:?}", other),
    }
}

#[test]
fn test_only_owner_can_set_fee_wallet() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let _non_admin = Address::generate(&env);
    let new_wallet = Address::generate(&env);
    env.set_auths(&[]);

    let res = client.try_set_fee_wallet(&new_wallet);
    match res {
        Err(Err(_)) => {}
        other => panic!("expected native auth abort, got {:?}", other),
    }
}

#[test]
fn test_lease_price_is_40_percent_of_listing() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Limited Edition"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "Only 2 copies available."),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 81),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 2,
        },
    );

    let buyer1 = Address::generate(&env);
    let buyer2 = Address::generate(&env);
    let buyer3 = Address::generate(&env);

    fund_buyer(&xlm_client, &buyer1, &context.contract, 10_000);
    fund_buyer(&xlm_client, &buyer2, &context.contract, 10_000);
    fund_buyer(&xlm_client, &buyer3, &context.contract, 10_000);

    // First purchase succeeds
    client.buy_prompt(
        &buyer1,
        &prompt_id,
        &None::<Address>,
        &5_000i128,
        &None::<Bytes>,
    );
    assert!(client.has_access(&buyer1, &prompt_id));
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);

    // Second purchase succeeds (exhausts supply)
    client.buy_prompt(
        &buyer2,
        &prompt_id,
        &None::<Address>,
        &5_000i128,
        &None::<Bytes>,
    );
    assert!(client.has_access(&buyer2, &prompt_id));
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 2);

    // Third purchase fails with MaxSupplyReached
    let result = client.try_buy_prompt(
        &buyer3,
        &prompt_id,
        &None::<Address>,
        &5_000i128,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::MaxSupplyReached)) => {}
        other => panic!("expected MaxSupplyReached, got {:?}", other),
    }
    assert!(!client.has_access(&buyer3, &prompt_id));
}

#[test]
fn test_unlimited_supply_allows_many_purchases() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 100_000;

    let prompt_id = create_prompt(&env, &client, &creator, "Lease Price", price, &context.xlm);

    // Fund buyer with enough for lease (40% of price = 40_000)
    let lease_price = price * 4_000 / 10_000; // 40_000
    fund_buyer(&xlm_client, &buyer, &context.contract, lease_price);

    let creator_balance_before = xlm_client.balance(&creator);

    client.lease_prompt(&buyer, &prompt_id, &3600); // 1 hour lease

    // Creator should receive lease_price minus fee
    let fee_pct = client.get_fee_percentage() as i128;
    let expected_creator_amount = lease_price - (lease_price * fee_pct / 10_000);
    let creator_balance_after = xlm_client.balance(&creator);
    assert_eq!(
        creator_balance_after - creator_balance_before,
        expected_creator_amount
    );
}

#[test]
fn test_get_prompts_by_ids_returns_matching_prompts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let id0 = create_prompt(&env, &client, &creator, "Prompt A", 1_000, &context.xlm);
    let id1 = create_prompt(&env, &client, &creator, "Prompt B", 2_000, &context.xlm);
    let id2 = create_prompt(&env, &client, &creator, "Prompt C", 3_000, &context.xlm);

    // Fetch all three
    let ids = Vec::from_array(&env, [id0, id1, id2]);
    let prompts = client.get_prompts_by_ids(&ids);
    assert_eq!(prompts.len(), 3);
    assert_eq!(
        prompts.get(0).unwrap().title,
        String::from_str(&env, "Prompt A")
    );
    assert_eq!(
        prompts.get(1).unwrap().title,
        String::from_str(&env, "Prompt B")
    );
    assert_eq!(
        prompts.get(2).unwrap().title,
        String::from_str(&env, "Prompt C")
    );
}

#[test]
fn test_get_prompts_by_ids_skips_nonexistent() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let id0 = create_prompt(&env, &client, &creator, "Exists", 1_000, &context.xlm);

    // Include a non-existent ID (999)
    let ids = Vec::from_array(&env, [id0, 999]);
    let prompts = client.get_prompts_by_ids(&ids);
    assert_eq!(prompts.len(), 1);
    assert_eq!(
        prompts.get(0).unwrap().title,
        String::from_str(&env, "Exists")
    );
}

#[test]
fn test_get_prompts_by_ids_empty_list() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let ids = Vec::new(&env);
    let prompts = client.get_prompts_by_ids(&ids);
    assert_eq!(prompts.len(), 0);

    let creator = Address::generate(&env);
    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Unlimited Edition"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "No supply limit."),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 82),
        &ListingConfig {
            price: 1_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    for _i in 0..5 {
        let buyer = Address::generate(&env);
        fund_buyer(&xlm_client, &buyer, &context.contract, 10_000);
        client.buy_prompt(
            &buyer,
            &prompt_id,
            &None::<Address>,
            &1_000i128,
            &None::<Bytes>,
        );
        assert!(client.has_access(&buyer, &prompt_id));
    }

    assert_eq!(client.get_prompt(&prompt_id).sales_count, 5);
}

// ─── Task 1: Invariant hardening tests ──────────────────────────────────────

#[test]
fn test_non_owner_cannot_set_fee_percentage() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let _non_admin = Address::generate(&env);
    env.set_auths(&[]);
    let res = client.try_set_fee_percentage(&300u32);
    match res {
        Err(Err(_)) => {}
        other => panic!("expected native auth abort, got {:?}", other),
    }
}

#[test]
fn test_non_owner_cannot_set_referral_percentage() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let _non_admin = Address::generate(&env);
    env.set_auths(&[]);
    let res = client.try_set_referral_percentage(&300u32);
    match res {
        Err(Err(_)) => {}
        other => panic!("expected native auth abort, got {:?}", other),
    }
}

#[test]
fn test_zero_price_prompt_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Zero Price Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 99),
        &ListingConfig {
            price: 0,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );
    match result {
        Err(Ok(Error::InvalidPrice)) => {}
        other => panic!(
            "expected InvalidPrice for zero price prompt, got {:?}",
            other
        ),
    }
}

#[test]
fn test_update_price_to_zero_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let _xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Pricey Prompt",
        5_000,
        &context.xlm,
    );

    let result = client.try_update_prompt_price(&creator, &prompt_id, &0i128);
    match result {
        Err(Ok(Error::InvalidPrice)) => {}
        other => panic!(
            "expected InvalidPrice for zero price update, got {:?}",
            other
        ),
    }
}

#[test]
fn test_buyer_index_records_purchases_deterministically() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let prompt_a = create_prompt(&env, &client, &creator, "Prompt A", 5_000, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Prompt B", 6_000, &context.xlm);
    let prompt_c = create_prompt(&env, &client, &creator, "Prompt C", 7_000, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);

    // Buy prompts in a specific order
    client.buy_prompt(
        &buyer,
        &prompt_a,
        &None::<Address>,
        &5_000i128,
        &None::<Bytes>,
    );
    client.buy_prompt(
        &buyer,
        &prompt_c,
        &None::<Address>,
        &7_000i128,
        &None::<Bytes>,
    );
    client.buy_prompt(
        &buyer,
        &prompt_b,
        &None::<Address>,
        &6_000i128,
        &None::<Bytes>,
    );

    // Buyer index must reflect deterministic insertion order
    let buyer_prompts = client.get_prompts_by_buyer(&buyer);
    assert_eq!(buyer_prompts.len(), 3);
    assert_eq!(buyer_prompts.get(0).unwrap().id, prompt_a);
    assert_eq!(buyer_prompts.get(1).unwrap().id, prompt_c);
    assert_eq!(buyer_prompts.get(2).unwrap().id, prompt_b);
}

#[test]
fn test_inactive_prompt_purchase_fails_with_correct_error() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Inactive Test",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    // Deactivate the listing
    client.set_prompt_sale_status(&creator, &prompt_id, &PromptSaleStatus::Paused);

    let result =
        client.try_buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    match result {
        Err(Ok(Error::PromptInactive)) => {}
        other => panic!(
            "expected PromptInactive for deactivated listing, got {:?}",
            other
        ),
    }

    // Reactivate and purchase should succeed
    client.set_prompt_sale_status(&creator, &prompt_id, &PromptSaleStatus::Active);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    assert!(client.has_access(&buyer, &prompt_id));
}

// ────────────────────────────────────────────────────────────────────────────
// Payout Invariant Tests (#421): Verify fee + referral + splits + creator = payment
// ────────────────────────────────────────────────────────────────────────────

#[test]
fn test_payout_invariant_fee_plus_creator_equals_payment() {
    // Invariant: fee + creator_amount = payment (no referral, no splits)
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let payment: i128 = 100_000;

    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Invariant Test",
        payment,
        &context.xlm,
    );
    fund_buyer(&xlm_client, &buyer, &context.contract, payment);

    let creator_balance_before = xlm_client.balance(&creator);
    let fee_wallet_balance_before = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &payment,
        &None::<Bytes>,
    );

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    // Verify: fee_amount + creator_amount = payment
    let fee_bps = 500; // DEFAULT_FEE_BPS
    let expected_fee = payment * fee_bps / 10_000;
    let expected_creator = payment - expected_fee;

    let creator_received = xlm_client.balance(&creator) - creator_balance_before;
    let fee_received = xlm_client.balance(&context.fee_wallet) - fee_wallet_balance_before;

    assert_eq!(creator_received, expected_creator);
    assert_eq!(fee_received, expected_fee);
    assert_eq!(creator_received + fee_received, payment);
}

#[test]
fn test_payout_invariant_with_referral() {
    // Invariant: fee + referral + creator_amount = payment (with referral)
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let payment: i128 = 100_000;

    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Referral Test",
        payment,
        &context.xlm,
    );
    fund_buyer(&xlm_client, &buyer, &context.contract, payment);

    let creator_balance_before = xlm_client.balance(&creator);
    let fee_wallet_balance_before = xlm_client.balance(&context.fee_wallet);
    let referrer_balance_before = xlm_client.balance(&referrer);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referrer.clone()),
        &payment,
        &None::<Bytes>,
    );

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    // Verify: fee + referral + creator_amount = payment
    let fee_bps = 500;
    let referral_bps = 100; // DEFAULT_REFERRAL_PERCENTAGE (assumed)
    let expected_fee = payment * fee_bps / 10_000;
    let expected_referral = payment * referral_bps / 10_000;
    let expected_creator = payment - expected_fee - expected_referral;

    let creator_received = xlm_client.balance(&creator) - creator_balance_before;
    let fee_received = xlm_client.balance(&context.fee_wallet) - fee_wallet_balance_before;
    let referrer_received = xlm_client.balance(&referrer) - referrer_balance_before;

    assert_eq!(creator_received + fee_received + referrer_received, payment);
    assert_eq!(expected_fee + expected_referral + expected_creator, payment);
}

#[test]
fn test_payout_invariant_with_splits() {
    // Invariant: fee + splits + creator_amount = payment (with splits, no referral)
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let split_recipient_1 = Address::generate(&env);
    let split_recipient_2 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let payment: i128 = 100_000;

    let mut splits = Vec::new(&env);
    splits.push_back(Split {
        recipient: split_recipient_1.clone(),
        bps: 1000, // 10%
    });
    splits.push_back(Split {
        recipient: split_recipient_2.clone(),
        bps: 500, // 5%
    });

    let prompt_id = create_prompt_with_splits(
        &env,
        &client,
        &creator,
        "Splits Test",
        payment,
        &context.xlm,
        splits,
    );
    fund_buyer(&xlm_client, &buyer, &context.contract, payment);

    let creator_balance_before = xlm_client.balance(&creator);
    let fee_wallet_balance_before = xlm_client.balance(&context.fee_wallet);
    let split_1_balance_before = xlm_client.balance(&split_recipient_1);
    let split_2_balance_before = xlm_client.balance(&split_recipient_2);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &payment,
        &None::<Bytes>,
    );

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    // Verify: fee + split_1 + split_2 + creator_amount = payment
    let fee_bps = 500;
    let expected_fee = payment * fee_bps / 10_000;
    let expected_split_1 = payment * 1000 / 10_000;
    let expected_split_2 = payment * 500 / 10_000;
    let expected_creator = payment - expected_fee - expected_split_1 - expected_split_2;

    let creator_received = xlm_client.balance(&creator) - creator_balance_before;
    let fee_received = xlm_client.balance(&context.fee_wallet) - fee_wallet_balance_before;
    let split_1_received = xlm_client.balance(&split_recipient_1) - split_1_balance_before;
    let split_2_received = xlm_client.balance(&split_recipient_2) - split_2_balance_before;

    assert_eq!(
        creator_received + fee_received + split_1_received + split_2_received,
        payment
    );
    assert_eq!(
        expected_creator + expected_fee + expected_split_1 + expected_split_2,
        payment
    );
}

#[test]
fn test_payout_invariant_with_tip() {
    // Invariant: tip = payment - price (when payment > price)
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 50_000;
    let payment: i128 = 75_000; // tip = 25_000
    let tip = payment - price;

    let prompt_id = create_prompt(&env, &client, &creator, "Tip Test", price, &context.xlm);
    fund_buyer(&xlm_client, &buyer, &context.contract, payment);

    let creator_balance_before = xlm_client.balance(&creator);
    let fee_wallet_balance_before = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &payment,
        &None::<Bytes>,
    );

    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    // Verify tip is correctly calculated
    let fee_bps = 500;
    let expected_fee = payment * fee_bps / 10_000;
    let expected_creator = payment - expected_fee;

    let creator_received = xlm_client.balance(&creator) - creator_balance_before;
    let fee_received = xlm_client.balance(&context.fee_wallet) - fee_wallet_balance_before;

    // Creator should receive their share of the full payment (including tip)
    assert_eq!(creator_received, expected_creator);
    assert_eq!(fee_received, expected_fee);
    // Tip is part of the total payment
    assert_eq!(tip, payment - price);
    assert_eq!(creator_received + fee_received, payment);
}

// ─── Issue #538: Supply limits across sales, leases, bundles, passes, resale ──

#[test]
fn test_lease_respects_max_supply() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer_one = Address::generate(&env);
    let buyer_two = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Leased Once", 10_000, &context.xlm);
    client.set_prompt_max_supply(&creator, &prompt_id, &1);

    fund_buyer(&xlm_client, &buyer_one, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer_two, &context.contract, 100_000);

    client.lease_prompt(&buyer_one, &prompt_id, &600);
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);

    let res = client.try_lease_prompt(&buyer_two, &prompt_id, &600);
    match res {
        Err(Ok(Error::MaxSupplyReached)) => {}
        other => panic!(
            "expected MaxSupplyReached for capped lease, got {:?}",
            other
        ),
    }
}

#[test]
fn test_set_max_supply_below_committed_sales_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer_one = Address::generate(&env);
    let buyer_two = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Uncapped", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer_one, &context.contract, price);
    fund_buyer(&xlm_client, &buyer_two, &context.contract, price);
    client.buy_prompt(
        &buyer_one,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    client.buy_prompt(
        &buyer_two,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );

    let res = client.try_set_prompt_max_supply(&creator, &prompt_id, &1);
    match res {
        Err(Ok(Error::MaxSupplyBelowCommitted)) => {}
        other => panic!("expected MaxSupplyBelowCommitted, got {:?}", other),
    }

    // Equal to committed sales is allowed, as is resetting to unlimited.
    client.set_prompt_max_supply(&creator, &prompt_id, &2);
    client.set_prompt_max_supply(&creator, &prompt_id, &0);
}

#[test]
fn test_dispute_refund_releases_supply_for_resale() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer_one = Address::generate(&env);
    let buyer_two = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "One Unit", price, &context.xlm);
    client.set_prompt_max_supply(&creator, &prompt_id, &1);

    fund_buyer(&xlm_client, &buyer_one, &context.contract, price);
    client.buy_prompt(
        &buyer_one,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);

    // At capacity: a second buyer cannot acquire the unit.
    fund_buyer(&xlm_client, &buyer_two, &context.contract, price);
    let blocked = client.try_buy_prompt(
        &buyer_two,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    assert_eq!(blocked, Err(Ok(Error::MaxSupplyReached)));

    // Refunding the disputed purchase releases the reserved unit.
    client.open_dispute(
        &buyer_one,
        &prompt_id,
        &crate::types::DisputeReason::FailedIntegrityVerification,
    );
    client.resolve_dispute(&context.admin, &prompt_id, &buyer_one, &true);
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 0);

    // Now the second buyer can acquire the freed unit.
    client.buy_prompt(
        &buyer_two,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);
}

#[test]
fn test_transfer_license_does_not_consume_or_free_supply() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let seller = Address::generate(&env);
    let new_buyer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Resale Cap", price, &context.xlm);
    client.set_prompt_max_supply(&creator, &prompt_id, &1);

    fund_buyer(&xlm_client, &seller, &context.contract, price);
    client.buy_prompt(
        &seller,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);

    let resale_price = 3_000;
    xlm_client.mint(&new_buyer, &resale_price);
    xlm_client.approve(&new_buyer, &context.contract, &resale_price, &1_000);
    client.transfer_license(&seller, &prompt_id, &new_buyer, &resale_price);

    // Resale transfers an already-reserved unit; it neither consumes a new
    // one nor frees the original slot for a fresh buyer.
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);
    fund_buyer(&xlm_client, &stranger, &context.contract, price);
    let res = client.try_buy_prompt(
        &stranger,
        &prompt_id,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );
    assert_eq!(res, Err(Ok(Error::MaxSupplyReached)));
}

#[test]
fn test_bundle_purchase_respects_prompt_max_supply() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let early_buyer = Address::generate(&env);
    let bundle_buyer = Address::generate(&env);
    let price = 4_000;

    let capped_prompt = create_prompt(&env, &client, &creator, "Capped", price, &context.xlm);
    client.set_prompt_max_supply(&creator, &capped_prompt, &1);
    let open_prompt = create_prompt(&env, &client, &creator, "Open", price, &context.xlm);

    // Exhaust the capped prompt's only unit via a direct purchase first.
    fund_buyer(&xlm_client, &early_buyer, &context.contract, price);
    client.buy_prompt(
        &early_buyer,
        &capped_prompt,
        &None::<Address>,
        &price,
        &None::<Bytes>,
    );

    let mut prompt_ids = Vec::new(&env);
    prompt_ids.push_back(capped_prompt);
    prompt_ids.push_back(open_prompt);
    let bundle_price = 6_000;
    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Mixed Bundle"),
        &prompt_ids,
        &bundle_price,
        &context.xlm,
        &0u64,
    );

    fund_buyer(&xlm_client, &bundle_buyer, &context.contract, bundle_price);
    let res = client.try_buy_bundle(&bundle_buyer, &bundle_id, &bundle_price);
    match res {
        Err(Ok(Error::MaxSupplyReached)) => {}
        other => panic!(
            "expected MaxSupplyReached for capped prompt in bundle, got {:?}",
            other
        ),
    }
}

#[test]
fn test_access_pass_respects_own_max_supply() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer_one = Address::generate(&env);
    let buyer_two = Address::generate(&env);
    let price = 8_000;

    let pass_id = client.create_access_pass(
        &creator,
        &String::from_str(&env, "Capped Pass"),
        &1_000u64,
        &price,
        &context.xlm,
        &1u32,
    );

    fund_buyer(&xlm_client, &buyer_one, &context.contract, price);
    fund_buyer(&xlm_client, &buyer_two, &context.contract, price);

    client.buy_access_pass(&buyer_one, &pass_id, &price);
    let res = client.try_buy_access_pass(&buyer_two, &pass_id, &price);
    match res {
        Err(Ok(Error::MaxSupplyReached)) => {}
        other => panic!(
            "expected MaxSupplyReached for capped access pass, got {:?}",
            other
        ),
    }
}

// ─── Issue #539: Access pass lifecycle and renewal ────────────────────────────

#[test]
fn test_access_pass_renewal_before_expiry_extends_from_current_expiry() {
    let env: Env = Default::default();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Catalog", 1_000, &context.xlm);
    let price = 5_000;

    let pass_id = client.create_access_pass(
        &creator,
        &String::from_str(&env, "Monthly"),
        &1_000u64,
        &price,
        &context.xlm,
        &0u32,
    );
    fund_buyer(&xlm_client, &buyer, &context.contract, price * 2);

    // First purchase at t=1000 grants access through t=2000.
    client.buy_access_pass(&buyer, &pass_id, &price);

    // Renewing early (t=1500, still active) must extend from the existing
    // expiry (2000 + 1000 = 3000), not from `now` (which would only reach
    // 2500 and incorrectly shorten/overlap the remaining period) (#539).
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_500);
    client.buy_access_pass(&buyer, &pass_id, &price);

    env.ledger().with_mut(|ledger| ledger.timestamp = 2_999);
    assert!(client.has_access(&buyer, &prompt_id));
    env.ledger().with_mut(|ledger| ledger.timestamp = 3_001);
    assert!(!client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_access_pass_renewal_after_expiry_starts_from_now() {
    let env: Env = Default::default();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Catalog", 1_000, &context.xlm);
    let price = 5_000;

    let pass_id = client.create_access_pass(
        &creator,
        &String::from_str(&env, "Monthly"),
        &500u64,
        &price,
        &context.xlm,
        &0u32,
    );
    fund_buyer(&xlm_client, &buyer, &context.contract, price * 2);

    client.buy_access_pass(&buyer, &pass_id, &price); // expires at 1_500

    // Buying again after the grant has already lapsed starts a fresh period
    // from `now`, not from the stale past expiry.
    env.ledger().with_mut(|ledger| ledger.timestamp = 2_000);
    client.buy_access_pass(&buyer, &pass_id, &price); // expires at 2_500

    env.ledger().with_mut(|ledger| ledger.timestamp = 2_499);
    assert!(client.has_access(&buyer, &prompt_id));
    env.ledger().with_mut(|ledger| ledger.timestamp = 2_501);
    assert!(!client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_paused_access_pass_cannot_be_purchased_but_can_be_reactivated() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;

    let pass_id = client.create_access_pass(
        &creator,
        &String::from_str(&env, "Toggle"),
        &1_000u64,
        &price,
        &context.xlm,
        &0u32,
    );
    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    client.set_access_pass_status(&creator, &pass_id, &PromptSaleStatus::Paused);
    let res = client.try_buy_access_pass(&buyer, &pass_id, &price);
    match res {
        Err(Ok(Error::PromptInactive)) => {}
        other => panic!("expected PromptInactive for paused pass, got {:?}", other),
    }

    client.set_access_pass_status(&creator, &pass_id, &PromptSaleStatus::Active);
    client.buy_access_pass(&buyer, &pass_id, &price);
}

#[test]
fn test_retired_access_pass_cannot_be_reactivated() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let pass_id = client.create_access_pass(
        &creator,
        &String::from_str(&env, "Sunset"),
        &1_000u64,
        &5_000,
        &context.xlm,
        &0u32,
    );

    client.set_access_pass_status(&creator, &pass_id, &PromptSaleStatus::Retired);
    let res = client.try_set_access_pass_status(&creator, &pass_id, &PromptSaleStatus::Active);
    match res {
        Err(Ok(Error::InvalidStatusTransition)) => {}
        other => panic!(
            "expected InvalidStatusTransition reviving a retired pass, got {:?}",
            other
        ),
    }
}

#[test]
fn test_retiring_access_pass_does_not_revoke_existing_grant() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Catalog", 1_000, &context.xlm);
    let price = 5_000;

    let pass_id = client.create_access_pass(
        &creator,
        &String::from_str(&env, "Grandfathered"),
        &1_000u64,
        &price,
        &context.xlm,
        &0u32,
    );
    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_access_pass(&buyer, &pass_id, &price);

    // Retiring the pass definition must not silently revoke access already
    // paid for and granted (#539).
    client.set_access_pass_status(&creator, &pass_id, &PromptSaleStatus::Retired);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_update_access_pass_price_applies_to_next_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let old_price = 5_000;
    let new_price = 9_000;

    let pass_id = client.create_access_pass(
        &creator,
        &String::from_str(&env, "Repriced"),
        &1_000u64,
        &old_price,
        &context.xlm,
        &0u32,
    );
    client.update_access_pass_price(&creator, &pass_id, &new_price);

    fund_buyer(&xlm_client, &buyer, &context.contract, new_price);
    let res = client.try_buy_access_pass(&buyer, &pass_id, &old_price);
    match res {
        Err(Ok(Error::InvalidPaymentAmount)) => {}
        other => panic!(
            "expected InvalidPaymentAmount at stale price, got {:?}",
            other
        ),
    }
    client.buy_access_pass(&buyer, &pass_id, &new_price);
}

// ─── Issue #541: Purchase-relative dispute windows & permissionless settlement ─

#[test]
fn test_dispute_cannot_open_after_window_closes() {
    let env: Env = Default::default();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Windowed", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // Three days plus one second after purchase, the dispute window has closed.
    env.ledger()
        .with_mut(|ledger| ledger.timestamp = 1_000 + 3 * 24 * 60 * 60 + 1);
    let res = client.try_open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::MissingMetadata,
    );
    match res {
        Err(Ok(Error::DisputeWindowClosed)) => {}
        other => panic!("expected DisputeWindowClosed, got {:?}", other),
    }
}

#[test]
fn test_dispute_within_window_still_succeeds() {
    let env: Env = Default::default();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Windowed", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    env.ledger()
        .with_mut(|ledger| ledger.timestamp = 1_000 + 3 * 24 * 60 * 60 - 1);
    client.open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::MissingMetadata,
    );
    let dispute = client.get_dispute(&prompt_id, &buyer);
    assert_eq!(dispute.status, crate::types::DisputeStatus::Open);
}

#[test]
fn test_permissionless_settlement_blocked_before_window_elapses() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Stale", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    let res = client.try_settle_purchase(&stranger, &prompt_id, &buyer);
    match res {
        Err(Ok(Error::DisputeWindowNotElapsed)) => {}
        other => panic!("expected DisputeWindowNotElapsed, got {:?}", other),
    }
}

#[test]
fn test_permissionless_settlement_after_window_by_any_caller() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Stale", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    let creator_before = xlm_client.balance(&creator);
    env.ledger()
        .with_mut(|ledger| ledger.timestamp = 3 * 24 * 60 * 60 + 1);

    // Every escrow has a bounded path to settlement — an uninvolved third
    // party can finalize it once the dispute window has closed (#541).
    client.settle_purchase(&stranger, &prompt_id, &buyer);

    let escrow = client.get_purchase_escrow(&prompt_id, &buyer).unwrap();
    assert_eq!(escrow.status, crate::types::SettlementStatus::Settled);
    assert!(xlm_client.balance(&creator) > creator_before);
}

#[test]
fn test_settle_purchase_blocked_while_dispute_open() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Contested", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    client.open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::InvalidEncryptedPayload,
    );

    // Even the admin's fast path must go through `resolve_dispute` once a
    // dispute is open, not bypass it via settlement (#541).
    let res = client.try_settle_purchase(&context.admin, &prompt_id, &buyer);
    match res {
        Err(Ok(Error::DisputeAlreadyOpen)) => {}
        other => panic!("expected DisputeAlreadyOpen, got {:?}", other),
    }
}

#[test]
fn test_creator_can_settle_immediately_without_waiting() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Fast Path", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // The creator (privileged, like the admin) may settle right away.
    client.settle_purchase(&creator, &prompt_id, &buyer);
    let escrow = client.get_purchase_escrow(&prompt_id, &buyer).unwrap();
    assert_eq!(escrow.status, crate::types::SettlementStatus::Settled);
}

// ---------- Per-asset escrow liability tests (#570) ----------

#[test]
fn test_asset_liability_tracks_pending_on_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Liability", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.pending, price);
    assert_eq!(liability.disputed, 0);
}

#[test]
fn test_asset_liability_decrements_on_settle() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Liability", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    client.settle_purchase(&context.admin, &prompt_id, &buyer);

    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.pending, 0);
    assert_eq!(liability.disputed, 0);
}

#[test]
fn test_asset_liability_moves_to_disputed_on_dispute_open() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Liability", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    client.open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::InvalidEncryptedPayload,
    );

    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.pending, 0);
    assert_eq!(liability.disputed, price);
}

#[test]
fn test_asset_liability_moves_back_to_pending_on_dispute_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Liability", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    client.open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::InvalidEncryptedPayload,
    );
    client.resolve_dispute(&context.admin, &prompt_id, &buyer, &false);

    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.pending, price);
    assert_eq!(liability.disputed, 0);

    // The escrow is still Pending, so it can settle normally afterward.
    client.settle_purchase(&context.admin, &prompt_id, &buyer);
    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.pending, 0);
}

#[test]
fn test_asset_liability_clears_on_dispute_refunded() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Liability", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    client.open_dispute(
        &buyer,
        &prompt_id,
        &crate::types::DisputeReason::InvalidEncryptedPayload,
    );
    client.resolve_dispute(&context.admin, &prompt_id, &buyer, &true);

    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.pending, 0);
    assert_eq!(liability.disputed, 0);
}

#[test]
fn test_asset_liability_unaffected_by_lease_prompt() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Lease", price, &context.xlm);

    // Leases (like bundles and access passes) transfer payment in and pay it
    // straight back out within the same call — there's never a persisted
    // Pending escrow, so they must never touch the liability ledger.
    fund_buyer(&xlm_client, &buyer, &context.contract, price * 2);
    client.lease_prompt(&buyer, &prompt_id, &3600u64);

    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.pending, 0);
    assert_eq!(liability.disputed, 0);
}

#[test]
fn test_asset_solvency_matches_when_no_drift() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Solvency", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    let solvency = client.get_asset_solvency(&context.xlm);
    assert_eq!(solvency.tracked_liability, price);
    assert_eq!(solvency.actual_balance, price);
    assert_eq!(solvency.surplus, 0);
    assert!(!client.is_paused());
}

#[test]
fn test_check_asset_solvency_detects_drift_and_pauses() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Drift", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
    assert!(!client.is_paused());

    // Fault injection: simulate an accounting bug inflating tracked
    // liability beyond what the contract actually holds, without moving any
    // real funds. `check_asset_solvency` must detect this and fail closed.
    env.as_contract(&context.contract, || {
        crate::storage::Storage::add_pending_liability(&env, &context.xlm, price).unwrap();
    });

    let solvency = client.check_asset_solvency(&context.xlm);
    assert!(solvency.surplus < 0);
    assert!(client.is_paused());

    // Fail-closed: mutating entry points are blocked while paused, so no
    // further customer funds can move until an operator investigates and
    // explicitly unpauses.
    let res = client.try_settle_purchase(&context.admin, &prompt_id, &buyer);
    assert_eq!(res, Err(Ok(Error::ContractIsPaused)));
}

#[test]
fn test_migrate_asset_liability_is_idempotent() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 5_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Migrate", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // Simulate a pre-#570 deployment: the escrow exists, but its amount was
    // never credited to the liability ledger (the feature didn't exist yet).
    env.as_contract(&context.contract, || {
        crate::storage::Storage::remove_pending_liability(&env, &context.xlm, price).unwrap();
    });
    assert_eq!(client.get_asset_liability(&context.xlm).pending, 0);

    client.migrate_asset_liability(&context.admin, &prompt_id, &buyer);
    assert_eq!(client.get_asset_liability(&context.xlm).pending, price);

    // A duplicate call (retry, or double-invocation) must not double-count.
    client.migrate_asset_liability(&context.admin, &prompt_id, &buyer);
    assert_eq!(client.get_asset_liability(&context.xlm).pending, price);
}

#[test]
fn test_split_validation_sum_exactly_at_max_bps_minus_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 9_500,
    });

    let prompt_id = create_prompt_with_splits(
        &env,
        &client,
        &creator,
        "Max Split Prompt",
        10_000_000,
        &context.xlm,
        splits,
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.splits.len(), 1);
}

#[test]
fn test_split_validation_rejects_split_exceeding_max_bps() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 9_501,
    });

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/image.png"),
        &String::from_str(&env, "Bad Split"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "encrypted"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 1),
        &ListingConfig {
            price: 10_000_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    assert_eq!(result, Err(Ok(Error::InvalidSplits)));
}

#[test]
fn test_split_validation_rejects_zero_bps_split() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 0,
    });

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/image.png"),
        &String::from_str(&env, "Zero BPS Split"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "encrypted"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 2),
        &ListingConfig {
            price: 10_000_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    assert_eq!(result, Err(Ok(Error::InvalidSplits)));
}

#[test]
fn test_split_validation_rejects_duplicate_recipients() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 2_500,
    });
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 2_500,
    });

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/image.png"),
        &String::from_str(&env, "Duplicate Split"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "encrypted"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 3),
        &ListingConfig {
            price: 10_000_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    assert_eq!(result, Err(Ok(Error::DuplicateSplitRecipient)));
}

#[test]
fn test_split_validation_rejects_too_many_splits() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    for _i in 0..11 {
        let recipient = Address::generate(&env);
        splits.push_back(Split {
            recipient,
            bps: 500,
        });
    }

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/image.png"),
        &String::from_str(&env, "Too Many Splits"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "encrypted"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 4),
        &ListingConfig {
            price: 10_000_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
            max_supply: 0,
        },
    );

    assert_eq!(result, Err(Ok(Error::TooManySplits)));
}

#[test]
fn test_split_validation_multiple_splits_sum_within_limits() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let recipient_1 = Address::generate(&env);
    let recipient_2 = Address::generate(&env);
    let recipient_3 = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: recipient_1.clone(),
        bps: 2_000,
    });
    splits.push_back(Split {
        recipient: recipient_2.clone(),
        bps: 3_000,
    });
    splits.push_back(Split {
        recipient: recipient_3.clone(),
        bps: 4_000,
    });

    let prompt_id = create_prompt_with_splits(
        &env,
        &client,
        &creator,
        "Multiple Splits Prompt",
        10_000_000,
        &context.xlm,
        splits,
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.splits.len(), 3);
}

#[test]
fn test_split_validation_boundary_fee_plus_splits_equals_max_bps() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 9_500,
    });

    let prompt_id = create_prompt_with_splits(
        &env,
        &client,
        &creator,
        "Fee Plus Splits Boundary",
        10_000_000,
        &context.xlm,
        splits,
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.splits.len(), 1);
    assert_eq!(prompt.splits.get(0).unwrap().bps, 9_500);
}

#[test]
fn test_renew_critical_keys_batch_resumption_with_cursor() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let _xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);

    // Create more prompts than MAX_RENEWAL_BATCH_SIZE (20) to trigger batching
    let num_prompts = 35;
    let mut prompt_ids = Vec::new(&env);

    for i in 0..num_prompts {
        let prompt_id = create_prompt(
            &env,
            &client,
            &creator,
            &format!("Prompt {}", i),
            1_000,
            &context.xlm,
        );
        prompt_ids.push_back(prompt_id);
    }

    // First batch: should process up to MAX_RENEWAL_BATCH_SIZE prompts
    let (renewed_count_1, cursor_1) = client.renew_critical_keys(&None::<u64>);
    assert_eq!(
        renewed_count_1, 20,
        "First batch should process exactly MAX_RENEWAL_BATCH_SIZE"
    );
    assert!(
        cursor_1.is_some(),
        "First batch should return a cursor for resumption"
    );

    // Second batch: continue from cursor
    let (renewed_count_2, cursor_2) = client.renew_critical_keys(&cursor_1);
    assert_eq!(
        renewed_count_2, 15,
        "Second batch should process remaining prompts"
    );
    assert_eq!(
        cursor_2, None,
        "Second batch should return None cursor when all done"
    );

    // Verify total: first + second batch should equal total created
    assert_eq!(
        renewed_count_1 + renewed_count_2,
        num_prompts,
        "Total renewed should equal total prompts created"
    );
}

#[test]
fn test_renew_critical_keys_processes_each_key_exactly_once() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    // Create exactly MAX_RENEWAL_BATCH_SIZE + 5 prompts
    let num_prompts = 25;
    let mut created_ids = Vec::new(&env);

    for i in 0..num_prompts {
        let prompt_id = create_prompt(
            &env,
            &client,
            &creator,
            &format!("Unique {}", i),
            2_000,
            &context.xlm,
        );
        created_ids.push_back(prompt_id);
    }

    let mut total_renewed = 0u32;
    let mut current_cursor: Option<u64> = None;
    let mut iteration_count = 0;

    // Process all batches
    loop {
        iteration_count += 1;
        assert!(
            iteration_count <= 5,
            "Should not exceed reasonable iteration count (indicates infinite loop)"
        );

        let (renewed, next_cursor) = client.renew_critical_keys(&current_cursor);
        total_renewed += renewed;

        if next_cursor.is_none() {
            break;
        }
        current_cursor = next_cursor;
    }

    assert_eq!(
        total_renewed, num_prompts,
        "All prompts should be renewed exactly once, no skips or duplicates"
    );
}

#[test]
fn test_renew_critical_keys_with_invalid_cursor_degrades_gracefully() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    // Create a few prompts
    for i in 0..3 {
        create_prompt(
            &env,
            &client,
            &creator,
            &format!("Test {}", i),
            1_500,
            &context.xlm,
        );
    }

    // Use a cursor that doesn't correspond to any created prompt
    // (simulates a deleted key between renewal calls)
    let invalid_cursor = 99_999u64;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.renew_critical_keys(&Some(invalid_cursor))
    }));

    // Should not panic, should either skip or return gracefully
    assert!(
        result.is_ok() || result.is_err(),
        "Handling invalid cursor should not crash the contract"
    );
}

#[test]
fn test_renew_critical_keys_expiry_risk_consistency() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    // Create prompts
    for i in 0..5 {
        create_prompt(
            &env,
            &client,
            &creator,
            &format!("Risk {}", i),
            1_000,
            &context.xlm,
        );
    }

    // Run partial renewal
    let (renewed_count, _cursor) = client.renew_critical_keys(&None::<u64>);
    assert!(renewed_count > 0, "Should have renewed at least one key");

    // Get expiry risk metrics after renewal
    let risk_metrics = client.get_expiry_risk_metrics();
    assert_eq!(
        risk_metrics.len(),
        0,
        "All renewed keys should be safe from imminent expiry"
    );
}

#[test]
fn test_renew_critical_keys_handles_empty_storage() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Attempt renewal with no prompts created
    let (renewed_count, cursor) = client.renew_critical_keys(&None::<u64>);

    assert_eq!(renewed_count, 0, "No prompts, so no renewals");
    assert_eq!(cursor, None, "No cursor needed when storage is empty");
}

#[test]
fn test_get_all_prompts_paginated_empty_collection() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Query with no prompts created
    let (prompts, next_cursor) = client.get_all_prompts_paginated(&None::<String>, &50);

    assert_eq!(prompts.len(), 0, "Empty storage should return no prompts");
    assert_eq!(next_cursor, None, "No next cursor for empty collection");
}

#[test]
fn test_get_prompts_by_category_page_empty_category() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Query a category that has no prompts
    let (prompts, next_cursor) = client.get_prompts_by_category_page(
        &String::from_str(&env, "NonexistentCategory"),
        &None::<String>,
        &50,
    );

    assert_eq!(prompts.len(), 0, "Empty category should return no prompts");
    assert_eq!(
        next_cursor, None,
        "Empty category should have no next cursor"
    );
}

#[test]
fn test_get_prompts_by_tag_paginated_empty_tag() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Query a tag that has no prompts
    let (prompts, next_cursor) = client.get_prompts_by_tag_paginated(
        &String::from_str(&env, "nonexistent-tag"),
        &None::<String>,
        &50,
    );

    assert_eq!(prompts.len(), 0, "Empty tag should return no prompts");
    assert_eq!(next_cursor, None, "Empty tag should have no next cursor");
}

#[test]
fn test_get_active_prompts_paginated_empty_collection() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Query active prompts with no prompts created
    let (prompts, next_cursor) = client.get_active_prompts_paginated(&None::<String>, &50);

    assert_eq!(
        prompts.len(),
        0,
        "Empty active prompts should return nothing"
    );
    assert_eq!(
        next_cursor, None,
        "Empty active prompts should have no cursor"
    );
}

#[test]
fn test_pagination_page_size_zero_handled() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    // Create some prompts
    for i in 0..3 {
        create_prompt(
            &env,
            &client,
            &creator,
            &format!("Size {}", i),
            1_000,
            &context.xlm,
        );
    }

    // Request with page size 0
    let (prompts, _cursor) = client.get_all_prompts_paginated(&None::<String>, &0);
    assert_eq!(prompts.len(), 0, "Page size 0 should return empty results");
}

#[test]
fn test_pagination_page_size_larger_than_collection() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    // Create 3 prompts
    for i in 0..3 {
        create_prompt(
            &env,
            &client,
            &creator,
            &format!("Collection {}", i),
            1_000,
            &context.xlm,
        );
    }

    // Request with page size much larger than collection
    let (prompts, next_cursor) = client.get_all_prompts_paginated(&None::<String>, &1000);

    assert_eq!(prompts.len(), 3, "Should return all available prompts");
    assert!(next_cursor.is_some(), "Should return a valid cursor");
}

#[test]
fn test_pagination_cursor_consistency_across_entry_points() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    // Create prompts in a specific category
    let category = "TestCategory";
    for i in 0..5 {
        create_prompt_with_category(
            &env,
            &client,
            &creator,
            &format!("Prompt {}", i),
            1_000,
            &context.xlm,
            category,
        );
    }

    // Paginate through all prompts
    let (all_prompts, _) = client.get_all_prompts_paginated(&None::<String>, &100);
    // Paginate through category prompts
    let (category_prompts, _) = client.get_prompts_by_category_page(
        &String::from_str(&env, category),
        &None::<String>,
        &100,
    );

    // Both should return prompts (category subset should be at most as many as all)
    assert!(
        category_prompts.len() <= all_prompts.len(),
        "Category results should not exceed total results"
    );
    assert!(
        !category_prompts.is_empty(),
        "Should have found prompts in category"
    );
}

#[test]
fn test_pagination_with_batch_requests() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    // Create 10 prompts
    for i in 0..10 {
        create_prompt(
            &env,
            &client,
            &creator,
            &format!("Batch {}", i),
            1_000,
            &context.xlm,
        );
    }

    let mut all_paginated = Vec::new(&env);
    let mut current_cursor: Option<String> = None;

    // Paginate through 3 at a time
    loop {
        let (batch, next_cursor) = client.get_all_prompts_paginated(&current_cursor, &3);

        if batch.is_empty() {
            break;
        }

        for prompt in &batch {
            all_paginated.push_back(prompt);
        }

        if next_cursor.is_none() {
            break;
        }
        current_cursor = next_cursor;
    }

    assert_eq!(
        all_paginated.len(),
        10,
        "Batched pagination should retrieve all prompts"
    );
}

fn create_prompt_with_category(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    title: &str,
    price: i128,
    asset: &Address,
    category: &str,
) -> u64 {
    client.create_prompt(
        creator,
        &String::from_str(env, "https://example.com/image.png"),
        &String::from_str(env, title),
        &String::from_str(env, category),
        &String::from_str(env, "preview"),
        &String::from_str(env, "encrypted"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped-key"),
        &hash(env, 7),
        &ListingConfig {
            price,
            asset: asset.clone(),
            expires_at: 0,
            splits: Vec::new(env),
            tags: Vec::new(env),
            max_supply: 0,
        },
    )
}

#[test]
fn test_migrate_platform_fee_bound_non_admin_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.as_contract(&context.contract, || {
        crate::storage::InstanceStorage::set_fee_percentage(&env, &5_000u32);
    });

    let non_admin = Address::generate(&env);
    let res = client.try_migrate_platform_fee_bound(&non_admin);
    match res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for non-admin, got {:?}", other),
    }
}

#[test]
fn test_migrate_platform_fee_bound_already_within_bound() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Fee is already within the bound by default
    assert_eq!(client.get_fee_percentage(), 500);

    // Migration should be a no-op
    client.migrate_platform_fee_bound(&context.admin);
    assert_eq!(client.get_fee_percentage(), 500);
}

#[test]
fn test_migrate_asset_liability_pending_case() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 3_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Pending Migrate",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // Clear liability to simulate pre-#570 state
    env.as_contract(&context.contract, || {
        crate::storage::Storage::remove_pending_liability(&env, &context.xlm, price).unwrap();
    });

    assert_eq!(client.get_asset_liability(&context.xlm).pending, 0);

    client.migrate_asset_liability(&context.admin, &prompt_id, &buyer);

    // Verify liability was migrated
    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.pending, price);
}

#[test]
fn test_migrate_asset_liability_disputed_case() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 4_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Disputed Migrate",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // Open dispute
    client.open_dispute(&buyer, &prompt_id, &DisputeReason::InvalidEncryptedPayload);

    // Clear liability to simulate pre-#570 state
    env.as_contract(&context.contract, || {
        crate::storage::Storage::remove_disputed_liability(&env, &context.xlm, price).unwrap();
    });

    assert_eq!(client.get_asset_liability(&context.xlm).disputed, 0);

    client.migrate_asset_liability(&context.admin, &prompt_id, &buyer);

    // Verify disputed liability was migrated
    let liability = client.get_asset_liability(&context.xlm);
    assert_eq!(liability.disputed, price);
}

#[test]
fn test_migrate_asset_liability_non_admin_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Auth Check", 2_000, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, 2_000);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &2_000, &None::<Bytes>);

    let non_admin = Address::generate(&env);
    let res = client.try_migrate_asset_liability(&non_admin, &prompt_id, &buyer);
    match res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for non-admin, got {:?}", other),
    }
}

#[test]
fn test_migrate_asset_liability_with_asset_solvency() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 6_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Solvency Check",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // Clear liability to simulate pre-#570 state
    env.as_contract(&context.contract, || {
        crate::storage::Storage::remove_pending_liability(&env, &context.xlm, price).unwrap();
    });

    // Before migration: liability is zero
    let before = client.check_asset_solvency(&context.xlm);
    assert_eq!(before.tracked_liability, 0);

    // After migration: liability should match the escrow amount
    client.migrate_asset_liability(&context.admin, &prompt_id, &buyer);
    let after = client.check_asset_solvency(&context.xlm);
    assert_eq!(after.tracked_liability, price);
}

// ─── Issue #594: Comprehensive discount authorization tests ───────────────────

use crate::types::SignedDiscountAuthorization;

fn contract_id_hash(env: &Env, contract: &Address) -> BytesN<32> {
    env.crypto()
        .sha256(&contract.to_string().to_bytes())
        .to_bytes()
}

#[test]
fn test_discount_auth_happy_path() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Fund the buyer
    fund_buyer(&xlm_client, &buyer, &context.contract, 8_000);

    // Creator creates a signed discount authorization
    let network_id = env.ledger().network_id();
    let contract_id = contract_id_hash(&env, &context.contract);
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id,
        contract_id,
        discount_bps: 2000, // 20% discount
        expiry_ledger: env.ledger().sequence() + 1000,
        nonce: nonce.clone(),
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    client.add_signed_discount_auth(&creator, &authorization, &signature);

    // Buyer redeems the discount via buy_prompt_with_auth
    let discounted_price = 8_000; // 10_000 * (10_000 - 2_000) / 10_000 = 8_000
    client.buy_prompt_with_auth(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &discounted_price,
        &authorization,
        &signature,
    );

    // Verify buyer has access to the prompt
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_discount_auth_domain_mismatch_network_id() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Create authorization with wrong network_id
    let network_id = BytesN::from_array(&env, &[1u8; 32]); // Wrong network_id
    let contract_id = contract_id_hash(&env, &context.contract);
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id,
        contract_id,
        discount_bps: 2000,
        expiry_ledger: env.ledger().sequence() + 1000,
        nonce,
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    let result = client.try_add_signed_discount_auth(&creator, &authorization, &signature);

    // Should reject due to network ID mismatch
    assert!(result.is_err());
}

#[test]
fn test_discount_auth_domain_mismatch_contract_id() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Create authorization with wrong contract_id
    let network_id = env.ledger().network_id();
    let contract_id = BytesN::from_array(&env, &[2u8; 32]); // Wrong contract_id
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id,
        contract_id,
        discount_bps: 2000,
        expiry_ledger: env.ledger().sequence() + 1000,
        nonce,
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    let result = client.try_add_signed_discount_auth(&creator, &authorization, &signature);

    // Should reject due to contract ID mismatch
    assert!(result.is_err());
}

#[test]
fn test_discount_auth_expired_ledger() {
    let env: Env = Default::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Create authorization with expiry in the past
    let network_id = env.ledger().network_id();
    let contract_id = contract_id_hash(&env, &context.contract);
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id,
        contract_id,
        discount_bps: 2000,
        expiry_ledger: 50, // Already expired (current ledger is 100)
        nonce,
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    let result = client.try_add_signed_discount_auth(&creator, &authorization, &signature);

    // Should reject due to expired ledger
    assert!(result.is_err());
}

#[test]
fn test_discount_auth_nonce_replay_rejection() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Fund the buyer
    fund_buyer(&xlm_client, &buyer, &context.contract, 16_000);

    // Create and register first authorization
    let network_id = env.ledger().network_id();
    let contract_id = contract_id_hash(&env, &context.contract);
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id: network_id.clone(),
        contract_id: contract_id.clone(),
        discount_bps: 2000,
        expiry_ledger: env.ledger().sequence() + 1000,
        nonce: nonce.clone(),
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    client.add_signed_discount_auth(&creator, &authorization, &signature);

    // Use it once
    let discounted_price = 8_000;
    client.buy_prompt_with_auth(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &discounted_price,
        &authorization,
        &signature,
    );

    // Try to reuse the same authorization a second time — should fail because nonce is consumed
    let result = client.try_buy_prompt_with_auth(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &discounted_price,
        &authorization,
        &signature,
    );
    // Should reject due to nonce already consumed
    assert!(result.is_err());
}

#[test]
fn test_discount_auth_unauthorized_caller() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let unauthorized_caller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Non-creator tries to add discount auth for creator's prompt
    let network_id = env.ledger().network_id();
    let contract_id = contract_id_hash(&env, &context.contract);
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id,
        contract_id,
        discount_bps: 2000,
        expiry_ledger: env.ledger().sequence() + 1000,
        nonce,
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    let result =
        client.try_add_signed_discount_auth(&unauthorized_caller, &authorization, &signature);

    // Should reject because unauthorized_caller is not the creator
    assert!(result.is_err());
}

#[test]
fn test_discount_auth_revoke_then_redeem_fails() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Fund the buyer
    fund_buyer(&xlm_client, &buyer, &context.contract, 8_000);

    // Creator creates a signed discount authorization
    let network_id = env.ledger().network_id();
    let contract_id = contract_id_hash(&env, &context.contract);
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id,
        contract_id,
        discount_bps: 2000,
        expiry_ledger: env.ledger().sequence() + 1000,
        nonce: nonce.clone(),
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    client.add_signed_discount_auth(&creator, &authorization, &signature);

    // Creator revokes the authorization
    client.revoke_discount_auth(&creator, &prompt_id, &nonce);

    // Buyer tries to redeem revoked authorization — should fail
    let discounted_price = 8_000;
    let result = client.try_buy_prompt_with_auth(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &discounted_price,
        &authorization,
        &signature,
    );

    // Should fail because authorization was revoked
    assert!(result.is_err());
}

#[test]
fn test_discount_auth_invalid_discount_percentage() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Create authorization with discount_bps > MAX_BPS (10_000)
    let network_id = env.ledger().network_id();
    let contract_id = contract_id_hash(&env, &context.contract);
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id,
        contract_id,
        discount_bps: 15_000, // > MAX_BPS (10_000)
        expiry_ledger: env.ledger().sequence() + 1000,
        nonce,
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    let result = client.try_add_signed_discount_auth(&creator, &authorization, &signature);

    // Should reject due to invalid discount percentage
    assert!(result.is_err());
}

#[test]
fn test_discount_auth_max_bps_edge_case() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create a prompt
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);

    // Fund the buyer
    fund_buyer(&xlm_client, &buyer, &context.contract, 8_000);

    // Create authorization with discount_bps == 2000
    let network_id = env.ledger().network_id();
    let contract_id = contract_id_hash(&env, &context.contract);
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let authorization = SignedDiscountAuthorization {
        prompt_id,
        buyer: buyer.clone(),
        network_id,
        contract_id,
        discount_bps: 2_000,
        expiry_ledger: env.ledger().sequence() + 1000,
        nonce: nonce.clone(),
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);
    client.add_signed_discount_auth(&creator, &authorization, &signature);

    // Buyer redeems the discounted prompt
    let discounted_price = 8_000;
    client.buy_prompt_with_auth(
        &buyer,
        &prompt_id,
        &None::<Address>,
        &discounted_price,
        &authorization,
        &signature,
    );

    // Verify buyer has access
    assert!(client.has_access(&buyer, &prompt_id));
}

// ============================================================================
// ISSUE #651: Cursor Pagination for Creator and Buyer Ownership Indexes
// ============================================================================

#[test]
fn test_get_prompts_by_creator_paginated_empty_and_multi_page() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let other_creator = Address::generate(&env);

    // Empty list
    let (prompts, next_cursor) = client.get_prompts_by_creator_paginated(&creator, &None, &10);
    assert_eq!(prompts.len(), 0);
    assert!(next_cursor.is_none());

    // Create 7 prompts for creator and 3 for other_creator
    for i in 0..7 {
        let title = String::from_str(&env, "Creator Prompt");
        client.create_prompt(
            &creator,
            &String::from_str(&env, "https://example.com/img.png"),
            &title,
            &String::from_str(&env, "AI"),
            &String::from_str(&env, "Preview"),
            &String::from_str(&env, "Encrypted"),
            &String::from_str(&env, "iv"),
            &String::from_str(&env, "key"),
            &hash(&env, i as u8 + 1),
            &ListingConfig {
                price: 1_000,
                asset: context.xlm.clone(),
                expires_at: 0,
                splits: Vec::new(&env),
                tags: Vec::new(&env),
                max_supply: 0,
            },
        );
    }
    for i in 0..3 {
        let title = String::from_str(&env, "Other Creator Prompt");
        client.create_prompt(
            &other_creator,
            &String::from_str(&env, "https://example.com/img.png"),
            &title,
            &String::from_str(&env, "Art"),
            &String::from_str(&env, "Preview"),
            &String::from_str(&env, "Encrypted"),
            &String::from_str(&env, "iv"),
            &String::from_str(&env, "key"),
            &hash(&env, i as u8 + 10),
            &ListingConfig {
                price: 2_000,
                asset: context.xlm.clone(),
                expires_at: 0,
                splits: Vec::new(&env),
                tags: Vec::new(&env),
                max_supply: 0,
            },
        );
    }

    // Paginate creator's prompts with limit = 3
    let (page1, cursor1) = client.get_prompts_by_creator_paginated(&creator, &None, &3);
    assert_eq!(page1.len(), 3);
    assert!(cursor1.is_some());

    let (page2, cursor2) = client.get_prompts_by_creator_paginated(&creator, &cursor1, &3);
    assert_eq!(page2.len(), 3);
    assert!(cursor2.is_some());

    let (page3, cursor3) = client.get_prompts_by_creator_paginated(&creator, &cursor2, &3);
    assert_eq!(page3.len(), 1);
    assert!(cursor3.is_some());

    // Page past end
    let (page4, cursor4) = client.get_prompts_by_creator_paginated(&creator, &cursor3, &3);
    assert_eq!(page4.len(), 0);
    assert!(cursor4.is_none());
}

#[test]
fn test_get_prompts_by_buyer_paginated_multi_page() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Empty list
    let (prompts, next_cursor) = client.get_prompts_by_buyer_paginated(&buyer, &None, &10);
    assert_eq!(prompts.len(), 0);
    assert!(next_cursor.is_none());

    fund_buyer(&xlm_client, &buyer, &context.contract, 50_000);

    let mut created_ids = Vec::new(&env);
    for i in 0..5 {
        let p_id = create_prompt(&env, &client, &creator, "Prompt", 1_000, &context.xlm);
        created_ids.push_back(p_id);
        client.buy_prompt(&buyer, &p_id, &None, &1_000, &None);
    }

    // Paginate buyer entitlements with limit = 2
    let (page1, cursor1) = client.get_prompts_by_buyer_paginated(&buyer, &None, &2);
    assert_eq!(page1.len(), 2);
    assert!(cursor1.is_some());

    let (page2, cursor2) = client.get_prompts_by_buyer_paginated(&buyer, &cursor1, &2);
    assert_eq!(page2.len(), 2);
    assert!(cursor2.is_some());

    let (page3, cursor3) = client.get_prompts_by_buyer_paginated(&buyer, &cursor2, &2);
    assert_eq!(page3.len(), 1);
    assert!(cursor3.is_some());

    let (page4, cursor4) = client.get_prompts_by_buyer_paginated(&buyer, &cursor3, &2);
    assert_eq!(page4.len(), 0);
    assert!(cursor4.is_none());
}

// ============================================================================
// ISSUE #652: Catalog Secondary Index Drift Detection and Repair
// ============================================================================

#[test]
fn test_catalog_secondary_index_verification_and_repair() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Indexed Prompt", 1_000, &context.xlm);

    // Initial state: healthy indexes
    let report = client.verify_catalog_indexes(&0, &50);
    assert_eq!(report.total_prompts_scanned, 1);
    assert_eq!(report.missing_in_all, 0);
    assert_eq!(report.missing_in_active, 0);
    assert_eq!(report.missing_in_category, 0);
    assert_eq!(report.missing_in_creator, 0);

    // Fault injection: simulate drift by clearing AllPrompts and ActivePrompts
    env.as_contract(&context.contract, || {
        let empty_vec: Vec<u64> = Vec::new(&env);
        env.storage().persistent().set(&DataKey::AllPrompts, &empty_vec);
        env.storage().persistent().set(&DataKey::ActivePrompts, &empty_vec);
    });

    // Detect drift
    let drift_report = client.verify_catalog_indexes(&0, &50);
    assert_eq!(drift_report.missing_in_all, 1);
    assert_eq!(drift_report.missing_in_active, 1);

    // Dry-run repair: should report repairs without mutating
    let dry_run_summary = client.repair_catalog_indexes(&context.admin, &0, &50, &true);
    assert_eq!(dry_run_summary.repairs_applied, 2);
    assert!(dry_run_summary.is_dry_run);

    // Verify still drifting after dry run
    let post_dry_run_report = client.verify_catalog_indexes(&0, &50);
    assert_eq!(post_dry_run_report.missing_in_all, 1);

    // Live repair
    let live_summary = client.repair_catalog_indexes(&context.admin, &0, &50, &false);
    assert_eq!(live_summary.repairs_applied, 2);
    assert!(!live_summary.is_dry_run);

    // Verify clean healthy state after live repair
    let post_repair_report = client.verify_catalog_indexes(&0, &50);
    assert_eq!(post_repair_report.missing_in_all, 0);
    assert_eq!(post_repair_report.missing_in_active, 0);

    // Idempotency: repeated repair run is a no-op (0 repairs applied)
    let second_run_summary = client.repair_catalog_indexes(&context.admin, &0, &50, &false);
    assert_eq!(second_run_summary.repairs_applied, 0);
}

// ============================================================================
// ISSUE #653: Checked Accounting Invariant Enforcement
// ============================================================================

#[test]
fn test_checked_accounting_invariant_on_double_refund_and_counters() {
    let env: Env = Default::default();
    env.mock_all_auths();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let prompt_id = create_prompt(&env, &client, &creator, "Unique Prompt", 2_000, &context.xlm);
    fund_buyer(&xlm_client, &buyer, &context.contract, 10_000);

    client.buy_prompt(&buyer, &prompt_id, &None, &2_000, &None);

    let prompt_after_buy = client.get_prompt(&prompt_id);
    assert_eq!(prompt_after_buy.sales_count, 1);

    // Open dispute and refund
    client.open_dispute(&buyer, &prompt_id, &DisputeReason::FailedIntegrityVerification);
    client.resolve_dispute(&context.admin, &prompt_id, &buyer, &true);

    let prompt_after_refund = client.get_prompt(&prompt_id);
    assert_eq!(prompt_after_refund.sales_count, 0);

    // Attempting a second refund / dispute resolution on an already resolved dispute must fail
    let double_resolve_result = client.try_resolve_dispute(&context.admin, &prompt_id, &buyer, &true);
    assert!(double_resolve_result.is_err());

    // Reconcile sales counter
    let reconciled = client.reconcile_sales_counter(&context.admin, &prompt_id);
    assert_eq!(reconciled, 0);
}
