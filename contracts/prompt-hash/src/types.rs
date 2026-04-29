use soroban_sdk::{contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Prompt {
    pub id: u32,
    pub creator: Address,
    pub image_url: String,
    pub title: String,
    pub category: String,
    pub preview_text: String,
    pub encrypted_payload: String,
    pub encryption_iv: String,
    pub wrapped_aes_key: String,
    pub content_hash: String,
    pub price: i128,
    pub active: bool,
    pub sales_count: u32,
    pub max_supply: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Prompt(u32),
    PromptCount,
    CreatorPrompts(Address),
    BuyerPrompts(Address),
    FeeWallet,
    TokenContract,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Error {
    NotFound = 1,
    AlreadyExists = 2,
    Unauthorized = 3,
    InvalidPrice = 4,
    InvalidSupply = 5,
    MaxSupplyReached = 6,
    PaymentFailed = 7,
    NotActive = 8,
}

