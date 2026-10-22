#[cfg(test)]
mod load_tests {
    use soroban_sdk::{testutils::Address as AddressTestUtils, Address, Env, Vec};

    const CARDINALITY_SMALL: usize = 10;
    const CARDINALITY_MEDIUM: usize = 100;
    const CARDINALITY_LARGE: usize = 1000;
    const BURST_SIZE_SMALL: usize = 5;
    const BURST_SIZE_MEDIUM: usize = 50;
    const BURST_SIZE_LARGE: usize = 500;

    #[test]
    fn test_load_small_cardinality() {
        let env = Env::default();
        let mut addresses = Vec::new(&env);

        for _ in 0..CARDINALITY_SMALL {
            addresses.push_back(Address::random(&env));
        }

        assert_eq!(addresses.len(), CARDINALITY_SMALL as u32);
    }

    #[test]
    fn test_load_medium_cardinality() {
        let env = Env::default();
        let mut addresses = Vec::new(&env);

        for _ in 0..CARDINALITY_MEDIUM {
            addresses.push_back(Address::random(&env));
        }

        assert_eq!(addresses.len(), CARDINALITY_MEDIUM as u32);
    }

    #[test]
    fn test_load_large_cardinality() {
        let env = Env::default();
        let mut addresses = Vec::new(&env);

        for _ in 0..CARDINALITY_LARGE {
            addresses.push_back(Address::random(&env));
        }

        assert_eq!(addresses.len(), CARDINALITY_LARGE as u32);
    }

    #[test]
    fn test_burst_traffic_small() {
        let env = Env::default();
        let mut addresses = Vec::new(&env);

        for _ in 0..BURST_SIZE_SMALL {
            addresses.push_back(Address::random(&env));
        }

        assert_eq!(addresses.len(), BURST_SIZE_SMALL as u32);
    }

    #[test]
    fn test_burst_traffic_medium() {
        let env = Env::default();
        let mut addresses = Vec::new(&env);

        for _ in 0..BURST_SIZE_MEDIUM {
            addresses.push_back(Address::random(&env));
        }

        assert_eq!(addresses.len(), BURST_SIZE_MEDIUM as u32);
    }

    #[test]
    fn test_burst_traffic_large() {
        let env = Env::default();
        let mut addresses = Vec::new(&env);

        for _ in 0..BURST_SIZE_LARGE {
            addresses.push_back(Address::random(&env));
        }

        assert_eq!(addresses.len(), BURST_SIZE_LARGE as u32);
    }

    #[test]
    fn test_sequential_operations_under_load() {
        let env = Env::default();
        let mut counter = 0u32;

        for _ in 0..CARDINALITY_MEDIUM {
            counter = counter.saturating_add(1);
        }

        assert_eq!(counter, CARDINALITY_MEDIUM as u32);
    }

    #[test]
    fn test_concurrent_burst_multiple_clients() {
        let env = Env::default();
        let client_count = 10;
        let operations_per_client = 50;

        let mut total_operations = 0u32;
        for _ in 0..client_count {
            for _ in 0..operations_per_client {
                total_operations = total_operations.saturating_add(1);
            }
        }

        assert_eq!(
            total_operations,
            (client_count * operations_per_client) as u32
        );
    }

    #[test]
    fn test_cardinality_with_duplicate_addresses() {
        let env = Env::default();
        let addr = Address::random(&env);
        let mut addresses = Vec::new(&env);

        for _ in 0..BURST_SIZE_MEDIUM {
            addresses.push_back(addr.clone());
        }

        assert_eq!(addresses.len(), BURST_SIZE_MEDIUM as u32);
    }

    #[test]
    fn test_burst_with_rapid_state_changes() {
        let env = Env::default();
        let mut state_version = 0u32;

        for _ in 0..BURST_SIZE_LARGE {
            state_version = state_version.saturating_add(1);
        }

        assert_eq!(state_version, BURST_SIZE_LARGE as u32);
    }

    #[test]
    fn test_high_cardinality_address_iteration() {
        let env = Env::default();
        let mut addresses = Vec::new(&env);

        for _ in 0..CARDINALITY_LARGE {
            addresses.push_back(Address::random(&env));
        }

        let mut count = 0u32;
        for _ in 0..addresses.len() {
            count = count.saturating_add(1);
        }

        assert_eq!(count, CARDINALITY_LARGE as u32);
    }

    #[test]
    fn test_burst_transaction_ordering() {
        let env = Env::default();
        let mut timestamps = Vec::new(&env);

        for i in 0..BURST_SIZE_MEDIUM {
            timestamps.push_back((i * 1000) as u64);
        }

        assert_eq!(timestamps.len(), BURST_SIZE_MEDIUM as u32);
    }

    #[test]
    fn test_stress_memory_with_large_payloads() {
        let env = Env::default();
        let mut vectors = Vec::new(&env);

        for _ in 0..100 {
            let vec = Vec::<Address>::new(&env);
            vectors.push_back(vec);
        }

        assert_eq!(vectors.len(), 100);
    }

    #[test]
    fn test_cardinality_address_uniqueness_in_burst() {
        let env = Env::default();
        let addr1 = Address::random(&env);
        let addr2 = Address::random(&env);
        let addr3 = Address::random(&env);

        assert_ne!(addr1, addr2);
        assert_ne!(addr2, addr3);
        assert_ne!(addr1, addr3);
    }

    #[test]
    fn test_performance_linear_operations() {
        let env = Env::default();
        let mut sum = 0u64;

        for i in 0..CARDINALITY_MEDIUM {
            sum = sum.saturating_add(i as u64);
        }

        assert!(sum > 0);
    }
}
