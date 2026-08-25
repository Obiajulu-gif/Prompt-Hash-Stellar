use super::events::Events;
use super::storage::{InstanceStorage, Storage};
use super::types::{
    AccessPass, AssetLiability, AssetSolvency, Bundle, CatalogPassPurchase, DataKey, DisputeReason,
    DisputeStatus, Error, ListingConfig, ListingRevisionRecord, Prompt, PromptHashTrait,
    PromptSaleStatus, PurchaseDispute, PurchaseEscrow, SettlementStatus,
    SignedDiscountAuthorization, Split,
};
use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env, String, Vec};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::only_owner;

const DEFAULT_FEE_BPS: u32 = 500;
const ROYALTY_BPS: u32 = 500;
const MAX_BPS: u32 = 10_000;
const MAX_PLATFORM_FEE: u32 = 1_000;
const MAX_TITLE_LEN: u32 = 120;
const MAX_CATEGORY_LEN: u32 = 40;
const MAX_PREVIEW_LEN: u32 = 280;
const MAX_ENCRYPTED_PROMPT_LEN: u32 = 4096;
const MAX_WRAPPED_KEY_LEN: u32 = 256;
const MAX_IMAGE_URL_LEN: u32 = 512;
const MAX_IV_LEN: u32 = 64;
const LEASE_PRICE_BPS: u32 = 4_000;
const MAX_ACCESS_EXPIRY: u64 = u64::MAX;
const MAX_SPLITS: u32 = 10;
const MAX_TAGS: u32 = 8;
const MAX_TAG_LEN: u32 = 32;
const MAX_BUNDLE_PROMPTS: u32 = 20;
const MAX_PASS_DURATION_SECS: u64 = 31_536_000;
// Bounds buy_prompts_bulk's per-call resource footprint (CPU/memory/read-write
// budget) so a caller cannot force an unbounded-cost simulation or transaction
// just by passing an oversized vector (issue #438).
const MAX_BULK_PURCHASE_SIZE: u32 = 20;
// Window (from purchase) within which a buyer may open a dispute against a
// pending escrow. After it elapses with no open dispute, settlement becomes
// permissionless (#541).
const DISPUTE_WINDOW_SECS: u64 = 3 * 24 * 60 * 60;

#[contract]
pub struct PromptHashContract;

#[contractimpl]
impl PromptHashTrait for PromptHashContract {
    fn __constructor(
        env: Env,
        admin: Address,
        fee_wallet: Address,
        xlm_sac: Address,
    ) -> Result<(), Error> {
        ownable::set_owner(&env, &admin);
        InstanceStorage::set_fee_wallet(&env, &fee_wallet);
        InstanceStorage::set_fee_percentage(&env, &DEFAULT_FEE_BPS);
        InstanceStorage::set_xlm_address(&env, &xlm_sac);
        InstanceStorage::set_pause_status(&env, false);
        env.storage().instance().extend_ttl(
            super::storage::PERSISTENT_LIFETIME_THRESHOLD,
            super::storage::PERSISTENT_BUMP_AMOUNT,
        );
        Ok(())
    }

    fn create_prompt(
        env: Env,
        creator: Address,
        image_url: String,
        title: String,
        category: String,
        preview_text: String,
        encrypted_prompt: String,
        encryption_iv: String,
        wrapped_key: String,
        content_hash: BytesN<32>,
        listing: ListingConfig,
    ) -> Result<u64, Error> {
        creator.require_auth();
        InstanceStorage::require_config_initialized(&env)?;
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        validate_prompt_fields(
            &image_url,
            &title,
            &category,
            &preview_text,
            &encrypted_prompt,
            &encryption_iv,
            &wrapped_key,
            listing.price,
        )?;

        token::Client::new(&env, &listing.asset).decimals();

        if listing.expires_at != 0 {
            ensure(
                listing.expires_at > env.ledger().timestamp(),
                Error::InvalidPrice,
            )?;
        }

        validate_splits(&env, &listing.splits)?;
        validate_no_duplicate_recipients(&listing.splits)?;
        ensure(listing.splits.len() <= MAX_SPLITS, Error::TooManySplits)?;
        validate_tags(&listing.tags)?;

        let prompt_id = InstanceStorage::get_prompt_counter(&env);
        InstanceStorage::save_prompt_counter(&env, prompt_id + 1);
        let prompt = Prompt {
            id: prompt_id,
            creator: creator.clone(),
            image_url,
            title,
            category,
            preview_text,
            encrypted_payload: encrypted_prompt,
            encryption_iv,
            wrapped_key,
            content_hash,
            price_stroops: listing.price,
            asset: listing.asset.clone(),
            status: PromptSaleStatus::Active,
            sales_count: 0,
            max_supply: listing.max_supply,
            expires_at: listing.expires_at,
            splits: listing.splits,
            revision: 0,
            tags: listing.tags,
        };

        Storage::save_prompt(&env, &prompt)?;
        Storage::add_prompt_to_creator(&env, &creator, prompt_id);
        Events::emit_prompt_created(&env, prompt_id, creator, listing.price, listing.asset);
        Ok(prompt_id)
    }

    fn set_prompt_sale_status(
        env: Env,
        creator: Address,
        prompt_id: u64,
        status: PromptSaleStatus,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        ensure(
            prompt.status != PromptSaleStatus::Retired,
            Error::InvalidStatusTransition,
        )?;
        ensure(prompt.status != status, Error::InvalidStatusTransition)?;

        prompt.status = status.clone();
        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_sale_status_updated(&env, prompt_id, status);
        Ok(())
    }

    #[only_owner]
    fn admin_set_prompt_sale_status(
        env: Env,
        admin: Address,
        prompt_id: u64,
        status: PromptSaleStatus,
    ) -> Result<(), Error> {
        admin.require_auth();
        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        ensure(owner == admin, Error::Unauthorized)?;

        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(
            prompt.status != PromptSaleStatus::Retired,
            Error::InvalidStatusTransition,
        )?;
        ensure(prompt.status != status, Error::InvalidStatusTransition)?;

        prompt.status = status.clone();
        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_admin_moderated(&env, prompt_id, admin, status);
        Ok(())
    }

    fn set_prompt_max_supply(
        env: Env,
        creator: Address,
        prompt_id: u64,
        max_supply: u64,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        // A cap can never be lowered below units already sold/leased — that
        // would silently invalidate commitments already made to buyers (#538).
        ensure(
            max_supply == 0 || max_supply >= prompt.sales_count,
            Error::MaxSupplyBelowCommitted,
        )?;
        prompt.max_supply = max_supply;
        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_max_supply_updated(&env, prompt_id, max_supply);
        Ok(())
    }

    fn update_prompt_price(
        env: Env,
        creator: Address,
        prompt_id: u64,
        price_stroops: i128,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        ensure(price_stroops > 0, Error::InvalidPrice)?;

        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        prompt.price_stroops = price_stroops;
        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_price_updated(&env, prompt_id, price_stroops);
        Ok(())
    }

