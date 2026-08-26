// Cursor pagination for bounded catalog queries.
// Prevents full-catalog scans and respects Soroban resource limits.

use crate::types::Error;
use soroban_sdk::{Env, String as SorobanString};

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

// Cursors are opaque to callers: 8 bytes of big-endian `last_id` followed by
// a 1-byte index-type discriminant. `soroban_sdk::String` has no std-only
// parsing available inside the contract runtime (only under testutils), so
// the cursor is carried as raw bytes rather than a human-readable string.
const CURSOR_LEN: usize = 9;

/// Encode a cursor for API transmission.
pub fn encode_cursor(env: &Env, last_id: u64, index_type: IndexType) -> SorobanString {
    let type_num = match index_type {
        IndexType::Creator => 0u8,
        IndexType::Category => 1u8,
        IndexType::Tag => 2u8,
        IndexType::Active => 3u8,
        IndexType::All => 4u8,
    };
    let mut bytes = [0u8; CURSOR_LEN];
    bytes[0..8].copy_from_slice(&last_id.to_be_bytes());
    bytes[8] = type_num;
    SorobanString::from_bytes(env, &bytes)
}

/// Decode a cursor previously produced by [`encode_cursor`].
pub fn decode_cursor(_env: &Env, cursor: &SorobanString) -> Result<Cursor, Error> {
    if cursor.len() as usize != CURSOR_LEN {
        return Err(Error::InvalidCursor);
    }

    let mut buf = [0u8; CURSOR_LEN];
    cursor.copy_into_slice(&mut buf);

    let mut id_bytes = [0u8; 8];
    id_bytes.copy_from_slice(&buf[0..8]);
    let last_id = u64::from_be_bytes(id_bytes);
    let index_type = IndexType::from_u8(buf[8]).ok_or(Error::InvalidCursor)?;

    Ok(Cursor {
        last_id,
        index_type,
    })
}
