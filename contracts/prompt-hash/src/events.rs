use soroban_sdk::{contractevent, Address, Env};

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
    pub active: bool,
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

#[contractevent]
struct PlatformFeeUpdated {
    pub old_fee: u32,
    pub new_fee: u32,
    pub admin: Address,
}

#[contractevent]
struct ListingExtended {
    #[topic]
    pub prompt_id: u64,
    pub new_expires_at: u64,
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

    pub fn emit_prompt_sale_status_updated(env: &Env, prompt_id: u64, active: bool) {
        PromptSaleStatusUpdated { prompt_id, active }.publish(env);
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

    pub fn emit_platform_fee_updated(env: &Env, old_fee: u32, new_fee: u32, admin: Address) {
        PlatformFeeUpdated {
            old_fee,
            new_fee,
            admin,
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
}
