use super::types::Error;
use soroban_sdk::{contracttype, Address, Bytes, Env, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EditOperation {
    pub client_id: Address,
    pub timestamp: u64,
    pub field: String,
    pub value: Bytes,
    pub version: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConflictResolution {
    pub winner: Address,
    pub timestamp: u64,
    pub field: String,
    pub value: Bytes,
    pub is_merged: bool,
}

pub fn resolve_conflict(
    env: &Env,
    operation_a: &EditOperation,
    operation_b: &EditOperation,
) -> Result<ConflictResolution, Error> {
    if operation_a.field != operation_b.field {
        return Err(Error::InvalidMetadata);
    }

    let winner_addr = if operation_a.timestamp < operation_b.timestamp {
        operation_a.client_id.clone()
    } else if operation_b.timestamp < operation_a.timestamp {
        operation_b.client_id.clone()
    } else {
        let a_bytes = operation_a.client_id.to_xdr(env);
        let b_bytes = operation_b.client_id.to_xdr(env);
        if a_bytes.as_ref().cmp(b_bytes.as_ref()).is_lt() {
            operation_a.client_id.clone()
        } else {
            operation_b.client_id.clone()
        }
    };

    let (timestamp, value) = if winner_addr == operation_a.client_id {
        (operation_a.timestamp, operation_a.value.clone())
    } else {
        (operation_b.timestamp, operation_b.value.clone())
    };

    Ok(ConflictResolution {
        winner: winner_addr,
        timestamp,
        field: operation_a.field.clone(),
        value,
        is_merged: false,
    })
}

pub fn merge_concurrent_edits(
    env: &Env,
    base_version: u32,
    edits: &soroban_sdk::Vec<EditOperation>,
) -> Result<(u32, soroban_sdk::Vec<ConflictResolution>), Error> {
    if edits.len() < 2 {
        return Ok((base_version + 1, soroban_sdk::Vec::new(env)));
    }

    let mut resolutions = soroban_sdk::Vec::new(env);
    let mut seen_fields = soroban_sdk::Vec::new(env);

    for i in 0..edits.len() {
        let edit_i = edits.get(i).ok_or(Error::InvalidMetadata)?;

        let mut found_conflict = false;
        for j in (i + 1)..edits.len() {
            let edit_j = edits.get(j).ok_or(Error::InvalidMetadata)?;
            if edit_i.field == edit_j.field {
                found_conflict = true;
                let resolution = resolve_conflict(env, &edit_i, &edit_j)?;
                resolutions.push_back(resolution);
            }
        }

        if !found_conflict {
            seen_fields.push_back(edit_i.field.clone());
        }
    }

    Ok((base_version + 1, resolutions))
}
