use super::types::{DataKey, Error, Prompt, Purchase};
use soroban_sdk::{token, Address, Env, Vec};

pub const DAY_IN_LEDGERS: u32 = 17280;
pub const PERSISTENT_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;

pub struct Storage;

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}

impl Storage {
    pub fn extend_key_ttl(env: &Env, key: &DataKey) {
        if env.storage().persistent().has(key) {
            env.storage().persistent().extend_ttl(
                key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
    }

    pub fn save_prompt(env: &Env, prompt: &Prompt) -> Result<(), Error> {
        let key = DataKey::Prompt(prompt.id);
        env.storage().persistent().set(&key, prompt);
        Self::extend_key_ttl(env, &key);
        
        let counter_key = DataKey::PromptCounter;
        let next_prompt_id = prompt.id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        env.storage().persistent().set(&counter_key, &next_prompt_id);
        Self::extend_key_ttl(env, &counter_key);
        Ok(())
    }

    pub fn get_prompt(env: &Env, prompt_id: u128) -> Option<Prompt> {
        let key = DataKey::Prompt(prompt_id);
        if let Some(prompt) = env.storage().persistent().get(&key) {
            Self::extend_key_ttl(env, &key);
            Some(prompt)
        } else {
            None
        }
    }

    pub fn require_prompt(env: &Env, prompt_id: u128) -> Result<Prompt, Error> {
        Self::get_prompt(env, prompt_id).ok_or(Error::PromptNotFound)
    }

    pub fn update_prompt(env: &Env, prompt: &Prompt) {
        let key = DataKey::Prompt(prompt.id);
        env.storage().persistent().set(&key, prompt);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_prompt_counter(env: &Env) -> u128 {
        let key = DataKey::PromptCounter;
        let count = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        count
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
        let ids: Vec<u128> = env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        Self::prompts_from_ids(env, ids)
    }

    pub fn get_prompts_by_buyer(env: &Env, buyer: &Address) -> Vec<Prompt> {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let ids: Vec<u128> = env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
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
        let mut ids: Vec<u128> = env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env));
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn add_prompt_to_buyer(env: &Env, buyer: &Address, prompt_id: u128) {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u128> = env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env));
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_purchase(env: &Env, prompt_id: u128, buyer: &Address) -> Option<Purchase> {
        let key = DataKey::Purchase(prompt_id, buyer.clone());
        let purchase = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        purchase
    }

    pub fn has_active_purchase(env: &Env, prompt_id: u128, buyer: &Address, now: u64) -> bool {
        Self::get_purchase(env, prompt_id, buyer)
            .map(|purchase| purchase.expires_at >= now)
            .unwrap_or(false)
    }

    pub fn grant_purchase(env: &Env, prompt_id: u128, buyer: &Address, expires_at: u64) {
        let key = DataKey::Purchase(prompt_id, buyer.clone());
        let purchase = Purchase { expires_at };
        env.storage().persistent().set(&key, &purchase);
        Self::extend_key_ttl(env, &key);
        Self::add_prompt_to_buyer(env, buyer, prompt_id);
    }

    pub fn set_fee_percentage(env: &Env, fee_percentage: &u32) {
        let key = DataKey::FeePercentage;
        env.storage().persistent().set(&key, fee_percentage);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_fee_percentage(env: &Env) -> u32 {
        let key = DataKey::FeePercentage;
        let fee = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        fee
    }

    pub fn set_fee_wallet(env: &Env, fee_wallet: &Address) {
        let key = DataKey::FeeWallet;
        env.storage().persistent().set(&key, fee_wallet);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_fee_wallet(env: &Env) -> Option<Address> {
        let key = DataKey::FeeWallet;
        let wallet = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        wallet
    }

    pub fn set_xlm_address(env: &Env, xlm_address: &Address) {
        let key = DataKey::XlmAddress;
        env.storage().persistent().set(&key, xlm_address);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_xlm_address(env: &Env) -> Option<Address> {
        let key = DataKey::XlmAddress;
        let addr = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        addr
    }

    pub fn get_stellar_asset_contract(env: &'_ Env) -> Result<token::StellarAssetClient<'_>, Error> {
        let contract_id = Self::get_xlm_address(env).ok_or(Error::XlmAddressNotSet)?;
        Ok(token::StellarAssetClient::new(env, &contract_id))
    }

    pub fn set_reentrancy_guard(env: &Env) -> Result<(), Error> {
        let key = DataKey::Reentrancy;
        let already_set = env.storage().persistent().get::<_, bool>(&key).unwrap_or(false);
        ensure(!already_set, Error::ReentrancyGuard)?;
        env.storage().persistent().set(&key, &true);
        Self::extend_key_ttl(env, &key);
        Ok(())
    }

    pub fn clear_reentrancy_guard(env: &Env) {
        let key = DataKey::Reentrancy;
        env.storage().persistent().set(&key, &false);
        Self::extend_key_ttl(env, &key);
    }

    pub fn set_pause_status(env: &Env, is_paused: bool) {
        let key = DataKey::PauseStatus;
        env.storage().persistent().set(&key, &is_paused);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_pause_status(env: &Env) -> bool {
        let key = DataKey::PauseStatus;
        let is_paused = env.storage().persistent().get(&key).unwrap_or(false);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        is_paused
    }
}
