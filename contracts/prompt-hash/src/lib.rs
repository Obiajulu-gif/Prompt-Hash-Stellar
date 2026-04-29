#![no_std]

mod contract;
mod test;
mod types;

pub use contract::PromptHashContract;
pub use types::{DataKey, Error, Prompt};

