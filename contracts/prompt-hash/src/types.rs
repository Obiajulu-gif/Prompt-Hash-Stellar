use soroban_sdk::{contracterror, contracttype, Address, BytesN, Env, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum Error {
    UnAuthorized = 1,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Prompt {
    pub id: u128,
    pub image_url: String,
    pub description: String,
    pub price: u128,
    pub for_sale: bool,
    pub sold: bool,
    pub owner: Address,
    pub category: String,
    pub title: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DataKey {
    Admin,
}

pub trait PromptHashTrait {
    fn __constructor(
        env: Env,
        admin: Address,
        fee_wallet: Address,
        xlm: Address,
    ) -> Result<(), Error>;
    fn create_prompt(
        env: Env,
        creator: Address,
        image_url: String,
        description: String,
        title: String,
        category: String,
        price: u128,
    ) -> Result<u128, Error>;

    fn get_next_token(env: Env) -> Result<u128, Error>;
    fn list_prompt_for_sale(
        env: Env,
        seller: Address,
        token_id: u128,
        price: u128,
    ) -> Result<(), Error>;
    fn buy_prompt(env: Env, buyer: Address, token_id: u128) -> Result<(), Error>;
    fn get_all_prompts(env: Env) -> Result<Vec<Prompt>, Error>;
    fn set_fee_percentage(env: Env, new_fee_percentage: u128) -> Result<(), Error>;
    fn set_fee_wallet(env: Env, new_fee_wallet: Address) -> Result<(), Error>;
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error>;
}

// adf77a1a23e4cbf7a9a6f185e1d8e7b9a5722333c63681321c0e5904427416 wasm hash
// CA6HD2JQ3LS3GCV77ZV46MVIDAKTB6FUFWC6WWVESWM6MEDQXPRQIFYQ
