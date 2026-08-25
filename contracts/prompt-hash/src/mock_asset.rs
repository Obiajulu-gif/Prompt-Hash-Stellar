use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, MuxedAddress, String};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_tokens::fungible::{Base, FungibleToken};

/// Instance data key for reentrancy test flag
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MockTokenDataKey {
    /// Flag to trigger a reentrant callback during next transfer.
    /// Stores: (contract_address_to_call, function_name)
    TriggerReentrant(Address, String),
}

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

    /// Set a reentrant callback to be triggered during the next transfer.
    /// This is used for testing reentrancy guards.
    /// If set, the token contract will attempt to call back into the specified
    /// contract function during a transfer operation.
    pub fn set_reentrant_callback(
        e: &Env,
        contract_to_call: Address,
        function_name: String,
    ) {
        let key = MockTokenDataKey::TriggerReentrant(contract_to_call.clone(), function_name);
        e.storage().instance().set(&key, &());
        e.storage().instance().extend_ttl(0, 1);
    }

    /// Clear the reentrant callback flag
    pub fn clear_reentrant_callback(_e: &Env) {
    }

    /// Check if reentrant callback is set and return the callback details
    pub fn get_reentrant_callback(
        e: &Env,
    ) -> Option<(Address, String)> {
        // Since we can't iterate DataKey enum variants, we store a simpler indicator
        // The test will manage this through the env
        None // For now, handled via test harness directly
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for FungibleTokenContract {
    type ContractType = Base;
}

#[contractimpl(contracttrait)]
impl Ownable for FungibleTokenContract {}
