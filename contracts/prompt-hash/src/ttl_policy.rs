// TTL (Time-To-Live) policy for persistent contract storage.
// Defines retention periods and automatic renewal strategies to prevent
// data corruption and access state violations.

use crate::types::{DataKey, Error};
use soroban_sdk::{Address, Env};

/// TTL constants (in ledgers, ~6 seconds per ledger)
/// Reference: 1 day ≈ 14,400 ledgers, 1 year ≈ 5.256M ledgers

pub const ONE_DAY: u32 = 14_400;
pub const ONE_WEEK: u32 = 7 * ONE_DAY;
pub const ONE_MONTH: u32 = 30 * ONE_DAY;
pub const ONE_YEAR: u32 = 365 * ONE_DAY;

/// Minimum threshold before a key requires renewal (at 70% of max TTL)
pub const RENEWAL_THRESHOLD_PCT: u32 = 70;

/// Max keys to process per renewal batch (respects Soroban resource limits)
pub const MAX_RENEWAL_BATCH_SIZE: u32 = 20;

/// TTL policy for each DataKey variant
/// Ensures entitlements don't expire before supporting records
pub fn get_ttl_for_key(key: &DataKey) -> u32 {
    match key {
        // Instance keys — no TTL, never expire
        DataKey::PromptCounter
        | DataKey::FeePercentage
        | DataKey::FeeWallet
        | DataKey::XlmAddress
        | DataKey::Reentrancy
        | DataKey::ReferralPercentage
        | DataKey::IsPaused => u32::MAX, // No renewal

        // Prompts — longer TTL, renewed on each access
        DataKey::Prompt(_) => ONE_YEAR,
        DataKey::CreatorPrompts(_) => ONE_YEAR,

        // Purchases & access entitlements — long TTL, critical to preserve
        // Must outlive disputes and escrows
        DataKey::Purchase(_, _) => ONE_YEAR + ONE_MONTH,
        DataKey::CatalogPass(_, _) => ONE_YEAR + ONE_MONTH,

        // Escrow & settlement — tie to purchase TTL, auto-extend with parent
        DataKey::PurchaseEscrow(_, _) => ONE_YEAR + ONE_MONTH,

        // Disputes — shorter than purchase, auto-settle or escalate
        DataKey::PurchaseDispute(_, _) => ONE_MONTH,

        // Revisions — tied to prompt, extended with parent
        DataKey::ListingRevision(_, _) => ONE_YEAR,

        // Bundles & access passes
        DataKey::Bundle(_) => ONE_YEAR,
        DataKey::BundleCounter => ONE_YEAR,
        DataKey::CreatorBundles(_) => ONE_YEAR,
        DataKey::AccessPass(_) => ONE_YEAR,
        DataKey::AccessPassCounter => ONE_YEAR,
        DataKey::CreatorAccessPasses(_) => ONE_YEAR,

        // Secondary indexes (pagination)
        DataKey::CategoryPrompts(_) => ONE_YEAR,
        DataKey::TagPrompts(_) => ONE_YEAR,
        DataKey::ActivePrompts => ONE_YEAR,
        DataKey::AllPrompts => ONE_YEAR,

        // Buyer tracking
        DataKey::BuyerPrompts(_) => ONE_YEAR,

        // Vouchers — shorter, tied to prompt
        DataKey::VoucherKey(_, _) => ONE_MONTH,
    }
}

