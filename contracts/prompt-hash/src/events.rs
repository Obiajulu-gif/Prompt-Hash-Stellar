use super::types::PromptSaleStatus;
use soroban_sdk::{contractevent, Address, BytesN, Env};

#[contractevent]
struct PromptCreated {
    #[topic]
    pub prompt_id: u64,
    pub creator: Address,
    pub price_stroops: i128,
    pub asset: Address,
}

#[contractevent]
struct PromptSaleStatusUpdated {
    #[topic]
    pub prompt_id: u64,
    pub status: PromptSaleStatus,
}

#[contractevent]
struct PromptAdminModerated {
    #[topic]
    pub prompt_id: u64,
    pub admin: Address,
    pub status: PromptSaleStatus,
}

#[contractevent]
struct PromptPriceUpdated {
    #[topic]
    pub prompt_id: u64,
    pub price_stroops: i128,
}

#[contractevent]
struct PromptPurchased {
    #[topic]
    pub prompt_id: u64,
    pub buyer: Address,
    pub creator: Address,
    pub price_stroops: i128,
    pub referrer: Option<Address>,
}

#[contractevent]
struct LicenseTransferred {
    #[topic]
    pub prompt_id: u64,
    pub seller: Address,
    pub buyer: Address,
    pub creator: Address,
    pub resale_price: i128,
    pub royalty_amount: i128,
}

#[contractevent]
struct PromptTipped {
    #[topic]
    pub prompt_id: u64,
    pub buyer: Address,
    pub amount_tipped: i128,
}

#[contractevent]
struct VoucherAdded {
    #[topic]
    pub prompt_id: u64,
    pub hashed_code: soroban_sdk::BytesN<32>,
    pub discount_bps: u32,
}

#[contractevent]
struct VoucherRemoved {
    #[topic]
    pub prompt_id: u64,
    pub hashed_code: soroban_sdk::BytesN<32>,
}

#[contractevent]
struct ContractPausedStateChanged {
    pub is_paused: bool,
}

#[contractevent]
struct FeeUpdated {
    #[topic]
    pub new_fee_percentage: u32,
}

#[contractevent]
struct FeeWalletUpdated {
    #[topic]
    pub new_fee_wallet: Address,
}

/// Canonical platform-fee-change event (#566). Emitted by every fee-update
/// entrypoint (`set_fee_percentage`, `update_platform_fee`,
/// `migrate_platform_fee_bound`) so there is exactly one event shape to
/// index regardless of which entrypoint a caller used.
#[contractevent]
struct PlatformFeeUpdated {
    pub old_fee: u32,
    pub new_fee: u32,
    pub admin: Address,
    pub effective_ledger: u32,
}

/// Emitted when `check_asset_solvency` finds the contract's actual SAC
/// balance for an asset no longer covers its tracked liability, and the
/// contract has been paused as a result (#570).
#[contractevent]
struct SolvencyViolationDetected {
    #[topic]
    pub asset: Address,
    pub tracked_liability: i128,
    pub actual_balance: i128,
}

#[contractevent]
struct ListingExtended {
    #[topic]
    pub prompt_id: u64,
    pub new_expires_at: u64,
}

/// Emitted when a signed discount authorization is applied during purchase (#540).
#[contractevent]
struct DiscountApplied {
    #[topic]
    pub prompt_id: u64,
    pub buyer: Address,
    pub discount_bps: u32,
}

/// Emitted when a creator adds a signed discount authorization (#540).
#[contractevent]
struct SignedDiscountAdded {
    #[topic]
    pub prompt_id: u64,
    pub creator: Address,
    pub discount_bps: u32,
    pub nonce: BytesN<32>,
}

/// Emitted when a creator revokes a signed discount authorization (#540).
#[contractevent]
struct SignedDiscountRevoked {
    #[topic]
    pub prompt_id: u64,
    pub creator: Address,
    pub nonce: BytesN<32>,
}

/// Emitted when a creator revises their listing metadata (#226).
#[contractevent]
struct ListingRevised {
    #[topic]
    pub prompt_id: u64,
    pub new_revision: u32,
}

/// Emitted when a creator updates the collaborator splits (#217).
#[contractevent]
struct SplitsUpdated {
    #[topic]
    pub prompt_id: u64,
}

/// Emitted when catalog secondary indexes are verified or repaired (#652).
#[contractevent]
struct CatalogIndexesRepaired {
    #[topic]
    pub admin: Address,
    pub start_id: u64,
    pub end_id: u64,
    pub repairs_applied: u32,
    pub is_dry_run: bool,
}

/// Emitted when a sales counter is reconciled against immutable records (#653).
#[contractevent]
struct SalesCounterReconciled {
    #[topic]
    pub prompt_id: u64,
    pub old_count: u64,
    pub new_count: u64,
}

