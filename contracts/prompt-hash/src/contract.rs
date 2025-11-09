use super::events::Events;
use super::storage::Storage;
use super::types::{Error, Prompt, PromptHashTrait};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String, Vec};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::{default_impl, only_owner};
use stellar_tokens::non_fungible::{burnable::NonFungibleBurnable, Base, NonFungibleToken};

#[contract]
pub struct PromptHashContract;

#[contractimpl]
impl PromptHashTrait for PromptHashContract {
    fn __constructor(
        env: Env,
        admin: Address,
        fee_wallet: Address,
        xlm: Address,
    ) -> Result<(), Error> {
        Base::set_metadata(
            &env,
            String::from_str(&env, "https://api.example.com/v1/"),
            String::from_str(&env, "PromptHash"),
            String::from_str(&env, "PHASH"),
        );

        // Set the contract owner
        ownable::set_owner(&env, &admin);
        Storage::set_fee_wallet(&env, &fee_wallet);
        Storage::set_fee_percentage(&env, 500);
        Storage::set_xlm_address(&env, &xlm);
        Ok(())
    }

    fn create_prompt(
        env: Env,
        creator: Address,
        image_url: String,
        description: String,
        title: String,
        category: String,
        price: u128,
    ) -> Result<u128, Error> {
        creator.require_auth();

        // Mint the NFT and get the token ID from the Base contract
        // sequential_mint returns the token ID that was minted
        let nft_token_id = Base::sequential_mint(&env, &creator);

        let prompt = Prompt {
            id: nft_token_id as u128, // Use the NFT token ID
            image_url: image_url.clone(),
            description: description.clone(),
            price,
            for_sale: false,
            sold: false,
            owner: creator.clone(),
            category,
            title,
        };

        Storage::save_prompt(&env, &prompt);
        Events::emit_prompt_created(&env, nft_token_id as u128, creator, image_url, description);
        Ok(nft_token_id as u128)
    }

    fn get_next_token(env: Env) -> Result<u128, Error> {
        // Get the next token ID - this reads the NFT counter
        // The counter is stored by the Base contract's sequential_mint
        let counter: u32 = env
            .storage()
            .persistent()
            .get(&soroban_sdk::symbol_short!("counter"))
            .unwrap_or(0);
        Ok((counter + 1) as u128)
    }

    fn list_prompt_for_sale(
        env: Env,
        seller: Address,
        token_id: u128,
        price: u128,
    ) -> Result<(), Error> {
        seller.require_auth();

        let mut prompt =
            Storage::get_prompt(&env, token_id).unwrap_or_else(|| panic!("Prompt not found"));

        // Verify ownership
        if prompt.owner != seller {
            panic!("Only the owner can list the prompt for sale");
        }

        // Verify not already sold
        if prompt.sold {
            panic!("Prompt has already been sold");
        }

        prompt.for_sale = true;
        prompt.price = price;

        Storage::update_prompt(&env, &prompt);

        Events::emit_prompt_listed(&env, token_id, seller, price);
        Ok(())
    }

    fn buy_prompt(env: Env, buyer: Address, token_id: u128) -> Result<(), Error> {
        buyer.require_auth();
        let seller = Base::owner_of(&env, token_id as u32);
        let fee_wallet =
            Storage::get_fee_wallet(&env).unwrap_or_else(|| panic!("Fee wallet not set"));
        let this_contract = env.current_contract_address();

        let mut prompt =
            Storage::get_prompt(&env, token_id).unwrap_or_else(|| panic!("Prompt not found"));

        // Verify prompt is for sale
        if !prompt.for_sale {
            panic!("Prompt is not for sale");
        }

        // Verify not already sold
        if prompt.sold {
            panic!("Prompt has already been sold");
        }

        // Verify buyer is not the owner
        if prompt.owner == buyer {
            panic!("Cannot buy your own prompt");
        }

        let price = prompt.price;

        // Calculate fee
        let fee_percentage = Storage::get_fee_percentage(&env);
        let fee_amount = price * fee_percentage;
        let seller_amount = price * 10000 - fee_amount;

        let xlm = Storage::get_stellar_asset_contract(&env);
        xlm.transfer_from(
            &this_contract,
            &seller,
            &buyer,
            &((seller_amount / 10000) as i128),
        );
        xlm.transfer_from(
            &this_contract,
            &buyer,
            &fee_wallet,
            &((fee_amount / 10000) as i128),
        );
        Base::transfer_from(&env, &this_contract, &seller, &buyer, token_id as u32);

        // Update prompt ownership
        prompt.owner = buyer.clone();
        prompt.sold = true;
        prompt.for_sale = false;

        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_sold(&env, token_id, seller, buyer, price);
        Ok(())
    }

    fn get_all_prompts(env: Env) -> Result<Vec<Prompt>, Error> {
        let prompts = Storage::get_all_prompts(&env);
        Ok(prompts)
    }

    #[only_owner]
    fn set_fee_percentage(env: Env, new_fee_percentage: u128) -> Result<(), Error> {
        Storage::set_fee_percentage(&env, new_fee_percentage);
        Events::emit_fee_updated(&env, new_fee_percentage);
        Ok(())
    }

    #[only_owner]
    fn set_fee_wallet(env: Env, new_fee_wallet: Address) -> Result<(), Error> {
        Storage::set_fee_wallet(&env, &new_fee_wallet);
        Events::emit_fee_wallet_updated(&env, new_fee_wallet);
        Ok(())
    }

    #[only_owner]
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[default_impl]
#[contractimpl]
impl NonFungibleToken for PromptHashContract {
    type ContractType = Base;
}

#[default_impl]
#[contractimpl]
impl NonFungibleBurnable for PromptHashContract {}

#[default_impl]
#[contractimpl]
impl Ownable for PromptHashContract {}
