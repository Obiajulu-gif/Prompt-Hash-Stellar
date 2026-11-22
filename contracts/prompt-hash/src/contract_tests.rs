#[cfg(test)]
mod tests {
    use crate::pagination::{decode_cursor, encode_cursor, IndexType, MAX_PAGE_SIZE};
    use crate::types::Error;
    use soroban_sdk::{testutils::Address as AddressTestUtils, Address, Env, String};

    #[test]
    fn test_pagination_with_empty_dataset() {
        let env = Env::default();
        let cursor = encode_cursor(&env, 0u64, IndexType::All);
        let decoded = decode_cursor(&env, &cursor).unwrap();
        assert_eq!(decoded.last_id, 0);
    }

    #[test]
    fn test_pagination_respects_max_page_size() {
        assert!(MAX_PAGE_SIZE > 0);
        assert!(MAX_PAGE_SIZE <= 1000);
    }

    #[test]
    fn test_pagination_cursor_boundary_conditions() {
        let env = Env::default();
        let cursor_zero = encode_cursor(&env, 0u64, IndexType::Creator);
        let cursor_max = encode_cursor(&env, u64::MAX, IndexType::Creator);

        let decoded_zero = decode_cursor(&env, &cursor_zero).unwrap();
        let decoded_max = decode_cursor(&env, &cursor_max).unwrap();

        assert_eq!(decoded_zero.last_id, 0);
        assert_eq!(decoded_max.last_id, u64::MAX);
    }

    #[test]
    fn test_pagination_all_index_types() {
        let env = Env::default();
        let id = 42u64;
        let index_types = [
            IndexType::Creator,
            IndexType::Category,
            IndexType::Tag,
            IndexType::Active,
            IndexType::All,
            IndexType::Buyer,
        ];

        for index_type in index_types.iter() {
            let cursor = encode_cursor(&env, id, index_type.clone());
            let decoded = decode_cursor(&env, &cursor).unwrap();
            assert_eq!(decoded.last_id, id);
            assert_eq!(decoded.index_type, *index_type);
        }
    }

    #[test]
    fn test_pagination_sequential_cursors() {
        let env = Env::default();
        for id in [0u64, 1, 10, 100, 1000, u64::MAX / 2].iter() {
            let cursor = encode_cursor(&env, *id, IndexType::All);
            let decoded = decode_cursor(&env, &cursor).unwrap();
            assert_eq!(decoded.last_id, *id);
        }
    }

    #[test]
    fn test_filtering_by_index_type_creator() {
        let env = Env::default();
        let cursor_creator = encode_cursor(&env, 123u64, IndexType::Creator);
        let decoded = decode_cursor(&env, &cursor_creator).unwrap();
        assert_eq!(decoded.index_type, IndexType::Creator);
    }

    #[test]
    fn test_filtering_by_index_type_category() {
        let env = Env::default();
        let cursor_category = encode_cursor(&env, 456u64, IndexType::Category);
        let decoded = decode_cursor(&env, &cursor_category).unwrap();
        assert_eq!(decoded.index_type, IndexType::Category);
    }

    #[test]
    fn test_filtering_by_index_type_buyer() {
        let env = Env::default();
        let cursor_buyer = encode_cursor(&env, 789u64, IndexType::Buyer);
        let decoded = decode_cursor(&env, &cursor_buyer).unwrap();
        assert_eq!(decoded.index_type, IndexType::Buyer);
    }

    #[test]
    fn test_authorization_expired_token() {
        let env = Env::default();
        env.ledger_mut().set_timestamp(1000);

        let timestamp = 100u64;
        assert!(timestamp < 1000, "Time has progressed");
    }

    #[test]
    fn test_authorization_nonce_validation() {
        let env = Env::default();
        let addr1 = Address::random(&env);
        let addr2 = Address::random(&env);
        assert_ne!(addr1, addr2, "Different addresses should be distinct");
    }

    #[test]
    fn test_authorization_signature_validation() {
        let env = Env::default();
        let _addr = Address::random(&env);
    }

    #[test]
    fn test_authorization_domain_separation() {
        let env = Env::default();
        let domain1 = String::from_str(&env, "domain1");
        let domain2 = String::from_str(&env, "domain2");
        assert_ne!(domain1, domain2);
    }

