use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
struct PromptCreated {
    #[topic]
    pub prompt_id: u128,
    pub creator: Address,
    pub price_stroops: i128,
    pub asset: Address,
}

#[contractevent]
struct PromptSaleStatusUpdated {
    #[topic]
    pub prompt_id: u128,
    pub active: bool,
}

#[contractevent]
struct PromptPriceUpdated {
    #[topic]
    pub prompt_id: u128,
    pub price_stroops: i128,
}

#[contractevent]
struct PromptPurchased {
    #[topic]
    pub prompt_id: u128,
    pub buyer: Address,
    pub creator: Address,
    pub price_stroops: i128,
    pub referrer: Option<Address>,
}

#[contractevent]
struct PromptTipped {
    #[topic]
    pub prompt_id: u128,
    pub buyer: Address,
    pub amount_tipped: i128,
}

#[contractevent]
struct VoucherAdded {
    #[topic]
    pub prompt_id: u128,
    pub hashed_code: soroban_sdk::BytesN<32>,
    pub discount_bps: u32,
}

#[contractevent]
struct VoucherRemoved {
    #[topic]
    pub prompt_id: u128,
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
struct ListingExtended {
    #[topic]
    pub prompt_id: u128,
    pub new_expires_at: u64,
}

pub struct Events;

impl Events {
    pub fn emit_prompt_created(
        env: &Env,
        prompt_id: u128,
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

    pub fn emit_prompt_sale_status_updated(env: &Env, prompt_id: u128, active: bool) {
        PromptSaleStatusUpdated { prompt_id, active }.publish(env);
    }

    pub fn emit_prompt_price_updated(env: &Env, prompt_id: u128, price_stroops: i128) {
        PromptPriceUpdated {
            prompt_id,
            price_stroops,
        }
        .publish(env);
    }

    pub fn emit_prompt_purchased(
        env: &Env,
        prompt_id: u128,
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

    pub fn emit_prompt_tipped(env: &Env, prompt_id: u128, buyer: Address, amount_tipped: i128) {
        PromptTipped {
            prompt_id,
            buyer,
            amount_tipped,
        }
        .publish(env);
    }

    pub fn emit_voucher_added(
        env: &Env,
        prompt_id: u128,
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

    pub fn emit_voucher_removed(env: &Env, prompt_id: u128, hashed_code: soroban_sdk::BytesN<32>) {
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

    pub fn emit_listing_extended(env: &Env, prompt_id: u128, new_expires_at: u64) {
        ListingExtended {
            prompt_id,
            new_expires_at,
        }
        .publish(env);
    }
}
