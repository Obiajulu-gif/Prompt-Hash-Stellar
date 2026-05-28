use super::events::Events;
use super::storage::Storage;
use super::types::{DataKey, Error, PricingConfig, Prompt, PromptHashTrait};
use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env, String, Vec};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::{default_impl, only_owner};

const DEFAULT_FEE_BPS: u32 = 500;
const MAX_BPS: u32 = 10_000;
const MAX_TITLE_LEN: u32 = 120;
const MAX_CATEGORY_LEN: u32 = 40;
const MAX_PREVIEW_LEN: u32 = 280;
const MAX_ENCRYPTED_PROMPT_LEN: u32 = 4096;
const MAX_WRAPPED_KEY_LEN: u32 = 256;
const MAX_IMAGE_URL_LEN: u32 = 512;
const MAX_IV_LEN: u32 = 64;
const LEASE_PRICE_BPS: u32 = 4_000;
const MAX_ACCESS_EXPIRY: u64 = u64::MAX;

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
        Storage::set_fee_wallet(&env, &fee_wallet);
        Storage::set_fee_percentage(&env, &DEFAULT_FEE_BPS);
        Storage::set_xlm_address(&env, &xlm_sac);
        Storage::set_pause_status(&env, false);
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
        pricing: PricingConfig,
    ) -> Result<u128, Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        validate_prompt_fields(
            &image_url,
            &title,
            &category,
            &preview_text,
            &encrypted_prompt,
            &encryption_iv,
            &wrapped_key,
            pricing.price,
        )?;

        // Validate that the asset address implements the token interface
        token::Client::new(&env, &pricing.asset).decimals();

        let prompt_id = Storage::get_prompt_counter(&env);
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
            price_stroops: pricing.price,
            asset: pricing.asset.clone(),
            active: true,
            sales_count: 0,
            max_supply: 0,
        };

        Storage::save_prompt(&env, &prompt)?;
        Storage::add_prompt_to_creator(&env, &creator, prompt_id);
        Events::emit_prompt_created(&env, prompt_id, creator, pricing.price, pricing.asset);
        Ok(prompt_id)
    }

    fn set_prompt_sale_status(
        env: Env,
        creator: Address,
        prompt_id: u128,
        active: bool,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
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
        prompt_id: u128,
        max_supply: u64,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        prompt.max_supply = max_supply;
        Storage::update_prompt(&env, &prompt);
        Ok(())
    }

    fn update_prompt_price(
        env: Env,
        creator: Address,
        prompt_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
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
        prompt_id: u128,
        referrer: Option<Address>,
        payment_amount_stroops: i128,
        voucher: Option<Bytes>,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();

        ensure(prompt.active, Error::PromptInactive)?;
        ensure(prompt.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(
            !Storage::has_active_purchase(&env, prompt_id, &buyer, now),
            Error::AlreadyPurchased,
        )?;

        // Enforce max supply (0 = unlimited)
        if prompt.max_supply > 0 {
            ensure(
                prompt.sales_count < prompt.max_supply,
                Error::MaxSupplyReached,
            )?;
        }

        // Apply voucher discount if provided
        let mut required_price = prompt.price_stroops;
        if let Some(code) = voucher {
            let hashed_raw = env.crypto().sha256(&code);
            let hashed = BytesN::from_array(&env, &hashed_raw.to_array());
            if let Some(discount_bps) = Storage::get_voucher(&env, prompt_id, &hashed) {
                let discount_amount = required_price
                    .checked_mul(discount_bps as i128)
                    .ok_or(Error::ArithmeticOverflow)?
                    / MAX_BPS as i128;
                required_price = required_price
                    .checked_sub(discount_amount)
                    .ok_or(Error::ArithmeticOverflow)?;
                Storage::remove_voucher(&env, prompt_id, &hashed);
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
                r != &buyer && r != &prompt.creator,
                Error::ReferrerCannotBeBuyerOrCreator,
            )?;
        }

        Storage::set_reentrancy_guard(&env)?;

        let fee_wallet = Storage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;
        let this_contract = env.current_contract_address();

        let fee_percentage = Storage::get_fee_percentage(&env);
        ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

        let fee_amount = payment_amount_stroops
            .checked_mul(fee_percentage as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;

        let referral_percentage = Storage::get_referral_percentage(&env);
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
        let creator_amount = payment_amount_stroops
            .checked_sub(deductions)
            .ok_or(Error::ArithmeticOverflow)?;

        let asset_client = token::StellarAssetClient::new(&env, &prompt.asset);

        asset_client.transfer_from(&this_contract, &buyer, &prompt.creator, &creator_amount);

        if fee_amount > 0 {
            asset_client.transfer_from(&this_contract, &buyer, &fee_wallet, &fee_amount);
        }

        if let Some(ref r) = referrer {
            if referral_amount > 0 {
                asset_client.transfer_from(&this_contract, &buyer, r, &referral_amount);
            }
        }

        prompt.sales_count = prompt
            .sales_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        Storage::update_prompt(&env, &prompt);
        Storage::grant_purchase(&env, prompt_id, &buyer, MAX_ACCESS_EXPIRY);
        Storage::clear_reentrancy_guard(&env);

        Events::emit_prompt_purchased(
            &env,
            prompt_id,
            buyer.clone(),
            prompt.creator,
            payment_amount_stroops,
            referrer,
        );

        if payment_amount_stroops > required_price {
            Events::emit_prompt_tipped(
                &env,
                prompt_id,
                buyer,
                payment_amount_stroops - required_price,
            );
        }

        Ok(())
    }

    fn lease_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u128,
        lease_duration_secs: u64,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();

        ensure(prompt.active, Error::PromptInactive)?;
        ensure(prompt.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(lease_duration_secs > 0, Error::InvalidPrice)?;
        ensure(
            !Storage::has_active_purchase(&env, prompt_id, &buyer, now),
            Error::AlreadyPurchased,
        )?;

        Storage::set_reentrancy_guard(&env)?;

        let fee_wallet = Storage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;
        let this_contract = env.current_contract_address();
        let fee_percentage = Storage::get_fee_percentage(&env);
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
        Storage::grant_purchase(&env, prompt_id, &buyer, expires_at);
        Storage::clear_reentrancy_guard(&env);
        Events::emit_prompt_purchased(&env, prompt_id, buyer, prompt.creator, lease_price, None);
        Ok(())
    }

    fn has_access(env: Env, user: Address, prompt_id: u128) -> Result<bool, Error> {
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();
        Ok(prompt.creator == user || Storage::has_active_purchase(&env, prompt_id, &user, now))
    }

    fn get_prompt(env: Env, prompt_id: u128) -> Result<Prompt, Error> {
        Storage::require_prompt(&env, prompt_id)
    }

    fn get_all_prompts(env: Env) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_all_prompts(&env))
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
        Storage::set_fee_percentage(&env, &new_fee_percentage);
        Events::emit_fee_updated(&env, new_fee_percentage);
        Ok(())
    }

    #[only_owner]
    fn set_fee_wallet(env: Env, new_fee_wallet: Address) -> Result<(), Error> {
        Storage::set_fee_wallet(&env, &new_fee_wallet);
        Events::emit_fee_wallet_updated(&env, new_fee_wallet);
        Ok(())
    }

    fn get_fee_percentage(env: Env) -> u32 {
        Storage::get_fee_percentage(&env)
    }

    fn get_fee_wallet(env: Env) -> Option<Address> {
        Storage::get_fee_wallet(&env)
    }

    fn get_xlm_sac(env: Env) -> Option<Address> {
        Storage::get_xlm_address(&env)
    }

    #[only_owner]
    fn set_pause_status(env: Env, paused: bool) -> Result<(), Error> {
        Storage::set_pause_status(&env, paused);
        Events::emit_contract_paused_state_changed(&env, paused);
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        Storage::is_paused(&env)
    }

    #[only_owner]
    fn set_referral_percentage(env: Env, new_referral_percentage: u32) -> Result<(), Error> {
        ensure(
            new_referral_percentage <= MAX_BPS,
            Error::InvalidReferralPercentage,
        )?;
        Storage::set_referral_percentage(&env, new_referral_percentage);
        Ok(())
    }

    fn get_referral_percentage(env: Env) -> u32 {
        Storage::get_referral_percentage(&env)
    }

    fn add_voucher(
        env: Env,
        creator: Address,
        prompt_id: u128,
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
        prompt_id: u128,
        hashed_code: BytesN<32>,
    ) -> Result<(), Error> {
        creator.require_auth();
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        Storage::remove_voucher(&env, prompt_id, &hashed_code);
        Events::emit_voucher_removed(&env, prompt_id, hashed_code);
        Ok(())
    }

    fn upgrade_contract(env: Env, admin: Address, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        require_admin_auth(&env, &admin)?;
        upgrade_current_contract(env, admin, new_wasm_hash);
        Ok(())
    }

    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        let admin = ownable::get_owner(&env).ok_or(Error::Unauthorized)?;
        admin.require_auth();
        upgrade_current_contract(env, admin, new_wasm_hash);
        Ok(())
    }

    fn extend_ttl(env: Env, key: DataKey) -> Result<(), Error> {
        Storage::extend_key_ttl(&env, &key);
        Ok(())
    }
}

#[default_impl]
#[contractimpl]
impl Ownable for PromptHashContract {}

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

fn require_admin_auth(env: &Env, admin: &Address) -> Result<(), Error> {
    let stored_admin = ownable::get_owner(env).ok_or(Error::Unauthorized)?;
    ensure(stored_admin == *admin, Error::Unauthorized)?;
    admin.require_auth();
    Ok(())
}

fn upgrade_current_contract(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
    env.deployer()
        .update_current_contract_wasm(new_wasm_hash.clone());
    env.storage().instance().extend_ttl(
        super::storage::PERSISTENT_LIFETIME_THRESHOLD,
        super::storage::PERSISTENT_BUMP_AMOUNT,
    );
    Events::emit_contract_upgraded(&env, admin, new_wasm_hash);
}
