use super::events::Events;
use super::storage::Storage;
use super::types::{Error, Prompt, PromptHashTrait};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String, Vec};
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
        price_stroops: i128,
    ) -> Result<u128, Error> {
        creator.require_auth();
        validate_prompt_fields(
            &image_url,
            &title,
            &category,
            &preview_text,
            &encrypted_prompt,
            &encryption_iv,
            &wrapped_key,
            price_stroops,
        )?;

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
            price_stroops,
            active: true,
            sales_count: 0,
        };

        Storage::save_prompt(&env, &prompt)?;
        Storage::add_prompt_to_creator(&env, &creator, prompt_id);
        Events::emit_prompt_created(&env, prompt_id, creator, price_stroops);
        Ok(prompt_id)
    }

    fn set_prompt_sale_status(
        env: Env,
        creator: Address,
        prompt_id: u128,
        active: bool,
    ) -> Result<(), Error> {
        creator.require_auth();
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        prompt.active = active;
        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_sale_status_updated(&env, prompt_id, active);
        Ok(())
    }

    fn update_prompt_price(
        env: Env,
        creator: Address,
        prompt_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(price_stroops > 0, Error::InvalidPrice)?;

        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        prompt.price_stroops = price_stroops;

        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_price_updated(&env, prompt_id, price_stroops);
        Ok(())
    }

    fn buy_prompt(env: Env, buyer: Address, prompt_id: u128) -> Result<(), Error> {
        buyer.require_auth();
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;

        ensure(prompt.active, Error::PromptInactive)?;
        ensure(prompt.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(!Storage::has_purchase(&env, prompt_id, &buyer), Error::AlreadyPurchased)?;

        Storage::set_reentrancy_guard(&env)?;

        let fee_wallet = Storage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;
        let this_contract = env.current_contract_address();
        let fee_percentage = Storage::get_fee_percentage(&env);
        ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

        let fee_amount = prompt
            .price_stroops
            .checked_mul(fee_percentage as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        let seller_amount = prompt
            .price_stroops
            .checked_sub(fee_amount)
            .ok_or(Error::ArithmeticOverflow)?;

        let xlm = Storage::get_stellar_asset_contract(&env)?;
        xlm.transfer_from(&this_contract, &buyer, &prompt.creator, &seller_amount);
        if fee_amount > 0 {
            xlm.transfer_from(&this_contract, &buyer, &fee_wallet, &fee_amount);
        }

        prompt.sales_count = prompt
            .sales_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        Storage::update_prompt(&env, &prompt);
        Storage::grant_purchase(&env, prompt_id, &buyer);
        Storage::clear_reentrancy_guard(&env);
        Events::emit_prompt_purchased(
            &env,
            prompt_id,
            buyer,
            prompt.creator,
            prompt.price_stroops,
        );
        Ok(())
    }

    fn has_access(env: Env, user: Address, prompt_id: u128) -> Result<bool, Error> {
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        Ok(prompt.creator == user || Storage::has_purchase(&env, prompt_id, &user))
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

    #[only_owner]
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[default_impl]
#[contractimpl]
impl Ownable for PromptHashContract {}

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
    validate_len(wrapped_key, MAX_WRAPPED_KEY_LEN, Error::InvalidWrappedKeyLength)?;
    validate_len(encryption_iv, MAX_IV_LEN, Error::InvalidIvLength)?;
    Ok(())
}

fn validate_len(value: &String, max_len: u32, error: Error) -> Result<(), Error> {
    ensure(value.len() > 0 && value.len() <= max_len, error)
}

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}
