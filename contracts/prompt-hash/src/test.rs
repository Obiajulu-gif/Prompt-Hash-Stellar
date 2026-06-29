use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::mock_asset::FungibleTokenContract;
use crate::types::{Error, ListingConfig, Split};
extern crate std;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Bytes, BytesN, Env, String, Vec,
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

/// Convenience helper: creates a prompt with no expiry and no splits.
fn create_prompt(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    title: &str,
    price_stroops: i128,
    asset: &Address,
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
        &ListingConfig {
            price: price_stroops,
            asset: asset.clone(),
            expires_at: 0,
            splits: Vec::new(env),
            tags: Vec::new(&env),
            max_supply: 0,
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
        &hash(env, 17),
        &ListingConfig {
            price: price_stroops,
            asset: asset.clone(),
            expires_at: 0,
            splits,
            tags: Vec::new(&env),
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
    let before = env.events().all().len();
    client.update_platform_fee(&context.admin, &400u32);
    let after = env.events().all().len();
    assert!(after >= before + 1, "expected at least one new event");
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
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Protected Prompt",
        5_000,
        &context.xlm,
    );

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
    ids.push_back(999_999u128); // non-existent

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

    // referral = 10_000 * 500 / 10_000 = 500 per prompt × 2
    let expected_referral = price * 500 / 10_000 * 2;
    assert_eq!(
        xlm_client.balance(&referrer),
        referrer_start + expected_referral
    );
    assert!(client.has_access(&buyer, &prompt_a));
    assert!(client.has_access(&buyer, &prompt_b));
}

// ─── Issue #226: Listing revision tests ─────────────────────────────────────

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
            tags,
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
    xlm_client.mint(&context.contract, &price);

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

    let prompt_id = create_prompt(&env, &client, &creator, "Limited Supply", price, &context.xlm);

    // Set max supply to 1
    client.set_prompt_max_supply(&creator, &prompt_id, &1);

    // First purchase succeeds
    fund_buyer(&xlm_client, &buyer1, &context.contract, price);
    client.buy_prompt(&buyer1, &prompt_id, &None::<Address>, &price, &None::<Bytes>);

    // Second purchase fails — max supply reached
    fund_buyer(&xlm_client, &buyer2, &context.contract, price);
    let res = client.try_buy_prompt(&buyer2, &prompt_id, &None::<Address>, &price, &None::<Bytes>);
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

    let prompt = client.get_prompt(&prompt_id).unwrap();
    assert_eq!(prompt.sales_count, 5);
}

#[test]
fn test_dispute_rejection_does_not_refund() {
// ─── Issue #106: Fixed Supply (Limited Edition) Prompts ──────────────────────

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
    let prompt_id = create_prompt(&env, &client, &creator, "Dispute Reject", price, &context.xlm);

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
    let non_admin = Address::generate(&env);

    let res = client.try_set_pause_status(&non_admin, &true);
    match res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized, got {:?}", other),
    }
}

#[test]
fn test_only_owner_can_set_fee_wallet() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let non_admin = Address::generate(&env);
    let new_wallet = Address::generate(&env);

    let res = client.try_set_fee_wallet(&non_admin, &new_wallet);
    match res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized, got {:?}", other),
    }
}

#[test]
fn test_lease_price_is_40_percent_of_listing() {

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
    client.buy_prompt(&buyer1, &prompt_id, &None::<Address>, &5_000i128, &None::<Bytes>);
    assert!(client.has_access(&buyer1, &prompt_id));
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);

    // Second purchase succeeds (exhausts supply)
    client.buy_prompt(&buyer2, &prompt_id, &None::<Address>, &5_000i128, &None::<Bytes>);
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
    assert_eq!(creator_balance_after - creator_balance_before, expected_creator_amount);
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
    let prompts = client.get_prompts_by_ids(&ids).unwrap();
    assert_eq!(prompts.len(), 3);
    assert_eq!(prompts.get(0).unwrap().title, String::from_str(&env, "Prompt A"));
    assert_eq!(prompts.get(1).unwrap().title, String::from_str(&env, "Prompt B"));
    assert_eq!(prompts.get(2).unwrap().title, String::from_str(&env, "Prompt C"));
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
    let prompts = client.get_prompts_by_ids(&ids).unwrap();
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts.get(0).unwrap().title, String::from_str(&env, "Exists"));
}

#[test]
fn test_get_prompts_by_ids_empty_list() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let ids = Vec::new(&env);
    let prompts = client.get_prompts_by_ids(&ids).unwrap();
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

    for i in 0..5 {
        let buyer = Address::generate(&env);
        fund_buyer(&xlm_client, &buyer, &context.contract, 10_000);
        client.buy_prompt(&buyer, &prompt_id, &None::<Address>, &1_000i128, &None::<Bytes>);
        assert!(client.has_access(&buyer, &prompt_id));
    }

    assert_eq!(client.get_prompt(&prompt_id).sales_count, 5);
}
