use super::types::Error;
use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapabilityToken {
    pub id: BytesN<32>,
    pub holder: Address,
    pub capability: u32,
    pub issued_at: u64,
    pub expires_at: u64,
    pub nonce: u64,
    pub is_consumed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CapabilityKind {
    ModifyListing = 1,
    TransferOwnership = 2,
    SetPrice = 3,
    CreateBundle = 4,
    DisputeResolution = 5,
}

pub fn issue_capability_token(
    env: &Env,
    holder: Address,
    capability: u32,
    duration_secs: u64,
) -> Result<CapabilityToken, Error> {
    let current_time = env.ledger().timestamp();
    let expires_at = current_time
        .checked_add(duration_secs)
        .ok_or(Error::ArithmeticOverflow)?;

    let nonce = env.prng().gen::<u64>();
    let mut id_bytes = [0u8; 32];
    id_bytes[0..8].copy_from_slice(&current_time.to_be_bytes());
    id_bytes[8..16].copy_from_slice(&nonce.to_be_bytes());
    id_bytes[16..24].copy_from_slice(&capability.to_be_bytes());
    id_bytes[24..32].copy_from_slice(&holder.to_xdr(env).as_ref()[0..8]);

    Ok(CapabilityToken {
        id: BytesN::from_array(env, &id_bytes),
        holder,
        capability,
        issued_at: current_time,
        expires_at,
        nonce,
        is_consumed: false,
    })
}

pub fn validate_capability_token(
    env: &Env,
    token: &CapabilityToken,
    required_capability: u32,
) -> Result<(), Error> {
    let current_time = env.ledger().timestamp();

    if token.is_consumed {
        return Err(Error::AuthorizationNonceConsumed);
    }

    if current_time > token.expires_at {
        return Err(Error::AuthorizationExpired);
    }

    if token.capability != required_capability {
        return Err(Error::Unauthorized);
    }

    Ok(())
}

pub fn consume_capability_token(token: &mut CapabilityToken) -> Result<(), Error> {
    if token.is_consumed {
        return Err(Error::AuthorizationNonceConsumed);
    }
    token.is_consumed = true;
    Ok(())
}

pub fn extend_capability_token(
    env: &Env,
    token: &mut CapabilityToken,
    additional_duration_secs: u64,
) -> Result<(), Error> {
    let current_time = env.ledger().timestamp();
    if current_time > token.expires_at {
        return Err(Error::AuthorizationExpired);
    }

    token.expires_at = token
        .expires_at
        .checked_add(additional_duration_secs)
        .ok_or(Error::ArithmeticOverflow)?;
    Ok(())
}

pub fn revoke_capability_token(token: &mut CapabilityToken) {
    token.is_consumed = true;
}
