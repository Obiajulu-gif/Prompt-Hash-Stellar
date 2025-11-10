use super::types::Prompt;
use soroban_sdk::{symbol_short, token, Address, Env, Vec};

pub struct Storage;

impl Storage {
    pub fn save_prompt(env: &Env, prompt: &Prompt) {
        let key = (symbol_short!("PROMPT"), prompt.id);
        env.storage().persistent().set(&key, prompt);
        env
            .storage()
            .persistent()
            .set(&symbol_short!("counter"), &(prompt.id as u32 + 1));
    }

    pub fn get_prompt(env: &Env, token_id: u128) -> Option<Prompt> {
        let key = (symbol_short!("PROMPT"), token_id);
        env.storage().persistent().get(&key)
    }

    pub fn update_prompt(env: &Env, prompt: &Prompt) {
        let key = (symbol_short!("PROMPT"), prompt.id);
        env.storage().persistent().set(&key, prompt);
    }

    pub fn get_all_prompts(env: &Env) -> Vec<Prompt> {
        // The NFT Base contract uses a u32 counter with symbol "counter"
        // The counter represents the number of minted tokens
        // Token IDs are 0-indexed (0, 1, 2, ..., counter-1)
        let counter: u32 = env
            .storage()
            .persistent()
            .get(&symbol_short!("counter"))
            .unwrap_or(0);
        let mut prompts = Vec::new(env);

        // Token IDs start from 0 and go up to counter-1
        for i in 0..counter {
            if let Some(prompt) = Self::get_prompt(env, i as u128) {
                prompts.push_back(prompt);
            }
        }

        prompts
    }

    pub fn get_next_token(env: &Env) -> u128 {
        env.storage()
            .persistent()
            .get(&symbol_short!("counter"))
            .unwrap_or(0)
            + 1
    }

    pub fn set_fee_percentage(env: &Env, fee_percentage: u128) {
        env.storage()
            .persistent()
            .set(&symbol_short!("fee_pct"), &fee_percentage);
    }

    pub fn get_fee_percentage(env: &Env) -> u128 {
        env.storage()
            .persistent()
            .get(&symbol_short!("fee_pct"))
            .unwrap_or(0)
    }

    pub fn set_fee_wallet(env: &Env, fee_wallet: &Address) {
        env.storage()
            .persistent()
            .set(&symbol_short!("fee_wlt"), fee_wallet);
    }

    pub fn get_fee_wallet(env: &Env) -> Option<Address> {
        env.storage().persistent().get(&symbol_short!("fee_wlt"))
    }

    pub fn set_xlm_address(env: &Env, xlm_address: &Address) {
        env.storage()
            .persistent()
            .set(&symbol_short!("xlm_addr"), xlm_address);
    }

    pub fn get_xlm_address(env: &Env) -> Option<Address> {
        env.storage().persistent().get(&symbol_short!("xlm_addr"))
    }

    pub fn get_stellar_asset_contract(env: &'_ Env) -> token::StellarAssetClient<'_> {
        // Stellar Asset Contract address for native XLM
        // This is retrieved from storage where it was set in the constructor
        let contract_id = Self::get_xlm_address(env).expect("XLM address not set");
        token::StellarAssetClient::new(env, &contract_id)
    }
}

// Rating storage
// pub fn save_rating(env: &Env, rating: &Rating) {
//     let key = (RATING, rating.id.clone());
//     env.storage().persistent().set(&key, rating);

//     // Also index by user and contract for efficient retrieval
//     add_rating_to_user_index(env, &rating.rated_user, &rating.id);
//     add_rating_to_contract_index(env, &rating.contract_id, &rating.id);
// }

// fn add_rating_to_user_index(env: &Env, user: &Address, rating_id: &String) {
//     let key = (soroban_sdk::symbol_short!("u_ratings"), user.clone());
//     let mut rating_ids: Vec<String> = env
//         .storage()
//         .persistent()
//         .get(&key)
//         .unwrap_or_else(|| Vec::new(env));
//     rating_ids.push_back(rating_id.clone());
//     env.storage().persistent().set(&key, &rating_ids);
// }
