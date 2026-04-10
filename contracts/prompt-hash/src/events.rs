use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
struct PromptCreated {
    #[topic]
    pub prompt_id: u128,
    pub creator: Address,
    pub price_stroops: i128,
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

pub struct Events;

impl Events {
    pub fn emit_prompt_created(env: &Env, prompt_id: u128, creator: Address, price_stroops: i128) {
        PromptCreated {
            prompt_id,
            creator,
            price_stroops,
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
    ) {
        PromptPurchased {
            prompt_id,
            buyer,
            creator,
            price_stroops,
        }
        .publish(env);
    }

    pub fn emit_fee_updated(env: &Env, new_fee_percentage: u32) {
        FeeUpdated { new_fee_percentage }.publish(env);
    }

    pub fn emit_fee_wallet_updated(env: &Env, new_fee_wallet: Address) {
        FeeWalletUpdated { new_fee_wallet }.publish(env);
    }
}
