use crate::types::{DataKey, Error, Prompt};
use soroban_sdk::{
    contract, contractimpl, token, Address, Env, String, Vec,
};

const PLATFORM_FEE_BPS: i128 = 500; // 5%

#[contract]
pub struct PromptHashContract;

#[contractimpl]
impl PromptHashContract {
    pub fn initialize(env: Env, fee_wallet: Address, token_contract: Address) {
        if env.storage().instance().has(&DataKey::FeeWallet) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::FeeWallet, &fee_wallet);
        env.storage()
            .instance()
            .set(&DataKey::TokenContract, &token_contract);
    }

    pub fn create_prompt(
        env: Env,
        creator: Address,
        image_url: String,
        title: String,
        category: String,
        preview_text: String,
        encrypted_payload: String,
        encryption_iv: String,
        wrapped_aes_key: String,
        content_hash: String,
        price: i128,
        max_supply: u32,
    ) -> Result<u32, Error> {
        creator.require_auth();

        if price <= 0 {
            return Err(Error::InvalidPrice);
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PromptCount)
            .unwrap_or(0);
        let id = count;

        let prompt = Prompt {
            id,
            creator: creator.clone(),
            image_url,
            title,
            category,
            preview_text,
            encrypted_payload,
            encryption_iv,
            wrapped_aes_key,
            content_hash,
            price,
            active: true,
            sales_count: 0,
            max_supply,
        };

        env.storage().instance().set(&DataKey::Prompt(id), &prompt);
        env.storage()
            .instance()
            .set(&DataKey::PromptCount, &(count + 1));

        let mut creator_prompts: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::CreatorPrompts(creator.clone()))
            .unwrap_or(Vec::new(&env));
        creator_prompts.push_back(id);
        env.storage()
            .instance()
            .set(&DataKey::CreatorPrompts(creator), &creator_prompts);

        Ok(id)
    }

    pub fn buy_prompt(env: Env, buyer: Address, prompt_id: u32) -> Result<(), Error> {
        buyer.require_auth();

        let mut prompt: Prompt = env
            .storage()
            .instance()
            .get(&DataKey::Prompt(prompt_id))
            .ok_or(Error::NotFound)?;

        if !prompt.active {
            return Err(Error::NotActive);
        }

        if prompt.max_supply > 0 && prompt.sales_count >= prompt.max_supply {
            return Err(Error::MaxSupplyReached);
        }

        let fee_wallet: Address = env
            .storage()
            .instance()
            .get(&DataKey::FeeWallet)
            .expect("fee wallet not set");

        let platform_fee = (prompt.price * PLATFORM_FEE_BPS) / 10000;
        let seller_amount = prompt.price - platform_fee;

        let token_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("token contract not set");

        let token_client = token::Client::new(&env, &token_contract);
        // Transfer buyer -> contract (full price)
        token_client.transfer(&buyer, &env.current_contract_address(), &prompt.price);
        // Transfer contract -> seller
        token_client.transfer(&env.current_contract_address(), &prompt.creator, &seller_amount);
        // Transfer contract -> fee wallet
        token_client.transfer(&env.current_contract_address(), &fee_wallet, &platform_fee);

        prompt.sales_count += 1;
        env.storage()
            .instance()
            .set(&DataKey::Prompt(prompt_id), &prompt);

        let mut buyer_prompts: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::BuyerPrompts(buyer.clone()))
            .unwrap_or(Vec::new(&env));
        if !buyer_prompts.contains(prompt_id) {
            buyer_prompts.push_back(prompt_id);
            env.storage()
                .instance()
                .set(&DataKey::BuyerPrompts(buyer), &buyer_prompts);
        }

        Ok(())
    }

    pub fn has_access(env: Env, buyer: Address, prompt_id: u32) -> bool {
        let buyer_prompts: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::BuyerPrompts(buyer))
            .unwrap_or(Vec::new(&env));
        buyer_prompts.contains(prompt_id)
    }

    pub fn get_prompt(env: Env, prompt_id: u32) -> Result<Prompt, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Prompt(prompt_id))
            .ok_or(Error::NotFound)
    }

    pub fn get_all_prompts(env: Env) -> Vec<Prompt> {
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PromptCount)
            .unwrap_or(0);
        let mut prompts = Vec::new(&env);
        for i in 0..count {
            if let Some(prompt) = env.storage().instance().get(&DataKey::Prompt(i)) {
                prompts.push_back(prompt);
            }
        }
        prompts
    }

    pub fn get_prompts_by_creator(env: Env, creator: Address) -> Vec<Prompt> {
        let ids: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::CreatorPrompts(creator))
            .unwrap_or(Vec::new(&env));
        let mut prompts = Vec::new(&env);
        for id in ids.iter() {
            if let Some(prompt) = env.storage().instance().get(&DataKey::Prompt(id)) {
                prompts.push_back(prompt);
            }
        }
        prompts
    }

    pub fn get_prompts_by_buyer(env: Env, buyer: Address) -> Vec<Prompt> {
        let ids: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::BuyerPrompts(buyer))
            .unwrap_or(Vec::new(&env));
        let mut prompts = Vec::new(&env);
        for id in ids.iter() {
            if let Some(prompt) = env.storage().instance().get(&DataKey::Prompt(id)) {
                prompts.push_back(prompt);
            }
        }
        prompts
    }

    pub fn update_prompt_price(
        env: Env,
        creator: Address,
        prompt_id: u32,
        new_price: i128,
    ) -> Result<(), Error> {
        creator.require_auth();

        if new_price <= 0 {
            return Err(Error::InvalidPrice);
        }

        let mut prompt: Prompt = env
            .storage()
            .instance()
            .get(&DataKey::Prompt(prompt_id))
            .ok_or(Error::NotFound)?;

        if prompt.creator != creator {
            return Err(Error::Unauthorized);
        }

        prompt.price = new_price;
        env.storage()
            .instance()
            .set(&DataKey::Prompt(prompt_id), &prompt);
        Ok(())
    }

    pub fn set_prompt_sale_status(
        env: Env,
        creator: Address,
        prompt_id: u32,
        active: bool,
    ) -> Result<(), Error> {
        creator.require_auth();

        let mut prompt: Prompt = env
            .storage()
            .instance()
            .get(&DataKey::Prompt(prompt_id))
            .ok_or(Error::NotFound)?;

        if prompt.creator != creator {
            return Err(Error::Unauthorized);
        }

        prompt.active = active;
        env.storage()
            .instance()
            .set(&DataKey::Prompt(prompt_id), &prompt);
        Ok(())
    }

    pub fn set_fee_wallet(env: Env, admin: Address, fee_wallet: Address) {
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::FeeWallet, &fee_wallet);
    }
}

