use soroban_sdk::{contract, contractimpl, Address, Env, String};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::{default_impl, only_owner};
use stellar_tokens::fungible::{Base, FungibleToken};

#[contract]
pub struct FungibleTokenContract;

#[contractimpl]
impl FungibleTokenContract {
    pub fn __constructor(e: &Env, owner: Address) {
        // Set token metadata
        Base::set_metadata(
            e,
            18, // 18 decimals
            String::from_str(e, "My Token"),
            String::from_str(e, "TKN"),
        );

        // Set the contract owner
        ownable::set_owner(e, &owner);
        Self::mint(e, owner, 1000000000000);
    }

    #[only_owner]
    pub fn mint(e: &Env, to: Address, amount: i128) {
        Base::mint(e, &to, amount);
    }
}

#[default_impl]
#[contractimpl]
impl FungibleToken for FungibleTokenContract {
    type ContractType = Base;
}

#[default_impl]
#[contractimpl]
impl Ownable for FungibleTokenContract {}
