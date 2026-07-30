use super::types::{
    AccessPass, Bundle, CatalogPassPurchase, DataKey, Error, InstanceDataKey,
    ListingRevisionRecord, Prompt, Purchase, PurchaseDispute, PurchaseEscrow,
};
use soroban_sdk::{token, Address, BytesN, Env, String, Vec};

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

    /// Asserts that the canonical configuration written by `__constructor` is
    /// present. Any economic entry-point must call this before reading config
    /// so that a partially-constructed or legacy-migrated instance fails loudly
    /// rather than silently using wrong defaults.
    pub fn require_config_initialized(env: &Env) -> Result<(), Error> {
        ensure(
            env.storage().instance().has(&InstanceDataKey::FeeWallet),
            Error::FeeWalletNotSet,
        )?;
        ensure(
            env.storage().instance().has(&InstanceDataKey::XlmAddress),
            Error::XlmAddressNotSet,
        )
    }
}

/// Persistent storage for prompt, purchase, and user-index records.
/// Each entry is subject to TTL management via `extend_key_ttl`.
pub struct Storage;

impl Storage {
    pub fn extend_key_ttl(env: &Env, key: &DataKey) {
        use crate::ttl_policy::get_ttl_for_key;

        if !env.storage().persistent().has(key) {
            return;
        }

        let max_ttl = get_ttl_for_key(key);
        if max_ttl == u32::MAX {
            return; // Instance keys don't get TTL management
        }

        env.storage()
            .persistent()
            .extend_ttl(key, PERSISTENT_LIFETIME_THRESHOLD, max_ttl);
    }