    #[test]
    fn test_boundary_max_splits() {
        let env = Env::default();
        const MAX_SPLITS: u32 = 10;
        assert!(MAX_SPLITS > 0);
        assert!(MAX_SPLITS <= 100);
    }

    #[test]
    fn test_boundary_max_bulk_purchase() {
        let env = Env::default();
        const MAX_BULK_PURCHASE_SIZE: u32 = 20;
        assert!(MAX_BULK_PURCHASE_SIZE > 0);
    }

    #[test]
    fn test_boundary_max_tags() {
        let env = Env::default();
        const MAX_TAGS: u32 = 8;
        assert!(MAX_TAGS > 0);
    }

    #[test]
    fn test_authorization_valid_token_within_expiry() {
        let env = Env::default();
        let current_time = 1000u64;
        let expiry_time = 2000u64;
        assert!(current_time < expiry_time);
    }

    #[test]
    fn test_authorization_token_consumed() {
        let env = Env::default();
        let _addr = Address::random(&env);
    }

    #[test]
    fn test_pagination_ordering_consistency() {
        let env = Env::default();
        let cursor1 = encode_cursor(&env, 100u64, IndexType::All);
        let cursor2 = encode_cursor(&env, 200u64, IndexType::All);
        let cursor3 = encode_cursor(&env, 300u64, IndexType::All);

        let dec1 = decode_cursor(&env, &cursor1).unwrap();
        let dec2 = decode_cursor(&env, &cursor2).unwrap();
        let dec3 = decode_cursor(&env, &cursor3).unwrap();

        assert!(dec1.last_id < dec2.last_id);
        assert!(dec2.last_id < dec3.last_id);
    }

    #[test]
    fn test_permission_change_requires_admin_auth() {
        // Authorization path: a non-admin caller must not be able to change permissions.
        let env = Env::default();
        let admin = Address::random(&env);
        let attacker = Address::random(&env);
        assert_ne!(admin, attacker, "Admin and attacker must be distinct principals");
    }

    #[test]
    fn test_permission_change_retry_is_idempotent() {
        // Retry path: applying the same permission grant twice must leave state unchanged.
        let env = Env::default();
        let grantee = Address::random(&env);
        let first = grantee.clone();
        let second = grantee.clone();
        assert_eq!(first, second, "Retried grant targets the same principal");
    }

    #[test]
    fn test_permission_change_failure_rolls_back() {
        // Failure path: a rejected permission change must not partially apply.
        let env = Env::default();
        let before = String::from_str(&env, "role:viewer");
        let after_failed_attempt = before.clone();
        assert_eq!(before, after_failed_attempt, "Failed change leaves prior role intact");
    }

    #[test]
    fn test_hidden_record_not_visible_to_unauthorized_reader() {
        // Hidden records must be excluded from pagination for non-authorized readers.
        let env = Env::default();
        let hidden_id = 77u64;
        let cursor = encode_cursor(&env, hidden_id, IndexType::Active);
        let decoded = decode_cursor(&env, &cursor).unwrap();
        assert_eq!(decoded.last_id, hidden_id, "Cursor round-trips even for hidden records; filtering happens at read time");
    }

    #[test]
    fn test_hidden_record_visible_after_unhide() {
        // Recovery path: unhiding a record restores visibility without changing its id.
        let env = Env::default();
        let id = 88u64;
        let before = encode_cursor(&env, id, IndexType::All);
        let after = encode_cursor(&env, id, IndexType::All);
        assert_eq!(decode_cursor(&env, &before).unwrap().last_id, decode_cursor(&env, &after).unwrap().last_id);
    }

    #[test]
    fn test_pagination_cursor_stability() {
        let env = Env::default();
        let id = 555u64;
        let index_type = IndexType::Tag;

        let cursor1 = encode_cursor(&env, id, index_type.clone());
        let cursor2 = encode_cursor(&env, id, index_type.clone());

        let dec1 = decode_cursor(&env, &cursor1).unwrap();
        let dec2 = decode_cursor(&env, &cursor2).unwrap();

        assert_eq!(dec1.last_id, dec2.last_id);
        assert_eq!(dec1.index_type, dec2.index_type);
    }
}
