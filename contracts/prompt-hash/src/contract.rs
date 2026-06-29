use super::events::Events;
use super::storage::{InstanceStorage, Storage};
use super::types::{
    DataKey, DisputeReason, DisputeStatus, Error, InstanceDataKey, ListingConfig,
    ListingRevisionRecord, Prompt, PromptHashTrait, PurchaseDispute, Split,
};
use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env, String, Vec};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::{default_impl, only_owner};

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

    #[allow(clippy::too_many_arguments)]
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
            encrypted_prompt,
            encryption_iv,
            wrapped_key,
            content_hash,
            price_stroops: listing.price,
            asset: listing.asset.clone(),
            active: true,
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
        active: bool,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        prompt.active = active;
        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_sale_status_updated(&env, prompt_id, active);
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
        prompt.max_supply = max_supply;
        Storage::update_prompt(&env, &prompt);
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

        ensure(prompt.active, Error::PromptInactive)?;
        ensure(prompt.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(lease_duration_secs > 0, Error::InvalidPrice)?;
        ensure(
            !Storage::has_active_purchase(&env, prompt_id, &buyer, now),
            Error::AlreadyPurchased,
        )?;

        if prompt.expires_at != 0 {
            ensure(prompt.expires_at >= now, Error::ListingExpired)?;
        }

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

        let asset_client = token::StellarAssetClient::new(&env, &prompt.asset);
        asset_client.transfer_from(&this_contract, &buyer, &prompt.creator, &seller_amount);
        if fee_amount > 0 {
            asset_client.transfer_from(&this_contract, &buyer, &fee_wallet, &fee_amount);
        }

        prompt.sales_count = prompt
            .sales_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        let expires_at = now
            .checked_add(lease_duration_secs)
            .ok_or(Error::ArithmeticOverflow)?;
        Storage::update_prompt(&env, &prompt);
        Storage::grant_purchase(&env, &prompt, &buyer, lease_price, expires_at);
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

        for i in 0..prompt_ids.len() {
            let prompt_id = prompt_ids.get(i).unwrap();
            let payment_amount = payment_amounts.get(i).unwrap();
            execute_buy(&env, &buyer, prompt_id, &referrer, payment_amount, None)?;
        }
        Ok(())
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
        Ok(prompt.creator == user || Storage::has_active_purchase(&env, prompt_id, &user, now))
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

    fn open_dispute(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        reason: DisputeReason,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!InstanceStorage::is_paused(&env), Error::ContractIsPaused)?;
        let now = env.ledger().timestamp();
        Storage::require_purchase(&env, prompt_id, &buyer)?;
        if let Some(dispute) = Storage::get_dispute(&env, prompt_id, &buyer) {
            ensure(
                dispute.status != DisputeStatus::Open,
                Error::DisputeAlreadyOpen,
            )?;
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
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        let purchase = Storage::require_purchase(&env, prompt_id, &buyer)?;
        let mut dispute = Storage::require_dispute(&env, prompt_id, &buyer)?;
        ensure(
            dispute.status == DisputeStatus::Open,
            Error::DisputeResolved,
        )?;
        dispute.resolved_at = env.ledger().timestamp();
        if refund {
            let asset_client = token::StellarAssetClient::new(&env, &prompt.asset);
            asset_client.transfer(
                &env.current_contract_address(),
                &buyer,
                &purchase.original_price,
            );
            Storage::remove_purchase(&env, prompt_id, &buyer);
            Storage::remove_prompt_from_buyer(&env, &buyer, prompt_id);
            dispute.status = DisputeStatus::Refunded;
        } else {
            dispute.status = DisputeStatus::Rejected;
        }
        Storage::save_dispute(&env, &dispute);
        Events::emit_dispute_resolved(&env, prompt_id, buyer, refund);
        Ok(())
    }

    fn get_dispute(env: Env, prompt_id: u64, buyer: Address) -> Result<PurchaseDispute, Error> {
        Storage::require_dispute(&env, prompt_id, &buyer)
    }

    fn get_prompts_by_creator(env: Env, creator: Address) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_prompts_by_creator(&env, &creator))
    }

    fn get_prompts_by_buyer(env: Env, buyer: Address) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_prompts_by_buyer(&env, &buyer))
    }

    #[only_owner]
    fn set_fee_percentage(env: Env, new_fee_percentage: u32) -> Result<(), Error> {
        ensure(new_fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;
        InstanceStorage::set_fee_percentage(&env, &new_fee_percentage);
        Events::emit_fee_updated(&env, new_fee_percentage);
        Ok(())
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

    #[only_owner]
    fn update_platform_fee(env: Env, admin: Address, new_fee: u32) -> Result<(), Error> {
        admin.require_auth();
        let owner = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        ensure(owner == admin, Error::Unauthorized)?;
        ensure(new_fee <= MAX_PLATFORM_FEE, Error::FeeExceedsMaximum)?;

        let old_fee = InstanceStorage::get_fee_percentage(&env);
        InstanceStorage::set_fee_percentage(&env, &new_fee);
        Events::emit_platform_fee_updated(&env, old_fee, new_fee, admin);
        Ok(())
    }

    fn get_platform_fee(env: Env) -> u32 {
        InstanceStorage::get_fee_percentage(&env)
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
}

#[default_impl]
#[contractimpl]
impl Ownable for PromptHashContract {}

fn execute_buy(
    env: &Env,
    buyer: &Address,
    prompt_id: u64,
    referrer: &Option<Address>,
    payment_amount_stroops: i128,
    voucher: Option<Bytes>,
) -> Result<(), Error> {
    let mut prompt = Storage::require_prompt(env, prompt_id)?;
    let now = env.ledger().timestamp();

    ensure(prompt.active, Error::PromptInactive)?;
    ensure(prompt.creator != *buyer, Error::CreatorCannotBuy)?;
    ensure(
        !Storage::has_active_purchase(env, prompt_id, buyer, now),
        Error::AlreadyPurchased,
    )?;

    if prompt.expires_at != 0 {
        ensure(prompt.expires_at >= now, Error::ListingExpired)?;
    }

    if prompt.max_supply > 0 {
        ensure(
            prompt.sales_count < prompt.max_supply,
            Error::MaxSupplyReached,
        )?;
    }

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

    InstanceStorage::set_reentrancy_guard(env)?;

    let fee_wallet = InstanceStorage::get_fee_wallet(env).ok_or(Error::FeeWalletNotSet)?;
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

    if creator_amount > 0 {
        asset_client.transfer_from(&this_contract, buyer, &prompt.creator, &creator_amount);
    }

    if fee_amount > 0 {
        asset_client.transfer_from(&this_contract, buyer, &fee_wallet, &fee_amount);
    }

    if let Some(ref r) = referrer {
        if referral_amount > 0 {
            asset_client.transfer_from(&this_contract, buyer, r, &referral_amount);
        }
    }

    for i in 0..prompt.splits.len() {
        let split = prompt.splits.get(i).unwrap();
        let split_amount = payment_amount_stroops
            .checked_mul(split.bps as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        if split_amount > 0 {
            asset_client.transfer_from(&this_contract, buyer, &split.recipient, &split_amount);
        }
    }

    prompt.sales_count = prompt
        .sales_count
        .checked_add(1)
        .ok_or(Error::ArithmeticOverflow)?;
    Storage::update_prompt(env, &prompt);
    Storage::grant_purchase(
        env,
        &prompt,
        buyer,
        payment_amount_stroops,
        MAX_ACCESS_EXPIRY,
    );
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
