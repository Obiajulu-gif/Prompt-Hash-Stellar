#![no_std]
#![allow(dead_code)]
#![allow(clippy::too_many_arguments)]

mod contract;
mod events;
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
