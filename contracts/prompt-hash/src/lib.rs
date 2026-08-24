#![no_std]
#![allow(dead_code)]
#![allow(clippy::too_many_arguments)]

mod contract;
mod events;
mod storage;
mod ttl_policy;
mod types;

#[cfg(test)]
mod mock_asset;

#[cfg(test)]
mod test;

#[cfg(test)]
mod ttl_test;
