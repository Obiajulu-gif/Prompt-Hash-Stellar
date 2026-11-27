#![no_std]
#![allow(dead_code)]
#![allow(clippy::too_many_arguments)]

mod capability_tokens;
#[cfg(test)]
mod capability_tokens_test;
mod conflict_resolver;
mod contract;
mod contract_tests;
mod events;
mod load_test;
mod ownership_transfer_test;
mod pagination;
mod pagination_test;
mod storage;
mod test;
mod ttl_policy;
mod ttl_test;
mod types;

#[cfg(test)]
mod mock_asset;

pub use contract::PromptHashContract;
pub use types::{DataKey, Error, Prompt};
