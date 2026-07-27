#![no_std]
#![allow(dead_code)]
#![allow(clippy::too_many_arguments)]

mod contract;
mod test;
mod types;

pub use contract::PromptHashContract;
pub use types::{DataKey, Error, Prompt};

