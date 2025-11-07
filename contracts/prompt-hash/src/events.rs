use soroban_sdk::{contractevent, Address, Env, String};

#[contractevent]
struct PromptCreated {
    #[topic]
    pub token_id: u128,
    pub creator: Address,
    pub image_url: String,
    pub description: String,
}

#[contractevent]
struct PromptListed {
    #[topic]
    pub token_id: u128,
    pub seller: Address,
    pub price: u128,
}

#[contractevent]
struct PromptSold {
    #[topic]
    pub token_id: u128,
    pub seller: Address,
    pub buyer: Address,
    pub price: u128,
}

#[contractevent]
struct FeeUpdated {
    #[topic]
    pub new_fee_percentage: u128,
}

#[contractevent]
struct FeeWalletUpdated {
    #[topic]
    pub new_fee_wallet: Address,
}

pub struct Events;

impl Events {
    pub fn emit_prompt_created(
        env: &Env,
        token_id: u128,
        creator: Address,
        image_url: String,
        description: String,
    ) {
        PromptCreated {
            token_id,
            creator,
            image_url,
            description,
        }
        .publish(env);
    }

    pub fn emit_prompt_listed(env: &Env, token_id: u128, seller: Address, price: u128) {
        PromptListed {
            token_id,
            seller,
            price,
        }
        .publish(env);
    }

    pub fn emit_prompt_sold(
        env: &Env,
        token_id: u128,
        seller: Address,
        buyer: Address,
        price: u128,
    ) {
        PromptSold {
            token_id,
            seller,
            buyer,
            price,
        }
        .publish(env);
    }

    pub fn emit_fee_updated(env: &Env, new_fee_percentage: u128) {
        FeeUpdated { new_fee_percentage }.publish(env);
    }

    pub fn emit_fee_wallet_updated(env: &Env, new_fee_wallet: Address) {
        FeeWalletUpdated { new_fee_wallet }.publish(env);
    }
}