/// TTL dependency graph: which keys must be renewed together
#[derive(Clone, Debug)]
pub enum TTLDependency {
    /// This key can expire independently
    Independent,
    /// This key must match the TTL of its parent (renewed together)
    /// Format: (parent_key_description, logic_to_check)
    DependsOn(&'static str),
}

pub fn get_ttl_dependency(key: &DataKey) -> TTLDependency {
    match key {
        // Purchases are independent but critical
        DataKey::Purchase(_, _) => TTLDependency::Independent,

        // Escrow depends on purchase (same buyer/prompt pair)
        DataKey::PurchaseEscrow(_, _) => TTLDependency::DependsOn("Purchase"),

        // Disputes depend on purchase
        DataKey::PurchaseDispute(_, _) => TTLDependency::DependsOn("Purchase"),

        // Revisions depend on prompt
        DataKey::ListingRevision(_, _) => TTLDependency::DependsOn("Prompt"),

        // Vouchers depend on prompt
        DataKey::VoucherKey(_, _) => TTLDependency::DependsOn("Prompt"),

        // Catalog pass is independent
        DataKey::CatalogPass(_, _) => TTLDependency::Independent,

        // Everything else is independent
        _ => TTLDependency::Independent,
    }
}

/// Renewal batch state for cursor-based resumable processing
#[derive(Clone)]
pub struct RenewalBatch {
    /// Last processed key ID (None = start from beginning)
    pub cursor: Option<u64>,
    /// How many keys were processed in this batch
    pub processed_count: u32,
    /// How many keys still need renewal
    pub remaining_count: u32,
}

/// Expiry risk metric for monitoring
#[derive(Clone)]
pub struct ExpiryRisk {
    /// Key is within 30% of max TTL (imminent renewal needed)
    pub imminent_keys: u32,
    /// Key is within 50% of max TTL (renewal soon)
    pub at_risk_keys: u32,
    /// Key already expired or will expire next ledger
    pub critical_keys: u32,
}

/// Check if a key needs renewal based on current ledger and last extension
pub fn should_renew_key(
    current_ledger: u64,
    last_extended_ledger: u64,
    max_ttl: u32,
) -> bool {
    let age = current_ledger.saturating_sub(last_extended_ledger);
    let renewal_threshold = (max_ttl as u64) * (RENEWAL_THRESHOLD_PCT as u64) / 100;
    age >= renewal_threshold
}

/// Compute time remaining before expiry (in ledgers)
pub fn get_time_remaining(
    current_ledger: u64,
    last_extended_ledger: u64,
    max_ttl: u32,
) -> u64 {
    let age = current_ledger.saturating_sub(last_extended_ledger);
    let expiry_at = last_extended_ledger.saturating_add(max_ttl as u64);
    expiry_at.saturating_sub(current_ledger)
}

/// Validate that dependent keys have sufficient TTL protection
pub fn validate_ttl_dependency(
    env: &Env,
    parent_key: &DataKey,
    child_key: &DataKey,
    parent_last_extended: u64,
    child_last_extended: u64,
) -> Result<(), Error> {
    let parent_ttl = get_ttl_for_key(parent_key);
    let child_ttl = get_ttl_for_key(child_key);

    // Child TTL must be at least as long as parent
    // Actually: child_last_extended must be >= parent_last_extended
    // so they expire at the same time or child expires later
    if child_last_extended < parent_last_extended {
        return Err(Error::InvalidTtlPolicy);
    }

    Ok(())
}

/// Estimate expiry risk metrics for operator monitoring
pub fn compute_expiry_risk(
    current_ledger: u64,
    last_extended_ledger: u64,
    max_ttl: u32,
) -> ExpiryRisk {
    let time_remaining = get_time_remaining(current_ledger, last_extended_ledger, max_ttl);
    let critical_threshold = (max_ttl as u64) / 10; // 10% = imminent
    let at_risk_threshold = (max_ttl as u64) / 2; // 50%
    let imminent_threshold = (max_ttl as u64) * 3 / 10; // 30%

    let (critical, at_risk, imminent) = if time_remaining <= critical_threshold {
        (1, 0, 0)
    } else if time_remaining <= imminent_threshold {
        (0, 0, 1)
    } else if time_remaining <= at_risk_threshold {
        (0, 1, 0)
    } else {
        (0, 0, 0)
    };

    ExpiryRisk {
        critical_keys: critical,
        imminent_keys: imminent,
        at_risk_keys: at_risk,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ttl_for_all_keys() {
        // Ensure every DataKey variant has a TTL policy
        let sample_keys = vec![
            DataKey::Prompt(1),
            DataKey::Purchase(1, Address::from_contract_id(&soroban_sdk::Env::default())),
            DataKey::PurchaseEscrow(1, Address::from_contract_id(&soroban_sdk::Env::default())),
        ];

        for key in sample_keys {
            let ttl = get_ttl_for_key(&key);
            assert!(ttl > 0 || ttl == u32::MAX, "Key {:?} must have valid TTL", key);
        }
    }

    #[test]
    fn test_renewal_threshold() {
        let max_ttl = ONE_YEAR;
        let current_ledger = 0u64;
        let last_extended = 0u64;

        // At start, should not need renewal
        assert!(!should_renew_key(current_ledger, last_extended, max_ttl));

        // After 70% of TTL, should need renewal
        let renewal_point = (max_ttl as u64) * 70 / 100;
        assert!(should_renew_key(current_ledger + renewal_point, last_extended, max_ttl));
    }

    #[test]
    fn test_time_remaining() {
        let max_ttl = ONE_MONTH;
        let current_ledger = 100_000u64;
        let last_extended = 50_000u64;

        let remaining = get_time_remaining(current_ledger, last_extended, max_ttl);
        let age = current_ledger - last_extended;
        let expected = (max_ttl as u64) - age;
        assert_eq!(remaining, expected);
    }

    #[test]
    fn test_expiry_risk_critical() {
        let max_ttl = ONE_MONTH;
        let current_ledger = 100_000u64;
        let last_extended = 100_000u64 - (max_ttl as u64) / 10 + 100; // Just past critical threshold

        let risk = compute_expiry_risk(current_ledger, last_extended, max_ttl);
        assert!(risk.critical_keys > 0, "Should detect critical expiry risk");
    }

    #[test]
    fn test_expiry_risk_at_risk() {
        let max_ttl = ONE_MONTH;
        let current_ledger = 100_000u64;
        let last_extended = 100_000u64 - (max_ttl as u64) / 3; // 33% through lifetime

        let risk = compute_expiry_risk(current_ledger, last_extended, max_ttl);
        assert!(risk.at_risk_keys > 0 || risk.imminent_keys > 0, "Should detect at-risk keys");
    }
}