#[contractevent]
struct DisputeOpened {
    #[topic]
    pub prompt_id: u64,
    pub buyer: Address,
}

#[contractevent]
struct DisputeResolved {
    #[topic]
    pub prompt_id: u64,
    pub buyer: Address,
    pub refunded: bool,
}

#[contractevent]
struct BundleCreated {
    #[topic]
    pub bundle_id: u128,
    pub creator: Address,
    pub price_stroops: i128,
}

#[contractevent]
struct BundlePurchased {
    #[topic]
    pub bundle_id: u128,
    pub buyer: Address,
    pub creator: Address,
    pub price_stroops: i128,
    /// Snapshot of the prompt IDs this purchase actually granted access to,
    /// as of purchase time (issue #425). The bundle's `prompt_ids` field
    /// could differ later, so consumers should rely on this event field —
    /// not a live read of the bundle — to reconstruct what a given
    /// purchase covered.
    pub prompt_ids: soroban_sdk::Vec<u64>,
}

#[contractevent]
struct AccessPassCreated {
    #[topic]
    pub pass_id: u128,
    pub creator: Address,
    pub duration_secs: u64,
    pub price_stroops: i128,
}

#[contractevent]
struct AccessPassPurchased {
    #[topic]
    pub pass_id: u128,
    pub buyer: Address,
    pub creator: Address,
    pub expires_at: u64,
}

#[contractevent]
struct AccessPassStatusUpdated {
    #[topic]
    pub pass_id: u128,
    pub status: PromptSaleStatus,
}

#[contractevent]
struct AccessPassPriceUpdated {
    #[topic]
    pub pass_id: u128,
    pub price_stroops: i128,
}

#[contractevent]
struct PromptMaxSupplyUpdated {
    #[topic]
    pub prompt_id: u64,
    pub max_supply: u64,
}

pub struct Events;

impl Events {
    pub fn emit_prompt_created(
        env: &Env,
        prompt_id: u64,
        creator: Address,
        price_stroops: i128,
        asset: Address,
    ) {
        PromptCreated {
            prompt_id,
            creator,
            price_stroops,
            asset,
        }
        .publish(env);
    }

    pub fn emit_prompt_sale_status_updated(env: &Env, prompt_id: u64, status: PromptSaleStatus) {
        PromptSaleStatusUpdated { prompt_id, status }.publish(env);
    }

    pub fn emit_prompt_admin_moderated(
        env: &Env,
        prompt_id: u64,
        admin: Address,
        status: PromptSaleStatus,
    ) {
        PromptAdminModerated {
            prompt_id,
            admin,
            status,
        }
        .publish(env);
    }

    pub fn emit_prompt_price_updated(env: &Env, prompt_id: u64, price_stroops: i128) {
        PromptPriceUpdated {
            prompt_id,
            price_stroops,
        }
        .publish(env);
    }

    pub fn emit_prompt_purchased(
        env: &Env,
        prompt_id: u64,
        buyer: Address,
        creator: Address,
        price_stroops: i128,
        referrer: Option<Address>,
    ) {
        PromptPurchased {
            prompt_id,
            buyer,
            creator,
            price_stroops,
            referrer,
        }
        .publish(env);
    }

    pub fn emit_license_transferred(
        env: &Env,
        prompt_id: u64,
        seller: Address,
        buyer: Address,
        creator: Address,
        resale_price: i128,
        royalty_amount: i128,
    ) {
        LicenseTransferred {
            prompt_id,
            seller,
            buyer,
            creator,
            resale_price,
            royalty_amount,
        }
        .publish(env);
    }

    pub fn emit_prompt_tipped(env: &Env, prompt_id: u64, buyer: Address, amount_tipped: i128) {
        PromptTipped {
            prompt_id,
            buyer,
            amount_tipped,
        }
        .publish(env);
    }

    pub fn emit_voucher_added(
        env: &Env,
        prompt_id: u64,
        hashed_code: soroban_sdk::BytesN<32>,
        discount_bps: u32,
    ) {
        VoucherAdded {
            prompt_id,
            hashed_code,
            discount_bps,
        }
        .publish(env);
    }

    pub fn emit_voucher_removed(env: &Env, prompt_id: u64, hashed_code: soroban_sdk::BytesN<32>) {
        VoucherRemoved {
            prompt_id,
            hashed_code,
        }
        .publish(env);
    }

    pub fn emit_contract_paused_state_changed(env: &Env, is_paused: bool) {
        ContractPausedStateChanged { is_paused }.publish(env);
    }

    pub fn emit_fee_updated(env: &Env, new_fee_percentage: u32) {
        FeeUpdated { new_fee_percentage }.publish(env);
    }

    pub fn emit_fee_wallet_updated(env: &Env, new_fee_wallet: Address) {
        FeeWalletUpdated { new_fee_wallet }.publish(env);
    }

