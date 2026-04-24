//! Contract storage helpers.
//!
//! This module centralizes persistent storage access and enforces key invariants:
//! - Prompt ids are sequential and append-only (starting at `0`).
//! - Creator and buyer indexes are append-only vectors that preserve insertion order.

use super::types::{DataKey, Error, Prompt};
use soroban_sdk::{token, Address, Env, Vec};

pub struct Storage;

impl Storage {
    pub fn is_initialized(env: &Env) -> bool {
        match env.storage().persistent().get::<_, bool>(&DataKey::Initialized) {
            Some(value) => value,
            None => Self::get_fee_wallet(env).is_some() && Self::get_xlm_address(env).is_some(),
        }
    }

    pub fn set_initialized(env: &Env) -> Result<(), Error> {
        ensure(!Self::is_initialized(env), Error::AlreadyInitialized)?;
        env.storage().persistent().set(&DataKey::Initialized, &true);
        Ok(())
    }

    pub fn require_initialized(env: &Env) -> Result<(), Error> {
        ensure(Self::is_initialized(env), Error::ContractNotInitialized)
    }

    /// Saves a new prompt and bumps the prompt counter.
    ///
    /// Invariants:
    /// - `prompt.id` must equal the current prompt counter.
    /// - A prompt must not already exist at `prompt.id`.
    /// - The prompt counter is append-only and always equals the next prompt id.
    pub fn save_prompt(env: &Env, prompt: &Prompt) -> Result<(), Error> {
        let expected_prompt_id = Self::get_prompt_counter(env);
        ensure(prompt.id == expected_prompt_id, Error::StorageCorrupt)?;
        ensure(Self::get_prompt(env, prompt.id).is_none(), Error::PromptIdAlreadyExists)?;

        env.storage()
            .persistent()
            .set(&DataKey::Prompt(prompt.id), prompt);

        let next_prompt_id = expected_prompt_id
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        env.storage()
            .persistent()
            .set(&DataKey::PromptCounter, &next_prompt_id);
        Ok(())
    }

    pub fn get_prompt(env: &Env, prompt_id: u128) -> Option<Prompt> {
        env.storage().persistent().get(&DataKey::Prompt(prompt_id))
    }

    pub fn require_prompt(env: &Env, prompt_id: u128) -> Result<Prompt, Error> {
        Self::get_prompt(env, prompt_id).ok_or(Error::PromptNotFound)
    }

    pub fn update_prompt(env: &Env, prompt: &Prompt) {
        env.storage()
            .persistent()
            .set(&DataKey::Prompt(prompt.id), prompt);
    }

    pub fn get_prompt_counter(env: &Env) -> u128 {
        env.storage()
            .persistent()
            .get(&DataKey::PromptCounter)
            .unwrap_or(0)
    }

    pub fn get_all_prompts(env: &Env) -> Result<Vec<Prompt>, Error> {
        let prompt_count = Self::get_prompt_counter(env);
        let mut prompts = Vec::new(env);

        for prompt_id in 0..prompt_count {
            let prompt = Self::get_prompt(env, prompt_id).ok_or(Error::StorageCorrupt)?;
            prompts.push_back(prompt);
        }

        Ok(prompts)
    }

    pub fn get_prompts_by_creator(env: &Env, creator: &Address) -> Result<Vec<Prompt>, Error> {
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&DataKey::CreatorPrompts(creator.clone()))
            .unwrap_or_else(|| Vec::new(env));

        Self::prompts_from_ids(env, ids)
    }

    pub fn get_prompts_by_buyer(env: &Env, buyer: &Address) -> Result<Vec<Prompt>, Error> {
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&DataKey::BuyerPrompts(buyer.clone()))
            .unwrap_or_else(|| Vec::new(env));

        Self::prompts_from_ids(env, ids)
    }

    fn prompts_from_ids(env: &Env, ids: Vec<u128>) -> Result<Vec<Prompt>, Error> {
        let mut prompts = Vec::new(env);

        for index in 0..ids.len() {
            let prompt_id = ids.get(index).unwrap();
            let prompt = Self::get_prompt(env, prompt_id).ok_or(Error::StorageCorrupt)?;
            prompts.push_back(prompt);
        }

        Ok(prompts)
    }

    pub fn add_prompt_to_creator(env: &Env, creator: &Address, prompt_id: u128) -> Result<(), Error> {
        let key = DataKey::CreatorPrompts(creator.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));

        if ids.len() > 0 {
            let last_id = ids.get(ids.len() - 1).ok_or(Error::StorageCorrupt)?;
            ensure(prompt_id > last_id, Error::StorageCorrupt)?;
        }

        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Ok(())
    }

    pub fn add_prompt_to_buyer(env: &Env, buyer: &Address, prompt_id: u128) -> Result<(), Error> {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Ok(())
    }

    pub fn has_purchase(env: &Env, prompt_id: u128, buyer: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Purchase(prompt_id, buyer.clone()))
            .unwrap_or(false)
    }

    pub fn grant_purchase(env: &Env, prompt_id: u128, buyer: &Address) -> Result<(), Error> {
        ensure(
            !Self::has_purchase(env, prompt_id, buyer),
            Error::AlreadyPurchased,
        )?;
        env.storage()
            .persistent()
            .set(&DataKey::Purchase(prompt_id, buyer.clone()), &true);
        Self::add_prompt_to_buyer(env, buyer, prompt_id)?;
        Ok(())
    }

    pub fn set_fee_percentage(env: &Env, fee_percentage: &u32) {
        env.storage()
            .persistent()
            .set(&DataKey::FeePercentage, fee_percentage);
    }

    pub fn get_fee_percentage(env: &Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::FeePercentage)
            .unwrap_or(0)
    }

    pub fn set_fee_wallet(env: &Env, fee_wallet: &Address) {
        env.storage()
            .persistent()
            .set(&DataKey::FeeWallet, fee_wallet);
    }

    pub fn get_fee_wallet(env: &Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::FeeWallet)
    }

    pub fn set_xlm_address(env: &Env, xlm_address: &Address) {
        env.storage()
            .persistent()
            .set(&DataKey::XlmAddress, xlm_address);
    }

    pub fn get_xlm_address(env: &Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::XlmAddress)
    }

    pub fn get_stellar_asset_contract(env: &'_ Env) -> Result<token::StellarAssetClient<'_>, Error> {
        let contract_id = Self::get_xlm_address(env).ok_or(Error::XlmAddressNotSet)?;
        Ok(token::StellarAssetClient::new(env, &contract_id))
    }
}

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}
