use super::types::{DataKey, Error, Prompt};
use soroban_sdk::{token, Address, Env, Vec};

const DAY_IN_LEDGERS: u32 = 17280;
const INSTANCE_TTL_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const INSTANCE_TTL_EXTEND: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_TTL_EXTEND: u32 = 180 * DAY_IN_LEDGERS;

pub struct Storage;

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}

impl Storage {
    pub fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }

    pub fn extend_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
    }

    pub fn save_prompt(env: &Env, prompt: &Prompt) -> Result<(), Error> {
        let key = DataKey::Prompt(prompt.id);
        env.storage().persistent().set(&key, prompt);
        Self::extend_persistent_ttl(env, &key);

        let next_prompt_id = prompt.id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        env.storage()
            .instance()
            .set(&DataKey::PromptCounter, &next_prompt_id);
        Self::extend_instance_ttl(env);
        Ok(())
    }

    pub fn get_prompt(env: &Env, prompt_id: u128) -> Option<Prompt> {
        let key = DataKey::Prompt(prompt_id);
        let prompt = env.storage().persistent().get(&key);
        if prompt.is_some() {
            Self::extend_persistent_ttl(env, &key);
        }
        prompt
    }

    pub fn require_prompt(env: &Env, prompt_id: u128) -> Result<Prompt, Error> {
        Self::get_prompt(env, prompt_id).ok_or(Error::PromptNotFound)
    }

    pub fn update_prompt(env: &Env, prompt: &Prompt) {
        let key = DataKey::Prompt(prompt.id);
        env.storage().persistent().set(&key, prompt);
        Self::extend_persistent_ttl(env, &key);
    }

    pub fn get_prompt_counter(env: &Env) -> u128 {
        Self::extend_instance_ttl(env);
        env.storage()
            .instance()
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
        let key = DataKey::CreatorPrompts(creator.clone());
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));

        if ids.len() > 0 {
            Self::extend_persistent_ttl(env, &key);
        }

        Self::prompts_from_ids(env, ids)
    }

    pub fn get_prompts_by_buyer(env: &Env, buyer: &Address) -> Vec<Prompt> {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));

        if ids.len() > 0 {
            Self::extend_persistent_ttl(env, &key);
        }

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
        Self::extend_persistent_ttl(env, &key);
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
        Self::extend_persistent_ttl(env, &key);
    }

    pub fn has_purchase(env: &Env, prompt_id: u128, buyer: &Address) -> bool {
        let key = DataKey::Purchase(prompt_id, buyer.clone());
        let purchased = env.storage().persistent().get(&key).unwrap_or(false);
        if purchased {
            Self::extend_persistent_ttl(env, &key);
        }
        purchased
    }

    pub fn grant_purchase(env: &Env, prompt_id: u128, buyer: &Address) {
        let key = DataKey::Purchase(prompt_id, buyer.clone());
        env.storage().persistent().set(&key, &true);
        Self::extend_persistent_ttl(env, &key);
        Self::add_prompt_to_buyer(env, buyer, prompt_id);
    }

    pub fn set_fee_percentage(env: &Env, fee_percentage: &u32) {
        env.storage()
            .instance()
            .set(&DataKey::FeePercentage, fee_percentage);
        Self::extend_instance_ttl(env);
    }

    pub fn get_fee_percentage(env: &Env) -> u32 {
        Self::extend_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::FeePercentage)
            .unwrap_or(0)
    }

    pub fn set_fee_wallet(env: &Env, fee_wallet: &Address) {
        env.storage()
            .instance()
            .set(&DataKey::FeeWallet, fee_wallet);
        Self::extend_instance_ttl(env);
    }

    pub fn get_fee_wallet(env: &Env) -> Option<Address> {
        Self::extend_instance_ttl(env);
        env.storage().instance().get(&DataKey::FeeWallet)
    }

    pub fn set_xlm_address(env: &Env, xlm_address: &Address) {
        env.storage()
            .instance()
            .set(&DataKey::XlmAddress, xlm_address);
        Self::extend_instance_ttl(env);
    }

    pub fn get_xlm_address(env: &Env) -> Option<Address> {
        Self::extend_instance_ttl(env);
        env.storage().instance().get(&DataKey::XlmAddress)
    }

    pub fn get_stellar_asset_contract(
        env: &'_ Env,
    ) -> Result<token::StellarAssetClient<'_>, Error> {
        let contract_id = Self::get_xlm_address(env).ok_or(Error::XlmAddressNotSet)?;
        Ok(token::StellarAssetClient::new(env, &contract_id))
    }

    pub fn set_reentrancy_guard(env: &Env) -> Result<(), Error> {
        let already_set = env
            .storage()
            .temporary()
            .get::<_, bool>(&DataKey::Reentrancy)
            .unwrap_or(false);
        ensure(!already_set, Error::ReentrancyGuard)?;
        env.storage().temporary().set(&DataKey::Reentrancy, &true);
        Ok(())
    }

    pub fn clear_reentrancy_guard(env: &Env) {
        env.storage().temporary().set(&DataKey::Reentrancy, &false);
    }
}
