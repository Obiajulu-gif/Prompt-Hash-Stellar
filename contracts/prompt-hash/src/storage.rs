use super::types::{DataKey, Error, InstanceDataKey, ListingRevisionRecord, Prompt, Purchase, PurchaseDispute};
use soroban_sdk::{token, Address, BytesN, Env, Vec};

pub const DAY_IN_LEDGERS: u32 = 17280;
pub const PERSISTENT_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}

/// Instance-scoped storage for contract-level configuration.
/// Uses `env.storage().instance()` — no TTL, survives upgrades.
pub struct InstanceStorage;

impl InstanceStorage {
    pub fn get_prompt_counter(env: &Env) -> u64 {
        let key = InstanceDataKey::PromptCounter;
        env.storage().instance().get(&key).unwrap_or(0)
    }

    pub fn save_prompt_counter(env: &Env, count: u64) {
        let key = InstanceDataKey::PromptCounter;
        env.storage().instance().set(&key, &count);
    }

    pub fn set_fee_percentage(env: &Env, fee_percentage: &u32) {
        let key = InstanceDataKey::FeePercentage;
        env.storage().instance().set(&key, fee_percentage);
    }

    pub fn get_fee_percentage(env: &Env) -> u32 {
        let key = InstanceDataKey::FeePercentage;
        env.storage().instance().get(&key).unwrap_or(0)
    }

    pub fn set_fee_wallet(env: &Env, fee_wallet: &Address) {
        let key = InstanceDataKey::FeeWallet;
        env.storage().instance().set(&key, fee_wallet);
    }

    pub fn get_fee_wallet(env: &Env) -> Option<Address> {
        env.storage().instance().get(&InstanceDataKey::FeeWallet)
    }

    pub fn set_xlm_address(env: &Env, xlm_address: &Address) {
        let key = InstanceDataKey::XlmAddress;
        env.storage().instance().set(&key, xlm_address);
    }

    pub fn get_xlm_address(env: &Env) -> Option<Address> {
        env.storage().instance().get(&InstanceDataKey::XlmAddress)
    }

    pub fn get_stellar_asset_contract(
        env: &'_ Env,
    ) -> Result<token::StellarAssetClient<'_>, Error> {
        let contract_id = Self::get_xlm_address(env).ok_or(Error::XlmAddressNotSet)?;
        Ok(token::StellarAssetClient::new(env, &contract_id))
    }

    pub fn set_reentrancy_guard(env: &Env) -> Result<(), Error> {
        let key = InstanceDataKey::Reentrancy;
        let already_set = env
            .storage()
            .instance()
            .get::<_, bool>(&key)
            .unwrap_or(false);
        ensure(!already_set, Error::ReentrancyGuard)?;
        env.storage().instance().set(&key, &true);
        Ok(())
    }

    pub fn clear_reentrancy_guard(env: &Env) {
        let key = InstanceDataKey::Reentrancy;
        env.storage().instance().set(&key, &false);
    }

    pub fn set_referral_percentage(env: &Env, percentage: u32) {
        let key = InstanceDataKey::ReferralPercentage;
        env.storage().instance().set(&key, &percentage);
    }

    pub fn get_referral_percentage(env: &Env) -> u32 {
        let key = InstanceDataKey::ReferralPercentage;
        env.storage().instance().get(&key).unwrap_or(0)
    }

    pub fn set_pause_status(env: &Env, is_paused: bool) {
        let key = InstanceDataKey::IsPaused;
        env.storage().instance().set(&key, &is_paused);
    }

    pub fn is_paused(env: &Env) -> bool {
        let key = InstanceDataKey::IsPaused;
        env.storage().instance().get(&key).unwrap_or(false)
    }
}