    pub fn emit_platform_fee_updated(
        env: &Env,
        old_fee: u32,
        new_fee: u32,
        admin: Address,
        effective_ledger: u32,
    ) {
        PlatformFeeUpdated {
            old_fee,
            new_fee,
            admin,
            effective_ledger,
        }
        .publish(env);
    }

    pub fn emit_solvency_violation_detected(
        env: &Env,
        asset: Address,
        tracked_liability: i128,
        actual_balance: i128,
    ) {
        SolvencyViolationDetected {
            asset,
            tracked_liability,
            actual_balance,
        }
        .publish(env);
    }

    pub fn emit_discount_applied(env: &Env, prompt_id: u64, buyer: Address, discount_bps: u32) {
        DiscountApplied {
            prompt_id,
            buyer,
            discount_bps,
        }
        .publish(env);
    }

    pub fn emit_signed_discount_added(
        env: &Env,
        prompt_id: u64,
        creator: Address,
        discount_bps: u32,
        nonce: BytesN<32>,
    ) {
        SignedDiscountAdded {
            prompt_id,
            creator,
            discount_bps,
            nonce,
        }
        .publish(env);
    }

    pub fn emit_signed_discount_revoked(
        env: &Env,
        prompt_id: u64,
        creator: Address,
        nonce: BytesN<32>,
    ) {
        SignedDiscountRevoked {
            prompt_id,
            creator,
            nonce,
        }
        .publish(env);
    }

    pub fn emit_listing_extended(env: &Env, prompt_id: u64, new_expires_at: u64) {
        ListingExtended {
            prompt_id,
            new_expires_at,
        }
        .publish(env);
    }

    pub fn emit_listing_revised(env: &Env, prompt_id: u64, new_revision: u32) {
        ListingRevised {
            prompt_id,
            new_revision,
        }
        .publish(env);
    }

    pub fn emit_splits_updated(env: &Env, prompt_id: u64) {
        SplitsUpdated { prompt_id }.publish(env);
    }

    pub fn emit_dispute_opened(env: &Env, prompt_id: u64, buyer: Address) {
        DisputeOpened { prompt_id, buyer }.publish(env);
    }

    pub fn emit_dispute_resolved(env: &Env, prompt_id: u64, buyer: Address, refunded: bool) {
        DisputeResolved {
            prompt_id,
            buyer,
            refunded,
        }
        .publish(env);
    }

    pub fn emit_bundle_created(env: &Env, bundle_id: u128, creator: Address, price_stroops: i128) {
        BundleCreated {
            bundle_id,
            creator,
            price_stroops,
        }
        .publish(env);
    }

    pub fn emit_bundle_purchased(
        env: &Env,
        bundle_id: u128,
        buyer: Address,
        creator: Address,
        price_stroops: i128,
        prompt_ids: soroban_sdk::Vec<u64>,
    ) {
        BundlePurchased {
            bundle_id,
            buyer,
            creator,
            price_stroops,
            prompt_ids,
        }
        .publish(env);
    }

    pub fn emit_access_pass_created(
        env: &Env,
        pass_id: u128,
        creator: Address,
        duration_secs: u64,
        price_stroops: i128,
    ) {
        AccessPassCreated {
            pass_id,
            creator,
            duration_secs,
            price_stroops,
        }
        .publish(env);
    }

    pub fn emit_access_pass_purchased(
        env: &Env,
        pass_id: u128,
        buyer: Address,
        creator: Address,
        expires_at: u64,
    ) {
        AccessPassPurchased {
            pass_id,
            buyer,
            creator,
            expires_at,
        }
        .publish(env);
    }

    pub fn emit_access_pass_status_updated(env: &Env, pass_id: u128, status: PromptSaleStatus) {
        AccessPassStatusUpdated { pass_id, status }.publish(env);
    }

    pub fn emit_access_pass_price_updated(env: &Env, pass_id: u128, price_stroops: i128) {
        AccessPassPriceUpdated {
            pass_id,
            price_stroops,
        }
        .publish(env);
    }

    pub fn emit_prompt_max_supply_updated(env: &Env, prompt_id: u64, max_supply: u64) {
        PromptMaxSupplyUpdated {
            prompt_id,
            max_supply,
        }
        .publish(env);
    }

    pub fn emit_catalog_indexes_repaired(
        env: &Env,
        admin: Address,
        start_id: u64,
        end_id: u64,
        repairs_applied: u32,
        is_dry_run: bool,
    ) {
        CatalogIndexesRepaired {
            admin,
            start_id,
            end_id,
            repairs_applied,
            is_dry_run,
        }
        .publish(env);
    }

    pub fn emit_sales_counter_reconciled(
        env: &Env,
        prompt_id: u64,
        old_count: u64,
        new_count: u64,
    ) {
        SalesCounterReconciled {
            prompt_id,
            old_count,
            new_count,
        }
        .publish(env);
    }
}
