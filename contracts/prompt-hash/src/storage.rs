use super::types::{DataKey, Error, Prompt};
use soroban_sdk::{token, Address, Env, Vec};

pub struct Storage;

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}

impl Storage {
    pub fn save_prompt(env: &Env, prompt: &Prompt) -> Result<(), Error> {
        env.storage()
            .persistent()
            .set(&DataKey::Prompt(prompt.id), prompt);
        let next_prompt_id = prompt.id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
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

    pub fn get_all_prompts(env: &Env) -> Vec<Prompt> {
        let prompt_count = Self::get_prompt_counter(env);
        let mut prompts = Vec::new(env);

        for prompt_id in 0..prompt_count {
            if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                prompts.push_back(prompt);
            }
        }

        prompts
    }

    pub fn get_prompts_by_creator(env: &Env, creator: &Address) -> Vec<Prompt> {
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&DataKey::CreatorPrompts(creator.clone()))
            .unwrap_or_else(|| Vec::new(env));

        Self::prompts_from_ids(env, ids)
    }

    pub fn get_prompts_by_buyer(env: &Env, buyer: &Address) -> Vec<Prompt> {
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&DataKey::BuyerPrompts(buyer.clone()))
            .unwrap_or_else(|| Vec::new(env));

        Self::prompts_from_ids(env, ids)
    }

    fn prompts_from_ids(env: &Env, ids: Vec<u128>) -> Vec<Prompt> {
        let mut prompts = Vec::new(env);

        for index in 0..ids.len() {
            let prompt_id = ids.get(index).unwrap();
            if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                prompts.push_back(prompt);
            }
        }

        prompts
    }

    pub fn add_prompt_to_creator(env: &Env, creator: &Address, prompt_id: u128) {
        let key = DataKey::CreatorPrompts(creator.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
    }

    pub fn add_prompt_to_buyer(env: &Env, buyer: &Address, prompt_id: u128) {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
    }

    pub fn has_purchase(env: &Env, prompt_id: u128, buyer: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Purchase(prompt_id, buyer.clone()))
            .unwrap_or(false)
    }

    pub fn grant_purchase(env: &Env, prompt_id: u128, buyer: &Address) {
        env.storage()
            .persistent()
            .set(&DataKey::Purchase(prompt_id, buyer.clone()), &true);
        Self::add_prompt_to_buyer(env, buyer, prompt_id);
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

    pub fn set_reentrancy_guard(env: &Env) -> Result<(), Error> {
        let already_set = env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Reentrancy)
            .unwrap_or(false);
        ensure(!already_set, Error::ReentrancyGuard)?;
        env.storage()
            .persistent()
            .set(&DataKey::Reentrancy, &true);
        Ok(())
    }

    pub fn clear_reentrancy_guard(env: &Env) {
        env.storage()
            .persistent()
            .set(&DataKey::Reentrancy, &false);
    }
}
