// Cursor pagination for bounded catalog queries.
// Prevents full-catalog scans and respects Soroban resource limits.

use soroban_sdk::{Env, String as SorobanString, Vec};

pub const MAX_PAGE_SIZE: u64 = 50;

#[derive(Clone)]
pub struct Cursor {
    pub last_id: u64,
    pub index_type: IndexType,
}

#[derive(Clone, PartialEq)]
pub enum IndexType {
    Creator = 0,
    Category = 1,
    Tag = 2,
    Active = 3,
    All = 4,
}

impl IndexType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(IndexType::Creator),
            1 => Some(IndexType::Category),
            2 => Some(IndexType::Tag),
            3 => Some(IndexType::Active),
            4 => Some(IndexType::All),
            _ => None,
        }
    }
}

/// Encode cursor to base64 string for API transmission
pub fn encode_cursor(last_id: u64, index_type: IndexType) -> SorobanString {
    let type_num = match index_type {
        IndexType::Creator => 0u8,
        IndexType::Category => 1u8,
        IndexType::Tag => 2u8,
        IndexType::Active => 3u8,
        IndexType::All => 4u8,
    };
    // Simple encoding: "id:type" (e.g., "12345:0")
    // In production, use proper base64, but this is readable for testing
    format!("{}:{}", last_id, type_num).into()
}

/// Decode cursor from base64 string
pub fn decode_cursor(env: &Env, cursor: &SorobanString) -> Result<Cursor, crate::error::Error> {
    use crate::error::Error;
    let s = cursor.to_string();
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return Err(Error::InvalidCursor);
    }

    let last_id = parts[0].parse::<u64>().map_err(|_| Error::InvalidCursor)?;
    let type_num = parts[1].parse::<u8>().map_err(|_| Error::InvalidCursor)?;
    let index_type = IndexType::from_u8(type_num).ok_or(Error::InvalidCursor)?;

    Ok(Cursor {
        last_id,
        index_type,
    })
}

/// Paginated result with cursor for next page
pub struct PageResult<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<SorobanString>, // None if end of results
}