    pub fn save_prompt(env: &Env, prompt: &Prompt) -> Result<(), Error> {
        let key = DataKey::Prompt(prompt.id);
        env.storage().persistent().set(&key, prompt);
        Self::extend_key_ttl(env, &key);

        let next_prompt_id = prompt.id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        InstanceStorage::save_prompt_counter(env, next_prompt_id);

        // Update all indexes for pagination
        Self::update_category_index(env, prompt);
        Self::update_tag_index(env, prompt);
        Self::update_status_indexes(env, prompt);

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

    // ─── Purchase Escrow (Settlement Tracking) ──────────────────────────────────
    // Tracks purchase state for atomic refunds and dispute resolution (#420)

    pub fn save_purchase_escrow(env: &Env, escrow: &PurchaseEscrow) {
        let key = DataKey::PurchaseEscrow(escrow.prompt_id, escrow.buyer.clone());
        env.storage().persistent().set(&key, escrow);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_purchase_escrow(
        env: &Env,
        prompt_id: u64,
        buyer: &Address,
    ) -> Option<PurchaseEscrow> {
        let key = DataKey::PurchaseEscrow(prompt_id, buyer.clone());
        let escrow = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        escrow
    }

    pub fn require_purchase_escrow(
        env: &Env,
        prompt_id: u64,
        buyer: &Address,
    ) -> Result<PurchaseEscrow, Error> {
        Self::get_purchase_escrow(env, prompt_id, buyer).ok_or(Error::LicenseNotFound)
    }

    pub fn remove_purchase_escrow(env: &Env, prompt_id: u64, buyer: &Address) {
        let key = DataKey::PurchaseEscrow(prompt_id, buyer.clone());
        env.storage().persistent().remove(&key);
    }

    pub fn save_bundle(env: &Env, bundle: &Bundle) -> Result<(), Error> {
        let key = DataKey::Bundle(bundle.id);
        env.storage().persistent().set(&key, bundle);
        Self::extend_key_ttl(env, &key);

        let counter_key = DataKey::BundleCounter;
        let next_bundle_id = bundle.id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        env.storage()
            .persistent()
            .set(&counter_key, &next_bundle_id);
        Self::extend_key_ttl(env, &counter_key);
        Ok(())
    }

    pub fn update_bundle(env: &Env, bundle: &Bundle) {
        let key = DataKey::Bundle(bundle.id);
        env.storage().persistent().set(&key, bundle);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_bundle(env: &Env, bundle_id: u128) -> Option<Bundle> {
        let key = DataKey::Bundle(bundle_id);
        let bundle = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        bundle
    }

    pub fn require_bundle(env: &Env, bundle_id: u128) -> Result<Bundle, Error> {
        Self::get_bundle(env, bundle_id).ok_or(Error::BundleNotFound)
    }

    pub fn get_bundle_counter(env: &Env) -> u128 {
        let key = DataKey::BundleCounter;
        let count = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        count
    }

    pub fn add_bundle_to_creator(env: &Env, creator: &Address, bundle_id: u128) {
        let key = DataKey::CreatorBundles(creator.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(bundle_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_bundles_by_creator(env: &Env, creator: &Address) -> Vec<Bundle> {
        let key = DataKey::CreatorBundles(creator.clone());
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }

        let mut bundles = Vec::new(env);
        for index in 0..ids.len() {
            if let Some(bundle) = Self::get_bundle(env, ids.get(index).unwrap()) {
                bundles.push_back(bundle);
            }
        }
        bundles
    }

    pub fn save_access_pass(env: &Env, access_pass: &AccessPass) -> Result<(), Error> {
        let key = DataKey::AccessPass(access_pass.id);
        env.storage().persistent().set(&key, access_pass);
        Self::extend_key_ttl(env, &key);

        let counter_key = DataKey::AccessPassCounter;
        let next_pass_id = access_pass
            .id
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        env.storage().persistent().set(&counter_key, &next_pass_id);
        Self::extend_key_ttl(env, &counter_key);
        Ok(())
    }

    pub fn update_access_pass(env: &Env, access_pass: &AccessPass) {
        let key = DataKey::AccessPass(access_pass.id);
        env.storage().persistent().set(&key, access_pass);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_access_pass(env: &Env, pass_id: u128) -> Option<AccessPass> {
        let key = DataKey::AccessPass(pass_id);
        let access_pass = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        access_pass
    }

    pub fn require_access_pass(env: &Env, pass_id: u128) -> Result<AccessPass, Error> {
        Self::get_access_pass(env, pass_id).ok_or(Error::AccessPassNotFound)
    }

    pub fn get_access_pass_counter(env: &Env) -> u128 {
        let key = DataKey::AccessPassCounter;
        let count = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        count
    }

    pub fn add_access_pass_to_creator(env: &Env, creator: &Address, pass_id: u128) {
        let key = DataKey::CreatorAccessPasses(creator.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(pass_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_access_passes_by_creator(env: &Env, creator: &Address) -> Vec<AccessPass> {
        let key = DataKey::CreatorAccessPasses(creator.clone());
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }

        let mut passes = Vec::new(env);
        for index in 0..ids.len() {
            if let Some(access_pass) = Self::get_access_pass(env, ids.get(index).unwrap()) {
                passes.push_back(access_pass);
            }
        }
        passes
    }

    pub fn save_catalog_pass_purchase(env: &Env, purchase: &CatalogPassPurchase) {
        let key = DataKey::CatalogPass(purchase.creator.clone(), purchase.buyer.clone());
        env.storage().persistent().set(&key, purchase);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_catalog_pass_purchase(
        env: &Env,
        creator: &Address,
        buyer: &Address,
    ) -> Option<CatalogPassPurchase> {
        let key = DataKey::CatalogPass(creator.clone(), buyer.clone());
        let purchase = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        purchase
    }

    pub fn has_active_creator_pass(
        env: &Env,
        creator: &Address,
        buyer: &Address,
        now: u64,
    ) -> bool {
        let key = DataKey::CatalogPass(creator.clone(), buyer.clone());
        let purchase: Option<CatalogPassPurchase> = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        purchase
            .map(|catalog_pass| catalog_pass.expires_at >= now)
            .unwrap_or(false)
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

    pub fn require_dispute(
        env: &Env,
        prompt_id: u64,
        buyer: &Address,
    ) -> Result<PurchaseDispute, Error> {
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

    // ─── Signed Discount Authorization Nonce Storage ────────────────────────────
    // Replaces raw voucher preimages with creator-signed authorizations (#540).
    // Nonces are consumed atomically on first use to prevent replay attacks.

    /// Check if a nonce has already been consumed for a given prompt.
    pub fn is_nonce_consumed(env: &Env, prompt_id: u64, nonce_hash: &BytesN<32>) -> bool {
        let key = DataKey::NonceConsumed(prompt_id, nonce_hash.clone());
        env.storage().persistent().has(&key)
    }

    /// Atomically consume a nonce. Returns true if it was not previously consumed.
    pub fn try_consume_nonce(env: &Env, prompt_id: u64, nonce_hash: &BytesN<32>) -> bool {
        let key = DataKey::NonceConsumed(prompt_id, nonce_hash.clone());
        if env.storage().persistent().has(&key) {
            return false;
        }
        env.storage().persistent().set(&key, &true);
        Self::extend_key_ttl(env, &key);
        true
    }

    pub fn save_listing_revision(env: &Env, record: &ListingRevisionRecord) {
        let key = DataKey::ListingRevision(record.prompt_id, record.revision);
        env.storage().persistent().set(&key, record);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_listing_revision(
        env: &Env,
        prompt_id: u64,
        revision: u32,
    ) -> Option<ListingRevisionRecord> {
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

    pub fn get_prompts_paginated(
        env: &Env,
        key: &DataKey,
        cursor: Option<u64>,
        limit: u64,
    ) -> Vec<Prompt> {
        use crate::pagination::MAX_PAGE_SIZE;

        let limit = if limit < MAX_PAGE_SIZE {
            limit
        } else {
            MAX_PAGE_SIZE
        };
        let ids: Vec<u64> = env.storage().persistent().get(key).unwrap_or(Vec::new(env));

        let mut results = Vec::new(env);
        let mut start_idx = 0u32;

        // Find start position if cursor provided
        if let Some(cursor_id) = cursor {
            for (i, id) in ids.iter().enumerate() {
                if id == cursor_id {
                    start_idx = i as u32 + 1;
                    break;
                }
            }
        }

        // Collect up to `limit` items
        for i in start_idx..ids.len() {
            if results.len() as u64 >= limit {
                break;
            }
            if let Some(prompt) = Self::get_prompt(env, ids.get(i).unwrap()) {
                results.push_back(prompt);
            }
        }

        results
    }

    /// Update index for category
    pub fn update_category_index(env: &Env, prompt: &Prompt) {
        let key = DataKey::CategoryPrompts(prompt.category.clone());
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(env));

        if !ids.contains(prompt.id) {
            ids.push_back(prompt.id);
            env.storage().persistent().set(&key, &ids);
            Self::extend_key_ttl(env, &key);
        }
    }

    /// Update index for tags
    pub fn update_tag_index(env: &Env, prompt: &Prompt) {
        for tag in prompt.tags.iter() {
            let key = DataKey::TagPrompts(tag);
            let mut ids: Vec<u64> = env
                .storage()
                .persistent()
                .get(&key)
                .unwrap_or(Vec::new(env));

            if !ids.contains(prompt.id) {
                ids.push_back(prompt.id);
                env.storage().persistent().set(&key, &ids);
                Self::extend_key_ttl(env, &key);
            }
        }
    }

    /// Update active/all indexes
    pub fn update_status_indexes(env: &Env, prompt: &Prompt) {
        // AllPrompts index
        let all_key = DataKey::AllPrompts;
        let mut all_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&all_key)
            .unwrap_or(Vec::new(env));
        if !all_ids.contains(prompt.id) {
            all_ids.push_back(prompt.id);
            env.storage().persistent().set(&all_key, &all_ids);
            Self::extend_key_ttl(env, &all_key);
        }

        // ActivePrompts index (if active)
        if matches!(prompt.status, super::types::PromptSaleStatus::Active) {
            let active_key = DataKey::ActivePrompts;
            let mut active_ids: Vec<u64> = env
                .storage()
                .persistent()
                .get(&active_key)
                .unwrap_or(Vec::new(env));
            if !active_ids.contains(prompt.id) {
                active_ids.push_back(prompt.id);
                env.storage().persistent().set(&active_key, &active_ids);
                Self::extend_key_ttl(env, &active_key);
            }
        }
    }

    // ====== TTL RENEWAL (BOUNDED BATCHES) ======

    /// Renew the TTL of prompt records (and their listing revisions/creator
    /// index) in a bounded batch. Returns (renewed_count, next_cursor_if_more_work).
    pub fn renew_critical_keys(env: &Env, cursor: Option<u64>) -> (u32, Option<u64>) {
        use crate::ttl_policy::MAX_RENEWAL_BATCH_SIZE;

        let prompt_count = InstanceStorage::get_prompt_counter(env);
        let mut renewed_count = 0u32;
        let mut prompt_id = cursor.unwrap_or(0);

        while prompt_id < prompt_count {
            if renewed_count >= MAX_RENEWAL_BATCH_SIZE {
                return (renewed_count, Some(prompt_id));
            }

            let key = DataKey::Prompt(prompt_id);
            if env.storage().persistent().has(&key) {
                Self::extend_key_ttl(env, &key);
                renewed_count += 1;
            }
            prompt_id += 1;
        }

        (renewed_count, None) // All done
    }

    /// Get expiry risk metrics for operator monitoring, sampled across the
    /// TTL policy's own reference lifetimes for each tracked key family.
    pub fn compute_expiry_risks(env: &Env) -> Vec<(String, String)> {
        use crate::ttl_policy::{compute_expiry_risk, ONE_MONTH, ONE_YEAR};

        let mut risks = Vec::new(env);
        let current_ledger = env.ledger().sequence() as u64;

        let sample_ttls: [(&str, u32); 3] = [
            ("Prompt", ONE_YEAR),
            ("Purchase", ONE_YEAR + ONE_MONTH),
            ("Dispute", ONE_MONTH),
        ];

        for (label, max_ttl) in sample_ttls {
            // Conservative: assume mid-lifetime for risk assessment.
            let last_extended = current_ledger.saturating_sub(max_ttl as u64 / 2);
            let risk = compute_expiry_risk(current_ledger, last_extended, max_ttl);

            if risk.critical_keys > 0 || risk.imminent_keys > 0 {
                risks.push_back((
                    String::from_str(env, label),
                    String::from_str(env, "at_risk"),
                ));
            }
        }

        risks
    }
}
