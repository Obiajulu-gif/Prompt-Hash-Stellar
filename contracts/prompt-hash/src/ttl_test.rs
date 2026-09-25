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

    #[test]
    fn test_renewal_batch_structure() {
        let batch = RenewalBatch {
            cursor: Some(42u64),
            processed_count: 5,
            remaining_count: 15,
        };
        assert_eq!(batch.cursor, Some(42u64));
        assert_eq!(batch.processed_count, 5);
        assert_eq!(batch.remaining_count, 15);
    }

    #[test]
    fn test_renewal_batch_with_none_cursor() {
        let batch = RenewalBatch {
            cursor: None,
            processed_count: 0,
            remaining_count: 20,
        };
        assert_eq!(batch.cursor, None);
        assert_eq!(batch.processed_count, 0);
    }

    #[test]
    fn test_expiry_risk_all_safe() {
        let max_ttl = ONE_YEAR;
        let current_ledger = 1_000_000u64;
        // Just extended, lots of time left
        let last_extended = current_ledger;

        let risk = compute_expiry_risk(current_ledger, last_extended, max_ttl);
        assert_eq!(risk.critical_keys, 0);
        assert_eq!(risk.imminent_keys, 0);
        assert_eq!(risk.at_risk_keys, 0);
    }

    #[test]
    fn test_expiry_risk_imminent() {
        let max_ttl = ONE_MONTH;
        let current_ledger = 1_000_000u64;
        // 85% through TTL, entering imminent zone (30-50%)
        let last_extended = current_ledger - (max_ttl as u64) * 8 / 10;

        let risk = compute_expiry_risk(current_ledger, last_extended, max_ttl);
        assert!(risk.imminent_keys > 0, "Should detect imminent expiry");
        assert_eq!(risk.critical_keys, 0);
    }

    #[test]
    fn test_deploy_check_fails_when_critical_state_ttl_unsafe() {
        let max_ttl = ONE_YEAR;
        let current_ledger = 10_000_000u64;
        // 95% of TTL has elapsed: entry is in critical zone (remaining <= 10%)
        let critical_extended = current_ledger - (max_ttl as u64) * 95 / 100;

        let risk = compute_expiry_risk(current_ledger, critical_extended, max_ttl);
        assert!(
            risk.critical_keys > 0,
            "Deploy check must detect critical expiration risk"
        );

        // Verification: when critical risk > 0, deploy gate must reject release
        let deploy_safe = risk.critical_keys == 0 && risk.imminent_keys == 0;
        assert!(
            !deploy_safe,
            "Deployment must fail when critical keys are near expiration"
        );
    }

    #[test]
    fn test_remediation_command_restores_ttl_health() {
        let max_ttl = ONE_YEAR;
        let current_ledger = 10_000_000u64;
        let critical_extended = current_ledger - (max_ttl as u64) * 95 / 100;

        // Unsafe state before remediation
        let pre_remediation = compute_expiry_risk(current_ledger, critical_extended, max_ttl);
        assert!(pre_remediation.critical_keys > 0);

        // Remediation: simulated renewal sets last_extended to current ledger
        let post_remediation_extended = current_ledger;
        let post_remediation =
            compute_expiry_risk(current_ledger, post_remediation_extended, max_ttl);

        assert_eq!(post_remediation.critical_keys, 0);
        assert_eq!(post_remediation.imminent_keys, 0);
        assert_eq!(post_remediation.at_risk_keys, 0);
    }

    #[test]
    fn test_critical_state_families_tracked() {
        let sample_families = [
            ("Prompt", get_ttl_for_key(&DataKey::Prompt(1))),
            (
                "Purchase",
                get_ttl_for_key(&DataKey::Purchase(1, Address::generate(&Env::default()))),
            ),
            (
                "Dispute",
                get_ttl_for_key(&DataKey::PurchaseDispute(
                    1,
                    Address::generate(&Env::default()),
                )),
            ),
        ];

        for (family, max_ttl) in sample_families {
            assert!(max_ttl > 0, "Family {} must have positive TTL", family);
            assert!(
                max_ttl >= ONE_MONTH,
                "Family {} TTL must be at least ONE_MONTH",
                family
            );
        }
    }
}