/// Persistent storage for prompt, purchase, and user-index records.
/// Each entry is subject to TTL management via `extend_key_ttl`.
pub struct Storage;

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

        let next_prompt_id = prompt.id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        InstanceStorage::save_prompt_counter(env, next_prompt_id);
        Ok(())
    }

    pub fn get_prompt(env: &Env, prompt_id: u64) -> Option<Prompt> {
        let key = DataKey::Prompt(prompt_id);
        if let Some(prompt) = env.storage().persistent().get(&key) {
            Self::extend_key_ttl(env, &key);
            Some(prompt)
        } else {
            None
        }
    }

    pub fn require_prompt(env: &Env, prompt_id: u64) -> Result<Prompt, Error> {
        Self::get_prompt(env, prompt_id).ok_or(Error::PromptNotFound)
    }

    pub fn update_prompt(env: &Env, prompt: &Prompt) {
        let key = DataKey::Prompt(prompt.id);
        env.storage().persistent().set(&key, prompt);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_all_prompts(env: &Env) -> Vec<Prompt> {
        let prompt_count = InstanceStorage::get_prompt_counter(env);
        let now = env.ledger().timestamp();
        let mut prompts = Vec::new(env);
        for prompt_id in 0..prompt_count {
            if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                if prompt.expires_at == 0 || prompt.expires_at >= now {
                    prompts.push_back(prompt);
                }
            }
        }
        prompts
    }

    pub fn get_prompts_by_category(env: &Env, category: &soroban_sdk::String) -> Vec<Prompt> {
        let all = Self::get_all_prompts(env);
        let mut prompts = Vec::new(env);
        for index in 0..all.len() {
            let prompt = all.get(index).unwrap();
            if prompt.category == *category {
                prompts.push_back(prompt);
            }
        }
        prompts
    }

    pub fn get_prompts_by_tag(env: &Env, tag: &soroban_sdk::String) -> Vec<Prompt> {
        let all = Self::get_all_prompts(env);
        let mut prompts = Vec::new(env);
        for index in 0..all.len() {
            let prompt = all.get(index).unwrap();
            for tag_index in 0..prompt.tags.len() {
                if prompt.tags.get(tag_index).unwrap() == *tag {
                    prompts.push_back(prompt.clone());
                    break;
                }
            }
        }
        prompts
    }

    pub fn get_prompts_by_creator(env: &Env, creator: &Address) -> Vec<Prompt> {
        let key = DataKey::CreatorPrompts(creator.clone());
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        Self::prompts_from_ids(env, ids)
    }

    pub fn get_prompts_by_buyer(env: &Env, buyer: &Address) -> Vec<Prompt> {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        Self::prompts_from_ids(env, ids)
    }

    fn prompts_from_ids(env: &Env, ids: Vec<u64>) -> Vec<Prompt> {
        let mut prompts = Vec::new(env);
        for index in 0..ids.len() {
            let prompt_id = ids.get(index).unwrap();
            if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                prompts.push_back(prompt);
            }
        }
        prompts
    }

    pub fn add_prompt_to_creator(env: &Env, creator: &Address, prompt_id: u64) {
        let key = DataKey::CreatorPrompts(creator.clone());
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn add_prompt_to_buyer(env: &Env, buyer: &Address, prompt_id: u64) {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        for index in 0..ids.len() {
            if ids.get(index).unwrap() == prompt_id {
                Self::extend_key_ttl(env, &key);
                return;
            }
        }
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn remove_prompt_from_buyer(env: &Env, buyer: &Address, prompt_id: u64) {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        let mut index = 0;
        while index < ids.len() {
            if ids.get(index).unwrap() == prompt_id {
                ids.remove(index);
            } else {
                index += 1;
            }
        }
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_purchase(env: &Env, prompt_id: u64, buyer: &Address) -> Option<Purchase> {
        let key = DataKey::Purchase(prompt_id, buyer.clone());
        let purchase = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        purchase
    }

    pub fn has_active_purchase(env: &Env, prompt_id: u64, buyer: &Address, now: u64) -> bool {
        Self::get_purchase(env, prompt_id, buyer)
            .map(|purchase| purchase.expires_at >= now)
            .unwrap_or(false)
    }

    pub fn save_purchase(env: &Env, purchase: &Purchase) {
        let key = DataKey::Purchase(purchase.prompt_id, purchase.owner.clone());
        env.storage().persistent().set(&key, purchase);
        Self::extend_key_ttl(env, &key);
    }

    pub fn remove_purchase(env: &Env, prompt_id: u64, owner: &Address) {
        let key = DataKey::Purchase(prompt_id, owner.clone());
        env.storage().persistent().remove(&key);
    }

    pub fn require_purchase(env: &Env, prompt_id: u64, owner: &Address) -> Result<Purchase, Error> {
        Self::get_purchase(env, prompt_id, owner).ok_or(Error::LicenseNotFound)
    }

    pub fn grant_purchase(
        env: &Env,
        prompt: &Prompt,
        buyer: &Address,
        paid_price: i128,
        expires_at: u64,
    ) {
        let key = DataKey::Purchase(prompt.id, buyer.clone());
        let purchase = Purchase {
            prompt_id: prompt.id,
            original_creator: prompt.creator.clone(),
            owner: buyer.clone(),
            original_price: paid_price,
            last_transfer_price: 0,
            transfer_count: 0,
            last_transferred_at: 0,
            expires_at,
        };
        env.storage().persistent().set(&key, &purchase);
        Self::extend_key_ttl(env, &key);
        Self::add_prompt_to_buyer(env, buyer, prompt.id);
    }

    pub fn save_dispute(env: &Env, dispute: &PurchaseDispute) {
        let key = DataKey::PurchaseDispute(dispute.prompt_id, dispute.buyer.clone());
        env.storage().persistent().set(&key, dispute);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_dispute(env: &Env, prompt_id: u64, buyer: &Address) -> Option<PurchaseDispute> {
        let key = DataKey::PurchaseDispute(prompt_id, buyer.clone());
        let dispute = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        dispute
    }

    pub fn require_dispute(env: &Env, prompt_id: u64, buyer: &Address) -> Result<PurchaseDispute, Error> {
        Self::get_dispute(env, prompt_id, buyer).ok_or(Error::DisputeNotFound)
    }

    pub fn add_voucher(env: &Env, prompt_id: u64, hashed_code: &BytesN<32>, discount_bps: u32) {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        env.storage().persistent().set(&key, &discount_bps);
        Self::extend_key_ttl(env, &key);
    }

    pub fn remove_voucher(env: &Env, prompt_id: u64, hashed_code: &BytesN<32>) {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        env.storage().persistent().remove(&key);
    }

    pub fn get_voucher(env: &Env, prompt_id: u64, hashed_code: &BytesN<32>) -> Option<u32> {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        let discount = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        discount
    }

    pub fn save_listing_revision(env: &Env, record: &ListingRevisionRecord) {
        let key = DataKey::ListingRevision(record.prompt_id, record.revision);
        env.storage().persistent().set(&key, record);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_listing_revision(env: &Env, prompt_id: u64, revision: u32) -> Option<ListingRevisionRecord> {
        let key = DataKey::ListingRevision(prompt_id, revision);
        let record = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        record
    }

    pub fn extend_all_ttl(env: &Env) {
        let prompt_count = InstanceStorage::get_prompt_counter(env);
        for prompt_id in 0..prompt_count {
            let key = DataKey::Prompt(prompt_id);
            if env.storage().persistent().has(&key) {
                Self::extend_key_ttl(env, &key);
                if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                    for rev in 0..=prompt.revision {
                        let rev_key = DataKey::ListingRevision(prompt_id, rev);
                        if env.storage().persistent().has(&rev_key) {
                            Self::extend_key_ttl(env, &rev_key);
                        }
                    }
                    let creator_key = DataKey::CreatorPrompts(prompt.creator.clone());
                    if env.storage().persistent().has(&creator_key) {
                        Self::extend_key_ttl(env, &creator_key);
                    }
                }
            }
        }
    }
}