    fn buy_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        referrer: Option<Address>,
        payment_amount_stroops: i128,
        voucher: Option<Bytes>,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        execute_buy(
            &env,
            &buyer,
            prompt_id,
            &referrer,
            payment_amount_stroops,
            voucher,
        )
    }

    fn buy_prompt_with_auth(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        referrer: Option<Address>,
        payment_amount_stroops: i128,
        authorization: SignedDiscountAuthorization,
        creator_sig: BytesN<64>,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;

        let prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().sequence();

        // 1. Verify domain separation (network_id + contract_id)
        let contract_id = current_contract_id_hash(&env);
        let network_id = env.ledger().network_id();
        ensure(
            authorization.network_id == network_id,
            Error::AuthorizationDomainMismatch,
        )?;
        ensure(
            authorization.contract_id == contract_id,
            Error::AuthorizationDomainMismatch,
        )?;

        // 2. Verify prompt_id binding
        ensure(
            authorization.prompt_id == prompt_id,
            Error::AuthorizationPromptMismatch,
        )?;

        // 3. Verify buyer binding
        ensure(
            authorization.buyer == buyer,
            Error::AuthorizationBuyerMismatch,
        )?;

        // 4. Verify expiry
        ensure(
            authorization.expiry_ledger >= now,
            Error::AuthorizationExpired,
        )?;

        // 5. Verify the creator registered this exact authorization on-chain
        // (`add_signed_discount_auth`, gated by `creator.require_auth()`) and
        // it has not already been redeemed or revoked. Soroban's SDK
        // explicitly discourages deriving a raw Ed25519 key from an Address
        // for custom signature verification (the master key may not be a
        // current signer), so registration is authenticated via the
        // contract's native auth framework instead of `ed25519_verify`.
        let registration_key = DataKey::NonceConsumed(prompt_id, authorization.nonce.clone());
        let stored: SignedDiscountAuthorization = env
            .storage()
            .persistent()
            .get(&registration_key)
            .ok_or(Error::AuthorizationNonceConsumed)?;
        ensure(
            stored == authorization,
            Error::InvalidAuthorizationSignature,
        )?;

        // 6. Consume the nonce atomically so it cannot be redeemed twice.
        env.storage().persistent().remove(&registration_key);
        let _ = creator_sig;

        // 8. Execute buy with discount
        let discount_amount = prompt
            .price_stroops
            .checked_mul(authorization.discount_bps as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        let required_price = prompt
            .price_stroops
            .checked_sub(discount_amount)
            .ok_or(Error::ArithmeticOverflow)?;

        ensure(
            payment_amount_stroops >= required_price,
            Error::InvalidPaymentAmount,
        )?;

        // Reuse the existing buy logic with no voucher
        execute_buy_with_required_price(
            &env,
            &buyer,
            prompt_id,
            &referrer,
            payment_amount_stroops,
            required_price,
        )?;

        Events::emit_discount_applied(&env, prompt_id, buyer, authorization.discount_bps);
        Ok(())
    }

    fn lease_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        lease_duration_secs: u64,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();

        ensure(
            prompt.status == PromptSaleStatus::Active,
            Error::PromptInactive,
        )?;
        ensure(prompt.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(lease_duration_secs > 0, Error::InvalidPrice)?;
        ensure(
            !Storage::has_active_purchase(&env, prompt_id, &buyer, now),
            Error::AlreadyPurchased,
        )?;

        if prompt.expires_at != 0 {
            ensure(prompt.expires_at >= now, Error::ListingExpired)?;
        }

        // Leases consume the same supply pool as direct sales (#538).
        let reserved_sales_count = reserve_supply(prompt.sales_count, prompt.max_supply)?;

        InstanceStorage::set_reentrancy_guard(&env)?;

        let fee_wallet = InstanceStorage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;
        let this_contract = env.current_contract_address();
        let fee_percentage = InstanceStorage::get_fee_percentage(&env);
        ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

        let lease_price = prompt
            .price_stroops
            .checked_mul(LEASE_PRICE_BPS as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        ensure(lease_price > 0, Error::InvalidPrice)?;

        let fee_amount = lease_price
            .checked_mul(fee_percentage as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        let seller_amount = lease_price
            .checked_sub(fee_amount)
            .ok_or(Error::ArithmeticOverflow)?;

        // Route the full lease payment through the contract so it holds
        // escrow for dispute refunds (#564). The buyer must have
        // approved the contract for at least `lease_price`.
        let asset_client = token::StellarAssetClient::new(&env, &prompt.asset);
        asset_client.transfer_from(&this_contract, &buyer, &this_contract, &lease_price);

        // Distribute from the contract's held balance
        if seller_amount > 0 {
            asset_client.transfer(&this_contract, &prompt.creator, &seller_amount);
        }
        if fee_amount > 0 {
            asset_client.transfer(&this_contract, &fee_wallet, &fee_amount);
        }

        prompt.sales_count = reserved_sales_count;
        let expires_at = now
            .checked_add(lease_duration_secs)
            .ok_or(Error::ArithmeticOverflow)?;
        Storage::update_prompt(&env, &prompt);
        Storage::grant_purchase(&env, &prompt, &buyer, lease_price, expires_at);
        let payout_plan = super::types::PayoutPlan {
            creator: prompt.creator.clone(),
            fee_wallet: fee_wallet.clone(),
            fee_amount,
            referrer: None,
            referral_amount: 0,
            splits: Vec::new(&env),
            creator_amount: seller_amount,
        };
        let escrow = PurchaseEscrow {
            prompt_id,
            buyer: buyer.clone(),
            amount: lease_price,
            asset: prompt.asset.clone(),
            referrer: None,
            status: SettlementStatus::Settled,
            created_at: now,
            settled_at: now,
            // Lease funds settle immediately — there is no pending window.
            dispute_deadline: now,
            creator_amount: seller_amount,
            fee_amount,
            referral_amount: 0,
            payout_plan,
        };
        Storage::save_purchase_escrow(&env, &escrow);
        InstanceStorage::clear_reentrancy_guard(&env);
        Events::emit_prompt_purchased(&env, prompt_id, buyer, prompt.creator, lease_price, None);
        Ok(())
    }

    fn extend_listing(
        env: Env,
        creator: Address,
        prompt_id: u64,
        new_expires_at: u64,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        let now = env.ledger().timestamp();
        ensure(new_expires_at > now, Error::InvalidPrice)?;

        prompt.expires_at = new_expires_at;
        Storage::update_prompt(&env, &prompt);
        Events::emit_listing_extended(&env, prompt_id, new_expires_at);
        Ok(())
    }

    fn buy_prompts_bulk(
        env: Env,
        buyer: Address,
        prompt_ids: Vec<u64>,
        payment_amounts: Vec<i128>,
        referrer: Option<Address>,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        ensure(
            prompt_ids.len() == payment_amounts.len(),
            Error::InvalidPrice,
        )?;
        ensure(
            !prompt_ids.is_empty() && prompt_ids.len() <= MAX_BULK_PURCHASE_SIZE,
            Error::BulkPurchaseTooLarge,
        )?;
        validate_no_duplicate_prompt_ids(&prompt_ids)?;

        for i in 0..prompt_ids.len() {
            let prompt_id = prompt_ids.get(i).unwrap();
            let payment_amount = payment_amounts.get(i).unwrap();
            execute_buy(&env, &buyer, prompt_id, &referrer, payment_amount, None)?;
        }
        Ok(())
    }

    fn validate_bulk_purchase(
        env: Env,
        buyer: Address,
        prompt_ids: Vec<u64>,
        payment_amounts: Vec<i128>,
    ) -> Result<Vec<bool>, Error> {
        // No auth required — read-only dry-run check
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        validate_bulk_purchase_items(&env, &buyer, &prompt_ids, &payment_amounts)
    }

    fn create_bundle(
        env: Env,
        creator: Address,
        title: String,
        prompt_ids: Vec<u64>,
        price_stroops: i128,
        asset: Address,
        expires_at: u64,
    ) -> Result<u128, Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        validate_len(&title, MAX_TITLE_LEN, Error::InvalidTitleLength)?;
        ensure(price_stroops > 0, Error::InvalidPrice)?;
        ensure(!prompt_ids.is_empty(), Error::InvalidBundle)?;
        ensure(prompt_ids.len() <= MAX_BUNDLE_PROMPTS, Error::InvalidBundle)?;
        token::Client::new(&env, &asset).decimals();

        let now = env.ledger().timestamp();
        if expires_at != 0 {
            ensure(expires_at > now, Error::ListingExpired)?;
        }

        for index in 0..prompt_ids.len() {
            let prompt = Storage::require_prompt(&env, prompt_ids.get(index).unwrap())?;
            ensure(prompt.creator == creator, Error::Unauthorized)?;
            ensure(
                prompt.status == PromptSaleStatus::Active,
                Error::PromptInactive,
            )?;
            ensure(prompt.asset == asset, Error::InvalidAsset)?;
            if prompt.expires_at != 0 {
                ensure(prompt.expires_at >= now, Error::ListingExpired)?;
            }
            for duplicate_index in (index + 1)..prompt_ids.len() {
                ensure(
                    prompt_ids.get(index).unwrap() != prompt_ids.get(duplicate_index).unwrap(),
                    Error::InvalidBundle,
                )?;
            }
        }

        let bundle_id = Storage::get_bundle_counter(&env);
        let bundle = Bundle {
            id: bundle_id,
            creator: creator.clone(),
            title,
            prompt_ids,
            price_stroops,
            asset,
            active: true,
            sales_count: 0,
            expires_at,
        };

        Storage::save_bundle(&env, &bundle)?;
        Storage::add_bundle_to_creator(&env, &creator, bundle_id);
        Events::emit_bundle_created(&env, bundle_id, creator, price_stroops);
        Ok(bundle_id)
    }

    fn buy_bundle(
        env: Env,
        buyer: Address,
        bundle_id: u128,
        payment_amount_stroops: i128,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let now = env.ledger().timestamp();
        let mut bundle = Storage::require_bundle(&env, bundle_id)?;

        ensure(bundle.active, Error::PromptInactive)?;
        ensure(bundle.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(
            payment_amount_stroops >= bundle.price_stroops,
            Error::InvalidPaymentAmount,
        )?;
        if bundle.expires_at != 0 {
            ensure(bundle.expires_at >= now, Error::ListingExpired)?;
        }

        let mut prompts = Vec::new(&env);
        let mut needs_access = false;
        for index in 0..bundle.prompt_ids.len() {
            let mut prompt = Storage::require_prompt(&env, bundle.prompt_ids.get(index).unwrap())?;
            ensure(prompt.creator == bundle.creator, Error::Unauthorized)?;
            ensure(
                prompt.status == PromptSaleStatus::Active,
                Error::PromptInactive,
            )?;
            ensure(prompt.asset == bundle.asset, Error::InvalidAsset)?;
            if prompt.expires_at != 0 {
                ensure(prompt.expires_at >= now, Error::ListingExpired)?;
            }
            if !Storage::has_active_purchase(&env, prompt.id, &buyer, now) {
                needs_access = true;
                prompt.sales_count = reserve_supply(prompt.sales_count, prompt.max_supply)?;
            }
            prompts.push_back(prompt);
        }
        ensure(needs_access, Error::AlreadyPurchased)?;

        InstanceStorage::set_reentrancy_guard(&env)?;

        // Route the full payment through the contract so it holds
        // escrow for dispute refunds (#454, #563). The buyer must have
        // approved the contract for at least `payment_amount_stroops`.
        let this_contract = env.current_contract_address();
        let asset_client = token::StellarAssetClient::new(&env, &bundle.asset);
        asset_client.transfer_from(
            &this_contract,
            &buyer,
            &this_contract,
            &payment_amount_stroops,
        );

        // Calculate all allocations from the single payment amount.
        let fee_percentage = InstanceStorage::get_fee_percentage(&env);
        ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

        let fee_amount = payment_amount_stroops
            .checked_mul(fee_percentage as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;

        let fee_wallet = InstanceStorage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;

        // Distribute fee to the fee wallet from the contract's held balance
        if fee_amount > 0 {
            asset_client.transfer(&this_contract, &fee_wallet, &fee_amount);
        }

        // Distribute collaborator splits from the contract's held balance
        let mut split_total: i128 = 0;
        let mut payout_splits: Vec<super::types::PayoutSplit> = Vec::new(&env);
        for index in 0..prompts.len() {
            let prompt = prompts.get(index).unwrap();
            if !Storage::has_active_purchase(&env, prompt.id, &buyer, now) {
                for split_idx in 0..prompt.splits.len() {
                    let split = prompt.splits.get(split_idx).unwrap();
                    let split_amount = payment_amount_stroops
                        .checked_mul(split.bps as i128)
                        .ok_or(Error::ArithmeticOverflow)?
                        / MAX_BPS as i128;
                    split_total = split_total
                        .checked_add(split_amount)
                        .ok_or(Error::ArithmeticOverflow)?;
                    if split_amount > 0 {
                        asset_client.transfer(&this_contract, &split.recipient, &split_amount);
                        payout_splits.push_back(super::types::PayoutSplit {
                            recipient: split.recipient.clone(),
                            amount: split_amount,
                        });
                    }
                }
            }
        }

        // Creator receives the remainder after all deductions
        let creator_amount = payment_amount_stroops
            .checked_sub(fee_amount)
            .ok_or(Error::ArithmeticOverflow)?
            .checked_sub(split_total)
            .ok_or(Error::ArithmeticOverflow)?;
        ensure(creator_amount >= 0, Error::InvalidSplits)?;

        if creator_amount > 0 {
            asset_client.transfer(&this_contract, &bundle.creator, &creator_amount);
        }

        // Update prompt sales counts and grant access for newly purchased prompts
        for index in 0..prompts.len() {
            let prompt = prompts.get(index).unwrap();
            if !Storage::has_active_purchase(&env, prompt.id, &buyer, now) {
                Storage::update_prompt(&env, &prompt);
                Storage::grant_purchase(
                    &env,
                    &prompt,
                    &buyer,
                    payment_amount_stroops
                        .checked_div(prompts.len() as i128)
                        .ok_or(Error::InvalidPaymentAmount)?,
                    MAX_ACCESS_EXPIRY,
                );
            }
        }

        bundle.sales_count = bundle
            .sales_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        Storage::update_bundle(&env, &bundle);

        // Create escrow with payout plan for unified dispute/settlement (#564)
        // Bundles now have the same Pending/dispute_deadline escrow lifecycle as individual
        // purchases (#595), giving buyers the full dispute window before settlement.
        let fee_wallet = InstanceStorage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;
        let payout_plan = super::types::PayoutPlan {
            creator: bundle.creator.clone(),
            fee_wallet: fee_wallet.clone(),
            fee_amount,
            referrer: None,
            referral_amount: 0,
            splits: payout_splits,
            creator_amount,
        };
        let dispute_deadline = now
            .checked_add(DISPUTE_WINDOW_SECS)
            .ok_or(Error::ArithmeticOverflow)?;
        let escrow = PurchaseEscrow {
            prompt_id: 0, // Bundles don't have a single prompt ID
            buyer: buyer.clone(),
            amount: payment_amount_stroops,
            asset: bundle.asset.clone(),
            referrer: None,
            status: SettlementStatus::Pending,
            created_at: now,
            settled_at: 0, // Not yet settled
            dispute_deadline,
            creator_amount,
            fee_amount,
            referral_amount: 0,
            payout_plan,
        };
        Storage::save_purchase_escrow(&env, &escrow);
        // Track the escrowed bundle funds as pending liability (#570)
        Storage::add_pending_liability(&env, &bundle.asset, payment_amount_stroops)?;
        // Store bundle prompt IDs and mapping for later refund processing (#595)
        Storage::save_bundle_purchase_prompts(&env, &buyer, bundle_id, &bundle.prompt_ids);
        Storage::save_bundle_escrow_id(&env, &buyer, now, bundle_id);

        InstanceStorage::clear_reentrancy_guard(&env);

        Events::emit_bundle_purchased(
            &env,
            bundle_id,
            buyer,
            bundle.creator,
            payment_amount_stroops,
            bundle.prompt_ids,
        );
        Ok(())
    }

    fn get_bundle(env: Env, bundle_id: u128) -> Result<Bundle, Error> {
        Storage::require_bundle(&env, bundle_id)
    }

    fn get_bundles_by_creator(env: Env, creator: Address) -> Result<Vec<Bundle>, Error> {
        Ok(Storage::get_bundles_by_creator(&env, &creator))
    }

    fn create_access_pass(
        env: Env,
        creator: Address,
        title: String,
        duration_secs: u64,
        price_stroops: i128,
        asset: Address,
        max_supply: u32,
    ) -> Result<u128, Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        validate_len(&title, MAX_TITLE_LEN, Error::InvalidTitleLength)?;
        ensure(price_stroops > 0, Error::InvalidPrice)?;
        ensure(
            duration_secs > 0 && duration_secs <= MAX_PASS_DURATION_SECS,
            Error::InvalidAccessDuration,
        )?;
        token::Client::new(&env, &asset).decimals();

        let pass_id = Storage::get_access_pass_counter(&env);
        let access_pass = AccessPass {
            id: pass_id,
            creator: creator.clone(),
            title,
            duration_secs,
            price_stroops,
            asset,
            status: PromptSaleStatus::Active,
            sales_count: 0,
            max_supply,
        };

        Storage::save_access_pass(&env, &access_pass)?;
        Storage::add_access_pass_to_creator(&env, &creator, pass_id);
        Events::emit_access_pass_created(&env, pass_id, creator, duration_secs, price_stroops);
        Ok(pass_id)
    }

    fn set_access_pass_status(
        env: Env,
        creator: Address,
        pass_id: u128,
        status: PromptSaleStatus,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut access_pass = Storage::require_access_pass(&env, pass_id)?;
        ensure(access_pass.creator == creator, Error::Unauthorized)?;
        ensure(
            access_pass.status != PromptSaleStatus::Retired,
            Error::InvalidStatusTransition,
        )?;
        ensure(access_pass.status != status, Error::InvalidStatusTransition)?;

        access_pass.status = status.clone();
        Storage::update_access_pass(&env, &access_pass);
        Events::emit_access_pass_status_updated(&env, pass_id, status);
        Ok(())
    }

    fn update_access_pass_price(
        env: Env,
        creator: Address,
        pass_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        ensure(price_stroops > 0, Error::InvalidPrice)?;
        let mut access_pass = Storage::require_access_pass(&env, pass_id)?;
        ensure(access_pass.creator == creator, Error::Unauthorized)?;

        access_pass.price_stroops = price_stroops;
        Storage::update_access_pass(&env, &access_pass);
        Events::emit_access_pass_price_updated(&env, pass_id, price_stroops);
        Ok(())
    }

    fn buy_access_pass(
        env: Env,
        buyer: Address,
        pass_id: u128,
        payment_amount_stroops: i128,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut access_pass = Storage::require_access_pass(&env, pass_id)?;
        let now = env.ledger().timestamp();

        ensure(
            access_pass.status == PromptSaleStatus::Active,
            Error::PromptInactive,
        )?;
        ensure(access_pass.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(
            payment_amount_stroops >= access_pass.price_stroops,
            Error::InvalidPaymentAmount,
        )?;

        // Each purchase reserves one unit of this pass's own supply, on top
        // of whatever other passes this creator has sold (#538).
        access_pass.sales_count =
            reserve_pass_supply(access_pass.sales_count, access_pass.max_supply)?;

        InstanceStorage::set_reentrancy_guard(&env)?;

        // Route the full payment through the contract so it holds
        // escrow for dispute refunds (#564). The buyer must have
        // approved the contract for at least `payment_amount_stroops`.
        let this_contract = env.current_contract_address();
        let asset_client = token::StellarAssetClient::new(&env, &access_pass.asset);
        asset_client.transfer_from(
            &this_contract,
            &buyer,
            &this_contract,
            &payment_amount_stroops,
        );

        // Calculate allocations from the single payment
        let fee_percentage = InstanceStorage::get_fee_percentage(&env);
        ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

        let fee_amount = payment_amount_stroops
            .checked_mul(fee_percentage as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        let creator_amount = payment_amount_stroops
            .checked_sub(fee_amount)
            .ok_or(Error::ArithmeticOverflow)?;

        let fee_wallet = InstanceStorage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;

        // Distribute from the contract's held balance
        if fee_amount > 0 {
            asset_client.transfer(&this_contract, &fee_wallet, &fee_amount);
        }
        if creator_amount > 0 {
            asset_client.transfer(&this_contract, &access_pass.creator, &creator_amount);
        }

        // Renewing before the current grant expires extends it forward from
        // the existing expiry rather than from `now`, so the buyer never
        // loses paid-for time or is double-charged for an overlapping
        // period (#539).
        let existing = Storage::get_catalog_pass_purchase(&env, &access_pass.creator, &buyer);
        let base = existing
            .map(|p| {
                if p.expires_at > now {
                    p.expires_at
                } else {
                    now
                }
            })
            .unwrap_or(now);
        let expires_at = base
            .checked_add(access_pass.duration_secs)
            .ok_or(Error::ArithmeticOverflow)?;
        let catalog_pass = CatalogPassPurchase {
            creator: access_pass.creator.clone(),
            buyer: buyer.clone(),
            pass_id,
            expires_at,
        };
        Storage::save_catalog_pass_purchase(&env, &catalog_pass);

        // Create escrow with payout plan for unified dispute/settlement (#564).
        // Store separately from prompt escrows to avoid key collisions — access pass
        // escrows use (pass_id, buyer) to support multiple pass purchases by the buyer.
        let payout_plan = super::types::PayoutPlan {
            creator: access_pass.creator.clone(),
            fee_wallet: fee_wallet.clone(),
            fee_amount,
            referrer: None,
            referral_amount: 0,
            splits: Vec::new(&env),
            creator_amount,
        };
        let dispute_deadline = now
            .checked_add(DISPUTE_WINDOW_SECS)
            .ok_or(Error::ArithmeticOverflow)?;
        let escrow = PurchaseEscrow {
            prompt_id: pass_id as u64, // Use pass_id as the unique identifier within AccessPassEscrow
            buyer: buyer.clone(),
            amount: payment_amount_stroops,
            asset: access_pass.asset.clone(),
            referrer: None,
            status: SettlementStatus::Pending,
            created_at: now,
            settled_at: 0, // Not yet settled
            dispute_deadline,
            creator_amount,
            fee_amount,
            referral_amount: 0,
            payout_plan,
        };
        Storage::save_access_pass_escrow(&env, pass_id, &buyer, &escrow);
        // Track the escrowed funds as pending liability (#570)
        Storage::add_pending_liability(&env, &access_pass.asset, payment_amount_stroops)?;

        Storage::update_access_pass(&env, &access_pass);
        InstanceStorage::clear_reentrancy_guard(&env);
        Events::emit_access_pass_purchased(&env, pass_id, buyer, access_pass.creator, expires_at);
        Ok(())
    }

    fn get_access_pass(env: Env, pass_id: u128) -> Result<AccessPass, Error> {
        Storage::require_access_pass(&env, pass_id)
    }

    fn get_access_passes_by_creator(env: Env, creator: Address) -> Result<Vec<AccessPass>, Error> {
        Ok(Storage::get_access_passes_by_creator(&env, &creator))
    }

    fn transfer_license(
        env: Env,
        seller: Address,
        prompt_id: u64,
        new_buyer: Address,
        resale_price: i128,
    ) -> Result<(), Error> {
        seller.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        ensure(resale_price > 0, Error::InvalidPaymentAmount)?;
        ensure(seller != new_buyer, Error::InvalidLicenseTransfer)?;
        new_buyer.require_auth();

        let prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();
        let mut purchase = Storage::require_purchase(&env, prompt_id, &seller)?;
        ensure(purchase.owner == seller, Error::Unauthorized)?;
        ensure(purchase.expires_at >= now, Error::LicenseNotFound)?;
        ensure(
            !Storage::has_active_purchase(&env, prompt_id, &new_buyer, now),
            Error::AlreadyPurchased,
        )?;

        InstanceStorage::set_reentrancy_guard(&env)?;

        let this_contract = env.current_contract_address();
        let asset_client = token::StellarAssetClient::new(&env, &prompt.asset);
        let royalty_amount = resale_price
            .checked_mul(ROYALTY_BPS as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        let seller_amount = resale_price
            .checked_sub(royalty_amount)
            .ok_or(Error::ArithmeticOverflow)?;

        if royalty_amount > 0 {
            asset_client.transfer_from(
                &this_contract,
                &new_buyer,
                &purchase.original_creator,
                &royalty_amount,
            );
        }
        if seller_amount > 0 {
            asset_client.transfer_from(&this_contract, &new_buyer, &seller, &seller_amount);
        }

        Storage::remove_purchase(&env, prompt_id, &seller);
        Storage::remove_prompt_from_buyer(&env, &seller, prompt_id);
        purchase.owner = new_buyer.clone();
        purchase.last_transfer_price = resale_price;
        purchase.transfer_count = purchase
            .transfer_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        purchase.last_transferred_at = now;
        Storage::save_purchase(&env, &purchase);
        Storage::add_prompt_to_buyer(&env, &new_buyer, prompt_id);
        InstanceStorage::clear_reentrancy_guard(&env);

        Events::emit_license_transferred(
            &env,
            prompt_id,
            seller,
            new_buyer,
            purchase.original_creator,
            resale_price,
            royalty_amount,
        );
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn revise_listing(
        env: Env,
        creator: Address,
        prompt_id: u64,
        title: String,
        category: String,
        preview_text: String,
        image_url: String,
        price_stroops: i128,
    ) -> Result<u32, Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        ensure(price_stroops > 0, Error::InvalidPrice)?;
        validate_len(&image_url, MAX_IMAGE_URL_LEN, Error::InvalidImageUrlLength)?;
        validate_len(&title, MAX_TITLE_LEN, Error::InvalidTitleLength)?;
        validate_len(&category, MAX_CATEGORY_LEN, Error::InvalidCategoryLength)?;
        validate_len(&preview_text, MAX_PREVIEW_LEN, Error::InvalidPreviewLength)?;

        let snapshot = ListingRevisionRecord {
            prompt_id,
            revision: prompt.revision,
            title: prompt.title.clone(),
            category: prompt.category.clone(),
            preview_text: prompt.preview_text.clone(),
            image_url: prompt.image_url.clone(),
            price_stroops: prompt.price_stroops,
            revised_at: env.ledger().timestamp(),
        };
        Storage::save_listing_revision(&env, &snapshot);

        prompt.title = title;
        prompt.category = category;
        prompt.preview_text = preview_text;
        prompt.image_url = image_url;
        prompt.price_stroops = price_stroops;
        prompt.revision = prompt
            .revision
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;

        Storage::update_prompt(&env, &prompt);
        Events::emit_listing_revised(&env, prompt_id, prompt.revision);
        Ok(prompt.revision)
    }

    fn get_listing_revision(
        env: Env,
        prompt_id: u64,
        revision: u32,
    ) -> Result<ListingRevisionRecord, Error> {
        Storage::require_prompt(&env, prompt_id)?;
        Storage::get_listing_revision(&env, prompt_id, revision).ok_or(Error::PromptNotFound)
    }

    fn update_splits(
        env: Env,
        creator: Address,
        prompt_id: u64,
        new_splits: Vec<Split>,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        validate_splits(&env, &new_splits)?;
        validate_no_duplicate_recipients(&new_splits)?;
        ensure(new_splits.len() <= MAX_SPLITS, Error::TooManySplits)?;

        prompt.splits = new_splits;
        Storage::update_prompt(&env, &prompt);
        Events::emit_splits_updated(&env, prompt_id);
        Ok(())
    }

    fn has_access(env: Env, user: Address, prompt_id: u64) -> Result<bool, Error> {
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();
        Ok(prompt.creator == user
            || Storage::has_active_purchase(&env, prompt_id, &user, now)
            || Storage::has_active_creator_pass(&env, &prompt.creator, &user, now))
    }

    fn get_prompt(env: Env, prompt_id: u64) -> Result<Prompt, Error> {
        Storage::require_prompt(&env, prompt_id)
    }

    fn get_all_prompts(env: Env) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_all_prompts(&env))
    }

    fn get_prompts_by_category(env: Env, category: String) -> Result<Vec<Prompt>, Error> {
        validate_len(&category, MAX_CATEGORY_LEN, Error::InvalidCategoryLength)?;
        Ok(Storage::get_prompts_by_category(&env, &category))
    }

    fn get_prompts_by_tag(env: Env, tag: String) -> Result<Vec<Prompt>, Error> {
        validate_len(&tag, MAX_TAG_LEN, Error::InvalidCategoryLength)?;
        Ok(Storage::get_prompts_by_tag(&env, &tag))
    }

    // Paginated catalog queries (bounded, respects resource limits)
    fn get_all_prompts_paginated(
        env: Env,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error> {
        use crate::pagination::{decode_cursor, encode_cursor, IndexType};

        let cursor_id = if let Some(c) = cursor {
            let parsed = decode_cursor(&env, &c)?;
            Some(parsed.last_id)
        } else {
            None
        };

        let key = crate::types::DataKey::AllPrompts;
        let prompts = Storage::get_prompts_paginated(&env, &key, cursor_id, limit);

        let next_cursor = if !prompts.is_empty() {
            let last_id = prompts.last().ok_or(Error::PromptNotFound)?.id;
            Some(encode_cursor(&env, last_id, IndexType::All))
        } else {
            None
        };

        Ok((prompts, next_cursor))
    }

    fn get_prompts_by_category_page(
        env: Env,
        category: String,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error> {
        use crate::pagination::{decode_cursor, encode_cursor, IndexType};

        validate_len(&category, MAX_CATEGORY_LEN, Error::InvalidCategoryLength)?;

        let cursor_id = if let Some(c) = cursor {
            let parsed = decode_cursor(&env, &c)?;
            Some(parsed.last_id)
        } else {
            None
        };

        let key = crate::types::DataKey::CategoryPrompts(category);
        let prompts = Storage::get_prompts_paginated(&env, &key, cursor_id, limit);

        let next_cursor = if !prompts.is_empty() {
            let last_id = prompts.last().ok_or(Error::PromptNotFound)?.id;
            Some(encode_cursor(&env, last_id, IndexType::Category))
        } else {
            None
        };

        Ok((prompts, next_cursor))
    }

    fn get_prompts_by_tag_paginated(
        env: Env,
        tag: String,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error> {
        use crate::pagination::{decode_cursor, encode_cursor, IndexType};

        validate_len(&tag, MAX_TAG_LEN, Error::InvalidCategoryLength)?;

        let cursor_id = if let Some(c) = cursor {
            let parsed = decode_cursor(&env, &c)?;
            Some(parsed.last_id)
        } else {
            None
        };

        let key = crate::types::DataKey::TagPrompts(tag);
        let prompts = Storage::get_prompts_paginated(&env, &key, cursor_id, limit);

        let next_cursor = if !prompts.is_empty() {
            let last_id = prompts.last().ok_or(Error::PromptNotFound)?.id;
            Some(encode_cursor(&env, last_id, IndexType::Tag))
        } else {
            None
        };

        Ok((prompts, next_cursor))
    }

    fn get_active_prompts_paginated(
        env: Env,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error> {
        use crate::pagination::{decode_cursor, encode_cursor, IndexType};

        let cursor_id = if let Some(c) = cursor {
            let parsed = decode_cursor(&env, &c)?;
            Some(parsed.last_id)
        } else {
            None
        };

        let key = crate::types::DataKey::ActivePrompts;
        let prompts = Storage::get_prompts_paginated(&env, &key, cursor_id, limit);

        let next_cursor = if !prompts.is_empty() {
            let last_id = prompts.last().ok_or(Error::PromptNotFound)?.id;
            Some(encode_cursor(&env, last_id, IndexType::Active))
        } else {
            None
        };

        Ok((prompts, next_cursor))
    }

    // ====== TTL MAINTENANCE (OPERATOR UTILITIES) ======

    fn renew_critical_keys(env: Env, cursor: Option<u64>) -> Result<(u32, Option<u64>), Error> {
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        Ok(Storage::renew_critical_keys(&env, cursor))
    }

    fn get_expiry_risk_metrics(env: Env) -> Result<Vec<(String, String)>, Error> {
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        Ok(Storage::compute_expiry_risks(&env))
    }

    fn open_dispute(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        reason: DisputeReason,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let now = env.ledger().timestamp();

        // Bundle disputes (#595) have prompt_id == 0 and no individual purchase record
        let is_bundle_dispute = prompt_id == 0 && Storage::get_prompt(&env, 0).is_none();
        if !is_bundle_dispute {
            Storage::require_purchase(&env, prompt_id, &buyer)?;
        }

        // Purchases with a pending escrow (direct/bulk buys, now bundles #595) may only be
        // disputed within the purchase-relative window; once it closes the
        // escrow is eligible for permissionless settlement (#541). Purchases
        // without a pending escrow (leases, access passes) are unaffected.
        let mut escrow_liability_move: Option<(Address, i128)> = None;
        if let Some(escrow) = Storage::get_purchase_escrow(&env, prompt_id, &buyer) {
            if escrow.status == SettlementStatus::Pending {
                ensure(now <= escrow.dispute_deadline, Error::DisputeWindowClosed)?;
                escrow_liability_move = Some((escrow.asset, escrow.amount));
            } else {
                // Already settled or refunded — nothing left to dispute.
                return Err(Error::DisputeWindowClosed);
            }
        } else if !is_bundle_dispute {
            // Non-bundle purchases without an escrow shouldn't be disputed
            return Err(Error::DisputeWindowClosed);
        }
        if let Some(dispute) = Storage::get_dispute(&env, prompt_id, &buyer) {
            ensure(
                dispute.status != DisputeStatus::Open,
                Error::DisputeAlreadyOpen,
            )?;
        }
        // The escrowed amount is now at risk of refund rather than
        // settlement — move it out of `pending` into `disputed` so per-asset
        // liability reflects the dispute (#570). Applied only once every
        // other guard above has passed, so a rejected duplicate-open attempt
        // never touches the ledger.
        if let Some((asset, amount)) = escrow_liability_move {
            Storage::move_pending_to_disputed(&env, &asset, amount)?;
        }
        let dispute = PurchaseDispute {
            prompt_id,
            buyer: buyer.clone(),
            reason,
            opened_at: now,
            resolved_at: 0,
            status: DisputeStatus::Open,
        };
        Storage::save_dispute(&env, &dispute);
        Events::emit_dispute_opened(&env, prompt_id, buyer);
        Ok(())
    }

    fn resolve_dispute(
        env: Env,
        admin: Address,
        prompt_id: u64,
        buyer: Address,
        refund: bool,
    ) -> Result<(), Error> {
        admin.require_auth();
        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        ensure(owner == admin, Error::Unauthorized)?;
        // Refunds move customer funds — must respect the pause flag like
        // every other mutating entry point, including an invariant-triggered
        // pause from `check_asset_solvency` (#570).
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;

        InstanceStorage::set_reentrancy_guard(&env)?;

        // Bundle disputes (#595) have prompt_id == 0 and require special refund handling
        let is_bundle_dispute = prompt_id == 0 && Storage::get_prompt(&env, 0).is_none();
        let mut dispute = Storage::require_dispute(&env, prompt_id, &buyer)?;
        ensure(
            dispute.status == DisputeStatus::Open,
            Error::DisputeResolved,
        )?;
        dispute.resolved_at = env.ledger().timestamp();

        if refund {
            if is_bundle_dispute {
                // Handle bundle dispute refund (#595)
                if let Some(escrow) = Storage::get_purchase_escrow(&env, prompt_id, &buyer) {
                    let asset_client = token::StellarAssetClient::new(&env, &escrow.asset);
                    // Refund the full bundle amount to the buyer
                    asset_client.transfer(&env.current_contract_address(), &buyer, &escrow.amount);

                    // Look up the bundle ID to access its prompts
                    if let Some(bundle_id) =
                        Storage::get_bundle_escrow_id(&env, &buyer, escrow.created_at)
                    {
                        if let Some(bundle_prompts) =
                            Storage::get_bundle_purchase_prompts(&env, &buyer, bundle_id)
                        {
                            // Revoke access and release supply for each prompt in the bundle
                            for index in 0..bundle_prompts.len() {
                                let prompt_in_bundle = bundle_prompts.get(index).unwrap();
                                Storage::remove_purchase(&env, prompt_in_bundle, &buyer);
                                Storage::remove_prompt_from_buyer(&env, &buyer, prompt_in_bundle);

                                if let Some(mut prompt) =
                                    Storage::get_prompt(&env, prompt_in_bundle)
                                {
                                    prompt.sales_count = prompt.sales_count.saturating_sub(1);
                                    Storage::update_prompt(&env, &prompt);
                                }
                            }
                        }
                    }

                    // Also remove the purchase record for prompt_id == 0
                    Storage::remove_purchase(&env, prompt_id, &buyer);
                    dispute.status = DisputeStatus::Refunded;

                    // Update the escrow record
                    let mut escrow_updated = escrow;
                    Storage::remove_disputed_liability(
                        &env,
                        &escrow_updated.asset,
                        escrow_updated.amount,
                    )?;
                    escrow_updated.status = SettlementStatus::Refunded;
                    escrow_updated.settled_at = env.ledger().timestamp();
                    Storage::save_purchase_escrow(&env, &escrow_updated);
                }
            } else {
                // Handle single prompt dispute refund
                let mut prompt = Storage::require_prompt(&env, prompt_id)?;
                let purchase = Storage::require_purchase(&env, prompt_id, &buyer)?;
                let asset_client = token::StellarAssetClient::new(&env, &prompt.asset);
                // Refund from the contract's escrowed balance (#454).  The
                // funds were routed to the contract during purchase so that
                // a refund is always possible without additional auth.
                asset_client.transfer(
                    &env.current_contract_address(),
                    &buyer,
                    &purchase.original_price,
                );

                // Mark the purchase as revoked so the buyer can no longer claim access.
                Storage::remove_purchase(&env, prompt_id, &buyer);
                Storage::remove_prompt_from_buyer(&env, &buyer, prompt_id);
                dispute.status = DisputeStatus::Refunded;

                // Release the reserved supply unit back to the pool so another
                // buyer may purchase it (#541).
                if prompt.sales_count > 0 {
                    prompt.sales_count -= 1;
                    Storage::update_prompt(&env, &prompt);
                }

                // If this purchase had an escrow, transition it to `Refunded`
                // and clear the tracked disputed liability (#541, #570).
                if let Some(mut escrow) = Storage::get_purchase_escrow(&env, prompt_id, &buyer) {
                    Storage::remove_disputed_liability(&env, &escrow.asset, escrow.amount)?;
                    escrow.status = SettlementStatus::Refunded;
                    escrow.settled_at = env.ledger().timestamp();
                    Storage::save_purchase_escrow(&env, &escrow);
                }
            }
        } else {
            dispute.status = DisputeStatus::Rejected;
            // The escrow stays Pending, awaiting a future `settle_purchase`
            // call — move its amount back out of `disputed` into `pending`
            // (#570).
            if let Some(escrow) = Storage::get_purchase_escrow(&env, prompt_id, &buyer) {
                if escrow.status == SettlementStatus::Pending {
                    Storage::move_disputed_to_pending(&env, &escrow.asset, escrow.amount)?;
                }
            }
        }
        Storage::save_dispute(&env, &dispute);
        InstanceStorage::clear_reentrancy_guard(&env);

        Events::emit_dispute_resolved(&env, prompt_id, buyer, refund);
        Ok(())
    }

    /// Release escrowed funds using the immutable payout plan snapshotted at
    /// purchase time (#562), not the current listing state. The contract
    /// owner (admin) or the prompt creator may settle at any time; any
    /// other caller may settle only once the purchase-relative dispute
    /// window has closed with no open dispute, guaranteeing every escrow
    /// has a bounded path to Released even if the admin/creator never
    /// act (#454/#541).
    fn settle_purchase(
        env: Env,
        caller: Address,
        prompt_id: u64,
        buyer: Address,
    ) -> Result<(), Error> {
        caller.require_auth();
        // Settlement moves customer funds — must respect the pause flag like
        // every other mutating entry point, including an invariant-triggered
        // pause from `check_asset_solvency` (#570).
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;

        InstanceStorage::set_reentrancy_guard(&env)?;

        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;

        // Bundle settlements (#595) have prompt_id == 0 and cannot use creator auth
        let is_bundle_settle = prompt_id == 0 && Storage::get_prompt(&env, 0).is_none();
        let prompt_option = Storage::get_prompt(&env, prompt_id);

        let mut escrow = Storage::require_purchase_escrow(&env, prompt_id, &buyer)?;
        ensure(
            escrow.status == SettlementStatus::Pending,
            Error::DisputeResolved,
        )?;

        // An open dispute must be resolved via `resolve_dispute`, not
        // settled — this holds even for the admin/creator fast path (#541).
        if let Some(dispute) = Storage::get_dispute(&env, prompt_id, &buyer) {
            ensure(
                dispute.status != DisputeStatus::Open,
                Error::DisputeAlreadyOpen,
            )?;
        }

        let now = env.ledger().timestamp();
        let is_privileged = caller == owner
            || (!is_bundle_settle
                && prompt_option.is_some()
                && caller == prompt_option.unwrap().creator);
        if !is_privileged {
            // Permissionless fallback: once the dispute window has closed
            // with no open dispute, anyone may finalize the escrow — this
            // guarantees a bounded path to Released even if the admin or
            // creator never act (#541).
            ensure(
                now > escrow.dispute_deadline,
                Error::DisputeWindowNotElapsed,
            )?;
        }

        let this_contract = env.current_contract_address();
        let asset_client = token::StellarAssetClient::new(&env, &escrow.asset);

        // Use the snapshotted payout plan, not the current listing state (#562).
        let plan = &escrow.payout_plan;

        // Distribute fee to the snapshotted fee wallet
        if plan.fee_amount > 0 {
            asset_client.transfer(&this_contract, &plan.fee_wallet, &plan.fee_amount);
        }

        // Distribute referral to the snapshotted referrer
        if let Some(ref r) = plan.referrer {
            if plan.referral_amount > 0 {
                asset_client.transfer(&this_contract, r, &plan.referral_amount);
            }
        }

        // Distribute collaborator splits from the snapshotted amounts
        for i in 0..plan.splits.len() {
            let split = plan.splits.get(i).unwrap();
            if split.amount > 0 {
                asset_client.transfer(&this_contract, &split.recipient, &split.amount);
            }
        }

        // Transfer the creator's escrowed share to the snapshotted creator
        if plan.creator_amount > 0 {
            asset_client.transfer(&this_contract, &plan.creator, &plan.creator_amount);
        }

        // The escrow guards above guarantee this amount was still in the
        // pending bucket (Pending status, no open dispute) — release it
        // from tracked liability now that it's been paid out (#570).
        Storage::remove_pending_liability(&env, &escrow.asset, escrow.amount)?;

        escrow.status = SettlementStatus::Settled;
        escrow.settled_at = now;
        Storage::save_purchase_escrow(&env, &escrow);
        InstanceStorage::clear_reentrancy_guard(&env);
        Events::emit_prompt_purchased(
            &env,
            prompt_id,
            buyer,
            plan.creator.clone(),
            escrow.amount,
            escrow.referrer,
        );
        Ok(())
    }

    fn get_dispute(env: Env, prompt_id: u64, buyer: Address) -> Result<PurchaseDispute, Error> {
        Storage::require_dispute(&env, prompt_id, &buyer)
    }

    fn get_purchase_escrow(env: Env, prompt_id: u64, buyer: Address) -> Option<PurchaseEscrow> {
        Storage::get_purchase_escrow(&env, prompt_id, &buyer)
    }

    /// Open a dispute against an access pass purchase. Similar to open_dispute
    /// but uses the separate AccessPassEscrow storage to support multiple passes
    /// per buyer (#564).
    fn open_access_pass_dispute(
        env: Env,
        buyer: Address,
        pass_id: u128,
        reason: DisputeReason,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let now = env.ledger().timestamp();

        // Verify the access pass purchase exists
        let escrow = Storage::require_access_pass_escrow(&env, pass_id, &buyer)?;

        // Only pending escrows can be disputed
        ensure(
            escrow.status == SettlementStatus::Pending,
            Error::DisputeWindowClosed,
        )?;

        // Ensure within dispute window
        ensure(now <= escrow.dispute_deadline, Error::DisputeWindowClosed)?;

        // Check if a dispute is already open
        if let Some(dispute) = Storage::get_access_pass_dispute(&env, pass_id, &buyer) {
            ensure(
                dispute.status != DisputeStatus::Open,
                Error::DisputeAlreadyOpen,
            )?;
        }

        // Move amount from pending to disputed liability
        Storage::move_pending_to_disputed(&env, &escrow.asset, escrow.amount)?;

        let dispute = PurchaseDispute {
            prompt_id: pass_id as u64,
            buyer: buyer.clone(),
            reason,
            opened_at: now,
            resolved_at: 0,
            status: DisputeStatus::Open,
        };
        Storage::save_access_pass_dispute(&env, pass_id, &buyer, &dispute);
        Events::emit_dispute_opened(&env, pass_id as u64, buyer);
        Ok(())
    }

    /// Resolve an access pass purchase dispute. Admin-only, similar to
    /// resolve_dispute but for pass escrows (#564).
    fn resolve_access_pass_dispute(
        env: Env,
        admin: Address,
        pass_id: u128,
        buyer: Address,
        refund: bool,
    ) -> Result<(), Error> {
        admin.require_auth();
        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        ensure(owner == admin, Error::Unauthorized)?;
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;

        InstanceStorage::set_reentrancy_guard(&env)?;

        let escrow = Storage::require_access_pass_escrow(&env, pass_id, &buyer)?;
        let mut dispute = Storage::require_access_pass_dispute(&env, pass_id, &buyer)?;
        ensure(
            dispute.status == DisputeStatus::Open,
            Error::DisputeResolved,
        )?;

        let now = env.ledger().timestamp();
        dispute.resolved_at = now;

        if refund {
            // Refund to the buyer
            let asset_client = token::StellarAssetClient::new(&env, &escrow.asset);
            asset_client.transfer(&env.current_contract_address(), &buyer, &escrow.amount);

            dispute.status = DisputeStatus::Refunded;

            // Remove the disputed liability since it's now paid out
            Storage::remove_disputed_liability(&env, &escrow.asset, escrow.amount)?;

            // Revoke the catalog pass grant so buyer can't use it anymore
            if Storage::get_catalog_pass_purchase(&env, &escrow.payout_plan.creator, &buyer)
                .is_some()
            {
                // Clear the catalog pass by removing it
                let key = DataKey::CatalogPass(escrow.payout_plan.creator.clone(), buyer.clone());
                env.storage().persistent().remove(&key);
            }

            // Update escrow to Refunded
            let mut updated_escrow = escrow.clone();
            updated_escrow.status = SettlementStatus::Refunded;
            updated_escrow.settled_at = now;
            Storage::save_access_pass_escrow(&env, pass_id, &buyer, &updated_escrow);
        } else {
            dispute.status = DisputeStatus::Rejected;
            // Move amount back from disputed to pending
            Storage::move_disputed_to_pending(&env, &escrow.asset, escrow.amount)?;
        }

        Storage::save_access_pass_dispute(&env, pass_id, &buyer, &dispute);
        InstanceStorage::clear_reentrancy_guard(&env);
        Events::emit_dispute_resolved(&env, pass_id as u64, buyer, refund);
        Ok(())
    }

    /// Settle (release funds from) a pending access pass purchase escrow.
    /// Similar to settle_purchase but for pass escrows (#564).
    fn settle_access_pass_purchase(
        env: Env,
        caller: Address,
        pass_id: u128,
        buyer: Address,
    ) -> Result<(), Error> {
        caller.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;

        InstanceStorage::set_reentrancy_guard(&env)?;

        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        let access_pass = Storage::require_access_pass(&env, pass_id)?;

        let mut escrow = Storage::require_access_pass_escrow(&env, pass_id, &buyer)?;
        ensure(
            escrow.status == SettlementStatus::Pending,
            Error::DisputeResolved,
        )?;

        // Check if there's an open dispute
        if let Some(dispute) = Storage::get_access_pass_dispute(&env, pass_id, &buyer) {
            ensure(
                dispute.status != DisputeStatus::Open,
                Error::DisputeAlreadyOpen,
            )?;
        }

        let now = env.ledger().timestamp();
        let is_privileged = caller == owner || caller == access_pass.creator;

        if !is_privileged {
            // Permissionless settlement only after dispute window closes
            ensure(
                now > escrow.dispute_deadline,
                Error::DisputeWindowNotElapsed,
            )?;
        }

        let this_contract = env.current_contract_address();
        let asset_client = token::StellarAssetClient::new(&env, &escrow.asset);
        let plan = &escrow.payout_plan;

        // Distribute funds according to payout plan
        if plan.fee_amount > 0 {
            asset_client.transfer(&this_contract, &plan.fee_wallet, &plan.fee_amount);
        }

        if plan.creator_amount > 0 {
            asset_client.transfer(&this_contract, &plan.creator, &plan.creator_amount);
        }

        // Remove from pending liability since it's now been paid out
        Storage::remove_pending_liability(&env, &escrow.asset, escrow.amount)?;

        escrow.status = SettlementStatus::Settled;
        escrow.settled_at = now;
        Storage::save_access_pass_escrow(&env, pass_id, &buyer, &escrow);
        InstanceStorage::clear_reentrancy_guard(&env);

        Events::emit_prompt_purchased(
            &env,
            pass_id as u64,
            buyer,
            plan.creator.clone(),
            escrow.amount,
            None,
        );
        Ok(())
    }

    fn get_prompts_by_creator(env: Env, creator: Address) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_prompts_by_creator(&env, &creator))
    }

    fn get_prompts_by_buyer(env: Env, buyer: Address) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_prompts_by_buyer(&env, &buyer))
    }

    /// Canonical, bounded fee-configuration entrypoint (#566). Both this
    /// function and the deprecated `update_platform_fee` alias route through
    /// `set_platform_fee_internal`, so every caller is held to the same
    /// `MAX_PLATFORM_FEE` ceiling and emits the same canonical event —
    /// neither entrypoint can be used to bypass the other's policy.
    #[only_owner]
    fn set_fee_percentage(env: Env, new_fee_percentage: u32) -> Result<(), Error> {
        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        set_platform_fee_internal(&env, owner, new_fee_percentage)
    }

    #[only_owner]
    fn set_fee_wallet(env: Env, new_fee_wallet: Address) -> Result<(), Error> {
        InstanceStorage::set_fee_wallet(&env, &new_fee_wallet);
        Events::emit_fee_wallet_updated(&env, new_fee_wallet);
        Ok(())
    }

    fn get_fee_percentage(env: Env) -> u32 {
        InstanceStorage::get_fee_percentage(&env)
    }

    fn get_fee_wallet(env: Env) -> Option<Address> {
        InstanceStorage::get_fee_wallet(&env)
    }

    /// Deprecated alias for `set_fee_percentage` (#566), kept because removing
    /// a public entrypoint is a breaking ABI change. Delegates to the same
    /// internal helper, so it enforces the identical bound/auth/event as the
    /// canonical entrypoint rather than a looser or divergent policy.
    #[only_owner]
    fn update_platform_fee(env: Env, admin: Address, new_fee: u32) -> Result<(), Error> {
        admin.require_auth();
        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        ensure(owner == admin, Error::Unauthorized)?;
        set_platform_fee_internal(&env, admin, new_fee)
    }

    fn get_platform_fee(env: Env) -> u32 {
        InstanceStorage::get_fee_percentage(&env)
    }

    /// One-time post-upgrade fix for deployments where the legacy
    /// `set_fee_percentage` (previously bounded only by `MAX_BPS`, i.e. up to
    /// 100%) left a stored fee above the now-unified `MAX_PLATFORM_FEE`
    /// ceiling. Clamps that value down; a no-op if it's already within
    /// bound, so it is safe to call repeatedly (#566).
    #[only_owner]
    fn migrate_platform_fee_bound(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        ensure(owner == admin, Error::Unauthorized)?;

        let current_fee = InstanceStorage::get_fee_percentage(&env);
        if current_fee <= MAX_PLATFORM_FEE {
            return Ok(());
        }
        set_platform_fee_internal(&env, admin, MAX_PLATFORM_FEE)
    }

    fn get_xlm_sac(env: Env) -> Option<Address> {
        InstanceStorage::get_xlm_address(&env)
    }

    fn get_prompts_by_ids(env: Env, prompt_ids: Vec<u64>) -> Result<Vec<Prompt>, Error> {
        let mut prompts = Vec::new(&env);
        for i in 0..prompt_ids.len() {
            let id = prompt_ids.get(i).unwrap();
            if let Ok(prompt) = Storage::require_prompt(&env, id) {
                prompts.push_back(prompt);
            }
        }
        Ok(prompts)
    }

    #[only_owner]
    fn set_pause_status(env: Env, paused: bool) -> Result<(), Error> {
        InstanceStorage::set_pause_status(&env, paused);
        Events::emit_contract_paused_state_changed(&env, paused);
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        InstanceStorage::is_paused(&env)
    }

    #[only_owner]
    fn set_referral_percentage(env: Env, new_referral_percentage: u32) -> Result<(), Error> {
        ensure(
            new_referral_percentage <= MAX_BPS,
            Error::InvalidReferralPercentage,
        )?;
        InstanceStorage::set_referral_percentage(&env, new_referral_percentage);
        Ok(())
    }

    fn get_referral_percentage(env: Env) -> u32 {
        InstanceStorage::get_referral_percentage(&env)
    }

    fn add_signed_discount_auth(
        env: Env,
        creator: Address,
        authorization: SignedDiscountAuthorization,
        signature: BytesN<64>,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(
            authorization.discount_bps <= MAX_BPS,
            Error::InvalidDiscountPercentage,
        )?;
        let prompt = Storage::require_prompt(&env, authorization.prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        // Verify domain separation
        let contract_id = current_contract_id_hash(&env);
        let network_id = env.ledger().network_id();
        ensure(
            authorization.network_id == network_id,
            Error::AuthorizationDomainMismatch,
        )?;
        ensure(
            authorization.contract_id == contract_id,
            Error::AuthorizationDomainMismatch,
        )?;

        // Verify expiry is in the future
        let now = env.ledger().sequence();
        ensure(
            authorization.expiry_ledger >= now,
            Error::AuthorizationExpired,
        )?;

        // Verify nonce not already registered (in case of re-submission)
        let registration_key =
            DataKey::NonceConsumed(authorization.prompt_id, authorization.nonce.clone());
        ensure(
            !env.storage().persistent().has(&registration_key),
            Error::AuthorizationNonceConsumed,
        )?;

        // `creator.require_auth()` above is the actual authentication for
        // this registration. Soroban's SDK explicitly discourages deriving
        // a raw Ed25519 key from an Address for custom signature
        // verification (the master key may not be a current signer), so
        // `signature` is accepted for client-side record-keeping parity
        // with `buy_prompt_with_auth` but is not independently re-verified.
        let _ = signature;

        // Store the authorization for later redemption during buy_prompt_with_auth
        env.storage()
            .persistent()
            .set(&registration_key, &authorization);
        Storage::extend_key_ttl(&env, &registration_key);

        Events::emit_signed_discount_added(
            &env,
            authorization.prompt_id,
            creator,
            authorization.discount_bps,
            authorization.nonce,
        );
        Ok(())
    }

    fn revoke_discount_auth(
        env: Env,
        creator: Address,
        prompt_id: u64,
        nonce: BytesN<32>,
    ) -> Result<(), Error> {
        creator.require_auth();
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        // Remove the registered authorization (if any) so it can no longer
        // be redeemed via `buy_prompt_with_auth`.
        let registration_key = DataKey::NonceConsumed(prompt_id, nonce.clone());
        env.storage().persistent().remove(&registration_key);

        Events::emit_signed_discount_revoked(&env, prompt_id, creator, nonce);
        Ok(())
    }

    // Legacy voucher methods — kept for backward compatibility during migration
    // but deprecated. Use `add_signed_discount_auth` for new authorizations.
    fn add_voucher(
        env: Env,
        creator: Address,
        prompt_id: u64,
        hashed_code: BytesN<32>,
        discount_bps: u32,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(discount_bps <= MAX_BPS, Error::InvalidDiscountPercentage)?;
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        Storage::add_voucher(&env, prompt_id, &hashed_code, discount_bps);
        Events::emit_voucher_added(&env, prompt_id, hashed_code, discount_bps);
        Ok(())
    }

    fn remove_voucher(
        env: Env,
        creator: Address,
        prompt_id: u64,
        hashed_code: BytesN<32>,
    ) -> Result<(), Error> {
        creator.require_auth();
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        Storage::remove_voucher(&env, prompt_id, &hashed_code);
        Events::emit_voucher_removed(&env, prompt_id, hashed_code);
        Ok(())
    }

    #[only_owner]
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        env.storage().instance().extend_ttl(
            super::storage::PERSISTENT_LIFETIME_THRESHOLD,
            super::storage::PERSISTENT_BUMP_AMOUNT,
        );
        Storage::extend_all_ttl(&env);
        Ok(())
    }

    fn extend_ttl(env: Env, key: DataKey) -> Result<(), Error> {
        Storage::extend_key_ttl(&env, &key);
        Ok(())
    }

    #[only_owner]
    fn extend_all_ttl(env: Env) -> Result<(), Error> {
        Storage::extend_all_ttl(&env);
        Ok(())
    }

    fn get_asset_liability(env: Env, asset: Address) -> AssetLiability {
        Storage::get_asset_liability(&env, &asset)
    }

    fn get_asset_solvency(env: Env, asset: Address) -> AssetSolvency {
        compute_asset_solvency(&env, &asset)
    }

    /// Permissionless invariant check: compares tracked liability against the
    /// contract's actual SAC balance for `asset` and pauses the contract if
    /// the balance no longer covers what's owed (#570). Intended to be
    /// callable by an off-chain operational monitor on a schedule, not just
    /// the owner — catching drift early matters more than gating who can look.
    fn check_asset_solvency(env: Env, asset: Address) -> Result<AssetSolvency, Error> {
        let solvency = compute_asset_solvency(&env, &asset);
        if solvency.surplus < 0 {
            InstanceStorage::set_pause_status(&env, true);
            Events::emit_contract_paused_state_changed(&env, true);
            Events::emit_solvency_violation_detected(
                &env,
                asset,
                solvency.tracked_liability,
                solvency.actual_balance,
            );
        }
        Ok(solvency)
    }

    /// One-time backfill for a deployment upgrading into this feature: adds a
    /// single pre-existing Pending/Disputed escrow's amount into the
    /// per-asset liability ledger. A no-op (Ok) if this exact escrow was
    /// already migrated, so it is safe to retry (#570).
    #[only_owner]
    fn migrate_asset_liability(
        env: Env,
        admin: Address,
        prompt_id: u64,
        buyer: Address,
    ) -> Result<(), Error> {
        admin.require_auth();
        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        ensure(owner == admin, Error::Unauthorized)?;

        if Storage::is_escrow_liability_migrated(&env, prompt_id, &buyer) {
            return Ok(());
        }

        let escrow = Storage::require_purchase_escrow(&env, prompt_id, &buyer)?;
        if escrow.status == SettlementStatus::Pending {
            let dispute_open = Storage::get_dispute(&env, prompt_id, &buyer)
                .map(|d| d.status == DisputeStatus::Open)
                .unwrap_or(false);
            if dispute_open {
                Storage::add_disputed_liability(&env, &escrow.asset, escrow.amount)?;
            } else {
                Storage::add_pending_liability(&env, &escrow.asset, escrow.amount)?;
            }
        }
        Storage::mark_escrow_liability_migrated(&env, prompt_id, &buyer);
        Ok(())
    }
}

#[contractimpl(contracttrait)]
impl Ownable for PromptHashContract {}

/// Single write path for the platform fee (#566). `set_fee_percentage`,
/// `update_platform_fee`, and `migrate_platform_fee_bound` all delegate here
/// so the bound, storage key, and emitted event can never diverge between
/// entrypoints.
fn set_platform_fee_internal(env: &Env, actor: Address, new_fee: u32) -> Result<(), Error> {
    ensure(new_fee <= MAX_PLATFORM_FEE, Error::FeeExceedsMaximum)?;
    let old_fee = InstanceStorage::get_fee_percentage(env);
    InstanceStorage::set_fee_percentage(env, &new_fee);
    Events::emit_platform_fee_updated(env, old_fee, new_fee, actor, env.ledger().sequence());
    Ok(())
}

/// Compares tracked per-asset liability against the contract's actual SAC
/// balance for `asset` (#570). `surplus` is the excess above what's owed —
/// rounding dust or an accidental direct transfer, not customer liability —
/// and goes negative only if the balance no longer covers tracked liability.
fn compute_asset_solvency(env: &Env, asset: &Address) -> AssetSolvency {
    let liability = Storage::get_asset_liability(env, asset);
    let tracked_liability = liability.pending.saturating_add(liability.disputed);
    let actual_balance = token::Client::new(env, asset).balance(&env.current_contract_address());
    AssetSolvency {
        tracked_liability,
        actual_balance,
        surplus: actual_balance.saturating_sub(tracked_liability),
    }
}

fn execute_buy(
    env: &Env,
    buyer: &Address,
    prompt_id: u64,
    referrer: &Option<Address>,
    payment_amount_stroops: i128,
    voucher: Option<Bytes>,
) -> Result<(), Error> {
    let prompt = Storage::require_prompt(env, prompt_id)?;
    let now = env.ledger().timestamp();

    ensure(
        prompt.status == PromptSaleStatus::Active,
        Error::PromptInactive,
    )?;
    ensure(prompt.creator != *buyer, Error::CreatorCannotBuy)?;
    ensure(
        !Storage::has_active_purchase(env, prompt_id, buyer, now),
        Error::AlreadyPurchased,
    )?;

    if prompt.expires_at != 0 {
        ensure(prompt.expires_at >= now, Error::ListingExpired)?;
    }

    // Fail fast before spending gas on voucher validation; the actual
    // reservation is (re)computed against a fresh fetch in
    // `execute_buy_with_required_price`, which is also reachable directly
    // from `buy_prompt_with_auth`.
    reserve_supply(prompt.sales_count, prompt.max_supply)?;

    let mut required_price = prompt.price_stroops;
    if let Some(code) = voucher {
        let hashed_raw = env.crypto().sha256(&code);
        let hashed = BytesN::from_array(env, &hashed_raw.to_array());
        if let Some(discount_bps) = Storage::get_voucher(env, prompt_id, &hashed) {
            let discount_amount = required_price
                .checked_mul(discount_bps as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / MAX_BPS as i128;
            required_price = required_price
                .checked_sub(discount_amount)
                .ok_or(Error::ArithmeticOverflow)?;
            Storage::remove_voucher(env, prompt_id, &hashed);
        } else {
            return Err(Error::InvalidVoucher);
        }
    }

    ensure(
        payment_amount_stroops >= required_price,
        Error::InvalidPaymentAmount,
    )?;

    if let Some(ref r) = referrer {
        ensure(
            r != buyer && r != &prompt.creator,
            Error::ReferrerCannotBeBuyerOrCreator,
        )?;
    }

    execute_buy_with_required_price(
        env,
        buyer,
        prompt_id,
        referrer,
        payment_amount_stroops,
        required_price,
    )
}

/// Buy execution after all price and voucher validation is done.
/// Shared between `execute_buy` (legacy vouchers) and `buy_prompt_with_auth`
/// (signed discount authorizations).
fn execute_buy_with_required_price(
    env: &Env,
    buyer: &Address,
    prompt_id: u64,
    referrer: &Option<Address>,
    payment_amount_stroops: i128,
    required_price: i128,
) -> Result<(), Error> {
    let mut prompt = Storage::require_prompt(env, prompt_id)?;
    let reserved_sales_count = reserve_supply(prompt.sales_count, prompt.max_supply)?;

    InstanceStorage::set_reentrancy_guard(env)?;

    let this_contract = env.current_contract_address();

    let fee_percentage = InstanceStorage::get_fee_percentage(env);
    ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

    let fee_amount = payment_amount_stroops
        .checked_mul(fee_percentage as i128)
        .ok_or(Error::ArithmeticOverflow)?
        / MAX_BPS as i128;

    let referral_percentage = InstanceStorage::get_referral_percentage(env);
    let referral_amount = if referrer.is_some() {
        payment_amount_stroops
            .checked_mul(referral_percentage as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128
    } else {
        0
    };

    let deductions = fee_amount
        .checked_add(referral_amount)
        .ok_or(Error::ArithmeticOverflow)?;

    let mut split_total: i128 = 0;
    for i in 0..prompt.splits.len() {
        let split = prompt.splits.get(i).unwrap();
        let split_amount = payment_amount_stroops
            .checked_mul(split.bps as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        split_total = split_total
            .checked_add(split_amount)
            .ok_or(Error::ArithmeticOverflow)?;
    }

    let total_deductions = deductions
        .checked_add(split_total)
        .ok_or(Error::ArithmeticOverflow)?;
    let creator_amount = payment_amount_stroops
        .checked_sub(total_deductions)
        .ok_or(Error::ArithmeticOverflow)?;

    ensure(creator_amount >= 0, Error::InvalidSplits)?;

    let asset_client = token::StellarAssetClient::new(env, &prompt.asset);

    // Route the full payment through the contract so it holds
    // escrow for dispute refunds (#454).  The buyer must have
    // approved the contract for at least `payment_amount_stroops`.
    asset_client.transfer_from(
        &this_contract,
        buyer,
        &this_contract,
        &payment_amount_stroops,
    );

    // All funds are held in the contract.  No distribution occurs
    // here — `settle_purchase` releases them to the creator, fee wallet,
    // referrer, and split recipients, or a dispute refund returns them
    // to the buyer.
    prompt.sales_count = reserved_sales_count;
    Storage::update_prompt(env, &prompt);
    Storage::grant_purchase(
        env,
        &prompt,
        buyer,
        payment_amount_stroops,
        MAX_ACCESS_EXPIRY,
    );

    // Escrow is created as Pending — the creator's share is held in
    // the contract until `settle_purchase` is called (#454).
    let now = env.ledger().timestamp();
    let fee_wallet = InstanceStorage::get_fee_wallet(env).ok_or(Error::FeeWalletNotSet)?;

    // Snapshot the complete payout plan at purchase time (#562).
    let mut payout_splits: Vec<super::types::PayoutSplit> = Vec::new(env);
    let mut split_total: i128 = 0;
    for i in 0..prompt.splits.len() {
        let split = prompt.splits.get(i).unwrap();
        let split_amount = payment_amount_stroops
            .checked_mul(split.bps as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        split_total = split_total
            .checked_add(split_amount)
            .ok_or(Error::ArithmeticOverflow)?;
        if split_amount > 0 {
            payout_splits.push_back(super::types::PayoutSplit {
                recipient: split.recipient.clone(),
                amount: split_amount,
            });
        }
    }

    let payout_plan = super::types::PayoutPlan {
        creator: prompt.creator.clone(),
        fee_wallet: fee_wallet.clone(),
        fee_amount,
        referrer: referrer.clone(),
        referral_amount,
        splits: payout_splits,
        creator_amount,
    };

    let escrow = PurchaseEscrow {
        prompt_id,
        buyer: buyer.clone(),
        amount: payment_amount_stroops,
        asset: prompt.asset.clone(),
        referrer: referrer.clone(),
        status: SettlementStatus::Pending,
        created_at: now,
        settled_at: 0,
        dispute_deadline: now
            .checked_add(DISPUTE_WINDOW_SECS)
            .ok_or(Error::ArithmeticOverflow)?,
        creator_amount,
        fee_amount,
        referral_amount,
        payout_plan,
    };
    Storage::save_purchase_escrow(env, &escrow);
    // Escrow was just created Pending — its full amount is now tracked
    // liability for this asset until settled or refunded (#570).
    Storage::add_pending_liability(env, &escrow.asset, escrow.amount)?;

    InstanceStorage::clear_reentrancy_guard(env);

    Events::emit_prompt_purchased(
        env,
        prompt_id,
        buyer.clone(),
        prompt.creator,
        payment_amount_stroops,
        referrer.clone(),
    );

    if payment_amount_stroops > required_price {
        Events::emit_prompt_tipped(
            env,
            prompt_id,
            buyer.clone(),
            payment_amount_stroops - required_price,
        );
    }

    Ok(())
}

// ─── Supply accounting ─────────────────────────────────────────────────────
//
// Every acquisition path that grants a new unit of access (direct purchase,
// bulk purchase, lease, bundle) must reserve supply through these helpers so
// `max_supply` means the same thing everywhere (#538). Resale
// (`transfer_license`) intentionally does not call these — it moves an
// already-reserved unit between owners rather than minting a new one.

/// Atomically check-and-reserve one unit of a prompt's capped supply.
/// `max_supply == 0` means unlimited.
fn reserve_supply(sales_count: u64, max_supply: u64) -> Result<u64, Error> {
    if max_supply > 0 {
        ensure(sales_count < max_supply, Error::MaxSupplyReached)?;
    }
    sales_count.checked_add(1).ok_or(Error::ArithmeticOverflow)
}

/// Same as [`reserve_supply`] for access passes, whose counters are `u32`.
fn reserve_pass_supply(sales_count: u32, max_supply: u32) -> Result<u32, Error> {
    if max_supply > 0 {
        ensure(sales_count < max_supply, Error::MaxSupplyReached)?;
    }
    sales_count.checked_add(1).ok_or(Error::ArithmeticOverflow)
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/// Validate that the sum of all split basis-points does not exceed
/// MAX_BPS minus the current platform fee, ensuring the creator always
/// receives a non-negative payout.
fn route_creator_payment(
    env: &Env,
    payer: &Address,
    creator: &Address,
    asset: &Address,
    payment_amount_stroops: i128,
) -> Result<(), Error> {
    ensure(payment_amount_stroops > 0, Error::InvalidPaymentAmount)?;

    let fee_wallet = InstanceStorage::get_fee_wallet(env).ok_or(Error::FeeWalletNotSet)?;
    let fee_percentage = InstanceStorage::get_fee_percentage(env);
    ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

    let fee_amount = payment_amount_stroops
        .checked_mul(fee_percentage as i128)
        .ok_or(Error::ArithmeticOverflow)?
        / MAX_BPS as i128;
    let creator_amount = payment_amount_stroops
        .checked_sub(fee_amount)
        .ok_or(Error::ArithmeticOverflow)?;

    let this_contract = env.current_contract_address();
    let asset_client = token::StellarAssetClient::new(env, asset);
    if creator_amount > 0 {
        asset_client.transfer_from(&this_contract, payer, creator, &creator_amount);
    }
    if fee_amount > 0 {
        asset_client.transfer_from(&this_contract, payer, &fee_wallet, &fee_amount);
    }
    Ok(())
}

fn validate_splits(env: &Env, splits: &Vec<Split>) -> Result<(), Error> {
    let fee_percentage = InstanceStorage::get_fee_percentage(env);
    let mut total_bps: u32 = 0;
    for i in 0..splits.len() {
        let split = splits.get(i).unwrap();
        ensure(split.bps > 0, Error::InvalidSplits)?;
        total_bps = total_bps
            .checked_add(split.bps)
            .ok_or(Error::ArithmeticOverflow)?;
    }
    let total = total_bps
        .checked_add(fee_percentage)
        .ok_or(Error::ArithmeticOverflow)?;
    ensure(total <= MAX_BPS, Error::InvalidSplits)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_prompt_fields(
    image_url: &String,
    title: &String,
    category: &String,
    preview_text: &String,
    encrypted_prompt: &String,
    encryption_iv: &String,
    wrapped_key: &String,
    price_stroops: i128,
) -> Result<(), Error> {
    ensure(price_stroops > 0, Error::InvalidPrice)?;
    validate_len(image_url, MAX_IMAGE_URL_LEN, Error::InvalidImageUrlLength)?;
    validate_len(title, MAX_TITLE_LEN, Error::InvalidTitleLength)?;
    validate_len(category, MAX_CATEGORY_LEN, Error::InvalidCategoryLength)?;
    validate_len(preview_text, MAX_PREVIEW_LEN, Error::InvalidPreviewLength)?;
    validate_len(
        encrypted_prompt,
        MAX_ENCRYPTED_PROMPT_LEN,
        Error::InvalidEncryptedPromptLength,
    )?;
    validate_len(
        wrapped_key,
        MAX_WRAPPED_KEY_LEN,
        Error::InvalidWrappedKeyLength,
    )?;
    validate_len(encryption_iv, MAX_IV_LEN, Error::InvalidIvLength)?;
    Ok(())
}

fn validate_tags(tags: &Vec<String>) -> Result<(), Error> {
    ensure(tags.len() <= MAX_TAGS, Error::InvalidCategoryLength)?;
    for i in 0..tags.len() {
        let tag = tags.get(i).unwrap();
        validate_len(&tag, MAX_TAG_LEN, Error::InvalidCategoryLength)?;
        for j in (i + 1)..tags.len() {
            ensure(tag != tags.get(j).unwrap(), Error::InvalidCategoryLength)?;
        }
    }
    Ok(())
}

fn validate_no_duplicate_recipients(splits: &Vec<Split>) -> Result<(), Error> {
    for i in 0..splits.len() {
        for j in (i + 1)..splits.len() {
            let a = splits.get(i).unwrap();
            let b = splits.get(j).unwrap();
            ensure(a.recipient != b.recipient, Error::DuplicateSplitRecipient)?;
        }
    }
    Ok(())
}

/**
 * Dry-run validation for bulk purchases (#438).
 * Validates each prompt ID without state mutation, returns per-item validity.
 * Frontend uses this to filter invalid IDs before submitting the bulk purchase.
 */
fn validate_bulk_purchase_items(
    env: &Env,
    buyer: &Address,
    prompt_ids: &Vec<u64>,
    payment_amounts: &Vec<i128>,
) -> Result<Vec<bool>, Error> {
    ensure(
        prompt_ids.len() == payment_amounts.len(),
        Error::InvalidPrice,
    )?;
    ensure(
        !prompt_ids.is_empty() && prompt_ids.len() <= MAX_BULK_PURCHASE_SIZE,
        Error::BulkPurchaseTooLarge,
    )?;
    validate_no_duplicate_prompt_ids(prompt_ids)?;

    let mut validity = Vec::new(env);
    let now = env.ledger().timestamp();

    for i in 0..prompt_ids.len() {
        let prompt_id = prompt_ids.get(i).unwrap();
        let payment_amount = payment_amounts.get(i).unwrap();

        // Check each condition independently; record true if all pass
        let is_valid = match Storage::get_prompt(env, prompt_id) {
            Some(prompt) => {
                prompt.status == PromptSaleStatus::Active
                    && prompt.creator != *buyer
                    && !Storage::has_active_purchase(env, prompt_id, buyer, now)
                    && (prompt.expires_at == 0 || prompt.expires_at >= now)
                    && payment_amount >= prompt.price_stroops
                    && reserve_supply(prompt.sales_count, prompt.max_supply).is_ok()
            }
            None => false,
        };

        validity.push_back(is_valid);
    }

    Ok(validity)
}

fn validate_no_duplicate_prompt_ids(prompt_ids: &Vec<u64>) -> Result<(), Error> {
    for i in 0..prompt_ids.len() {
        for j in (i + 1)..prompt_ids.len() {
            ensure(
                prompt_ids.get(i).unwrap() != prompt_ids.get(j).unwrap(),
                Error::DuplicatePromptId,
            )?;
        }
    }
    Ok(())
}

fn validate_len(value: &String, max_len: u32, error: Error) -> Result<(), Error> {
    ensure(!value.is_empty() && value.len() <= max_len, error)
}

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}

/// A stable per-contract domain-separation value for signed authorizations
/// (#540/#565). There is no plain-build API for a contract's raw identity
/// hash, so this hashes the current contract address's string encoding —
/// available without enabling the SDK's `hazmat-address` feature.
pub fn current_contract_id_hash(env: &Env) -> BytesN<32> {
    env.crypto()
        .sha256(&env.current_contract_address().to_string().to_bytes())
        .to_bytes()
}
