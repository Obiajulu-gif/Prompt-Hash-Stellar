#[cfg(test)]
mod tests {
    use crate::ttl_policy::*;
    use crate::types::DataKey;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env};

    #[test]
    fn test_purchase_has_longer_ttl_than_dispute() {
        let env = Env::default();
        let addr = Address::generate(&env);
        let purchase_ttl = get_ttl_for_key(&DataKey::Purchase(1, addr.clone()));
        let dispute_ttl = get_ttl_for_key(&DataKey::PurchaseDispute(1, addr));

        assert!(
            purchase_ttl > dispute_ttl,
            "Purchases must have longer TTL than disputes"
        );
    }

    #[test]
    fn test_entitlement_outlives_escrow() {
        let env = Env::default();
        let addr = Address::generate(&env);
        let catalog_pass_ttl = get_ttl_for_key(&DataKey::CatalogPass(addr.clone(), addr.clone()));
        let escrow_ttl = get_ttl_for_key(&DataKey::PurchaseEscrow(1, addr));

        assert!(
            catalog_pass_ttl >= escrow_ttl,
            "Entitlements must outlive escrow"
        );
    }

    #[test]
    fn test_renewal_threshold_calculations() {
        let max_ttl = ONE_MONTH;

        // Before renewal threshold
        assert!(!should_renew_key(0, 0, max_ttl));

        // At renewal threshold (70% of TTL)
        let renewal_point = (max_ttl as u64) * 70 / 100;
        assert!(should_renew_key(renewal_point + 1, 0, max_ttl));

        // Just before renewal threshold
        assert!(!should_renew_key(renewal_point - 1, 0, max_ttl));
    }

    #[test]
    fn test_time_remaining_positive() {
        let max_ttl = ONE_YEAR;
        let current = 1_000_000u64;
        let last_extended = 100_000u64;

        let remaining = get_time_remaining(current, last_extended, max_ttl);
        let expected = (last_extended + max_ttl as u64) - current;

        assert_eq!(remaining, expected);
    }

    #[test]
    fn test_expiry_risk_computation() {
        let max_ttl = ONE_MONTH;
        let current = 1_000_000u64;

        // Not at risk
        let risk = compute_expiry_risk(current, current - 100, max_ttl);
        assert_eq!(risk.critical_keys, 0);
        assert_eq!(risk.imminent_keys, 0);

        // At risk (80% through lifetime, only 20% of the TTL remains)
        let risky_extended = current - (max_ttl as u64) * 4 / 5;
        let risk = compute_expiry_risk(current, risky_extended, max_ttl);
        assert!(
            risk.at_risk_keys > 0 || risk.imminent_keys > 0,
            "Should flag at-risk key"
        );
    }

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn test_batch_size_respected() {
        assert!(MAX_RENEWAL_BATCH_SIZE > 0, "Batch size must be positive");
        assert!(
            MAX_RENEWAL_BATCH_SIZE <= 100,
            "Batch size must respect Soroban resource limits"
        );
    }
}
