use super::types::{DataKey, Error, ListingRevisionRecord, Prompt, Purchase, PurchaseDispute};
use soroban_sdk::{token, Address, BytesN, Env, Vec};

/// # Storage TTL Policy (#26)
///
/// Every persistent storage entry is governed by the following TTL policy:
///
/// - **DAY_IN_LEDGERS**: 17,280 ledgers (~1 day on Stellar at 5s closure)
/// - **PERSISTENT_LIFETIME_THRESHOLD**: 7 days — if remaining TTL drops below this,
///   the entry is bumped on next read/write.
/// - **PERSISTENT_BUMP_AMOUNT**: 30 days — each bump extends TTL by this amount.
///
/// ## Read path
/// Every `get_*` function calls `extend_key_ttl` so frequently-accessed entries
/// stay alive. This covers prompts, purchases, fee config, voucher keys, listing
/// revisions, disputes, and creator/buyer index lists.
///
/// ## Write path
/// Every `set_*` / `save_*` / `update_*` function also bumps TTL after writing.
///
/// ## Bulk maintenance
/// `extend_all_ttl` iterates over all prompts and extends their TTL + related
/// entries. Call this periodically (e.g. via a cron or admin CLI) to prevent
/// archival of active listings.
///
/// ## Archival recovery
/// If a record is archived (TTL expired), the associated data is lost and cannot
/// be recovered from on-chain storage. Off-chain indexers should maintain a
/// backup of critical records. See `docs/operations/backup-and-recovery.md`.
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
        env.storage()
            .persistent()
            .set(&counter_key, &next_prompt_id);
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
        let now = env.ledger().timestamp();
        let mut prompts = Vec::new(env);
        for prompt_id in 0..prompt_count {
            if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                // Skip expired listings (expires_at == 0 means never expires)
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
        let ids: Vec<u128> = env
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
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
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
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn add_prompt_to_buyer(env: &Env, buyer: &Address, prompt_id: u128) {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u128> = env
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

    pub fn remove_prompt_from_buyer(env: &Env, buyer: &Address, prompt_id: u128) {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u128> = env
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

    pub fn save_purchase(env: &Env, purchase: &Purchase) {
        let key = DataKey::Purchase(purchase.prompt_id, purchase.owner.clone());
        env.storage().persistent().set(&key, purchase);
        Self::extend_key_ttl(env, &key);
    }

    pub fn remove_purchase(env: &Env, prompt_id: u128, owner: &Address) {
        let key = DataKey::Purchase(prompt_id, owner.clone());
        env.storage().persistent().remove(&key);
    }

    pub fn require_purchase(
        env: &Env,
        prompt_id: u128,
        owner: &Address,
    ) -> Result<Purchase, Error> {
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

    pub fn get_dispute(env: &Env, prompt_id: u128, buyer: &Address) -> Option<PurchaseDispute> {
        let key = DataKey::PurchaseDispute(prompt_id, buyer.clone());
        let dispute = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        dispute
    }

    pub fn require_dispute(
        env: &Env,
        prompt_id: u128,
        buyer: &Address,
    ) -> Result<PurchaseDispute, Error> {
        Self::get_dispute(env, prompt_id, buyer).ok_or(Error::DisputeNotFound)
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

    pub fn get_stellar_asset_contract(
        env: &'_ Env,
    ) -> Result<token::StellarAssetClient<'_>, Error> {
        let contract_id = Self::get_xlm_address(env).ok_or(Error::XlmAddressNotSet)?;
        Ok(token::StellarAssetClient::new(env, &contract_id))
    }

    pub fn set_reentrancy_guard(env: &Env) -> Result<(), Error> {
        let key = DataKey::Reentrancy;
        let already_set = env
            .storage()
            .persistent()
            .get::<_, bool>(&key)
            .unwrap_or(false);
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

    pub fn set_referral_percentage(env: &Env, percentage: u32) {
        let key = DataKey::ReferralPercentage;
        env.storage().persistent().set(&key, &percentage);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_referral_percentage(env: &Env) -> u32 {
        let key = DataKey::ReferralPercentage;
        let fee = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        fee
    }

    pub fn set_pause_status(env: &Env, is_paused: bool) {
        let key = DataKey::IsPaused;
        env.storage().persistent().set(&key, &is_paused);
        Self::extend_key_ttl(env, &key);
    }

    pub fn is_paused(env: &Env) -> bool {
        let key = DataKey::IsPaused;
        let p = env.storage().persistent().get(&key).unwrap_or(false);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        p
    }

    pub fn add_voucher(env: &Env, prompt_id: u128, hashed_code: &BytesN<32>, discount_bps: u32) {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        env.storage().persistent().set(&key, &discount_bps);
        Self::extend_key_ttl(env, &key);
    }

    pub fn remove_voucher(env: &Env, prompt_id: u128, hashed_code: &BytesN<32>) {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        env.storage().persistent().remove(&key);
    }

    pub fn get_voucher(env: &Env, prompt_id: u128, hashed_code: &BytesN<32>) -> Option<u32> {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        let discount = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        discount
    }

    // ── Listing revision storage (#226) ──────────────────────────────────────

    /// Persist a revision snapshot for `old_revision` before overwriting the listing.
    pub fn save_listing_revision(env: &Env, record: &ListingRevisionRecord) {
        let key = DataKey::ListingRevision(record.prompt_id, record.revision);
        env.storage().persistent().set(&key, record);
        Self::extend_key_ttl(env, &key);
    }

    /// Retrieve a revision snapshot. Returns `None` when the revision number
    /// has never been committed (e.g. revision 0 on a never-revised listing).
    pub fn get_listing_revision(
        env: &Env,
        prompt_id: u128,
        revision: u32,
    ) -> Option<ListingRevisionRecord> {
        let key = DataKey::ListingRevision(prompt_id, revision);
        let record = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        record
    }

    // ── Bulk TTL maintenance (#26) ──────────────────────────────────────────

    /// Iterates over every existing prompt and extends TTL on the prompt record,
    /// its listing revisions, and the creator's prompt index. This is designed
    /// for periodic admin maintenance calls to prevent archival of active data.
    pub fn extend_all_ttl(env: &Env) {
        let prompt_count = Self::get_prompt_counter(env);
        for prompt_id in 0..prompt_count {
            let key = DataKey::Prompt(prompt_id);
            if env.storage().persistent().has(&key) {
                Self::extend_key_ttl(env, &key);
                // Also bump revision snapshots for this prompt
                if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                    for rev in 0..=prompt.revision {
                        let rev_key = DataKey::ListingRevision(prompt_id, rev);
                        if env.storage().persistent().has(&rev_key) {
                            Self::extend_key_ttl(env, &rev_key);
                        }
                    }
                    // Bump creator index
                    let creator_key = DataKey::CreatorPrompts(prompt.creator.clone());
                    if env.storage().persistent().has(&creator_key) {
                        Self::extend_key_ttl(env, &creator_key);
                    }
                }
            }
        }
        // Bump global config entries
        for key in [
            DataKey::FeePercentage,
            DataKey::FeeWallet,
            DataKey::XlmAddress,
            DataKey::ReferralPercentage,
            DataKey::IsPaused,
        ] {
            if env.storage().persistent().has(&key) {
                Self::extend_key_ttl(env, &key);
            }
        }
    }
}
