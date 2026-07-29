use soroban_sdk::{contract, contractimpl, Address, Env, MuxedAddress, String};
use stellar_access::ownable::{self as ownable, Ownable};
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

    pub fn mint(e: &Env, to: Address, amount: i128) {
        Base::mint(e, &to, amount);
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for FungibleTokenContract {
    type ContractType = Base;
}

#[contractimpl(contracttrait)]
impl Ownable for FungibleTokenContract {}
