use super::capability_tokens::{
    consume_capability_token, extend_capability_token, issue_capability_token,
    validate_capability_token,
};
use super::types::Error;
use soroban_sdk::{testutils::Ledger, Address, Env};

#[test]
fn capability_expiry_is_inclusive_then_fails_closed() {
    let env = Env::default();
    env.ledger().set_timestamp(100);
    let holder = Address::generate(&env);
    let mut token = issue_capability_token(&env, holder, 7, 10).unwrap();

    env.ledger().set_timestamp(110);
    assert!(validate_capability_token(&env, &token, 7).is_ok());
    env.ledger().set_timestamp(111);
    assert_eq!(
        validate_capability_token(&env, &token, 7),
        Err(Error::AuthorizationExpired)
    );
}

#[test]
fn consumed_or_expired_tokens_cannot_be_reactivated() {
    let env = Env::default();
    env.ledger().set_timestamp(100);
    let holder = Address::generate(&env);
    let mut consumed = issue_capability_token(&env, holder.clone(), 7, 100).unwrap();
    consume_capability_token(&mut consumed).unwrap();
    assert_eq!(
        validate_capability_token(&env, &consumed, 7),
        Err(Error::AuthorizationNonceConsumed)
    );

    let mut expired = issue_capability_token(&env, holder, 7, 1).unwrap();
    env.ledger().set_timestamp(102);
    assert_eq!(
        extend_capability_token(&env, &mut expired, 10),
        Err(Error::AuthorizationExpired)
    );
}
