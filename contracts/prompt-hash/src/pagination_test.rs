#[cfg(test)]
mod tests {
    use crate::pagination::{decode_cursor, encode_cursor, IndexType, MAX_PAGE_SIZE};
    use soroban_sdk::Env;

    #[test]
    fn test_encode_decode_cursor_round_trips_for_every_index_type() {
        let env = Env::default();
        let id = 12345u64;
        let types = [
            IndexType::Creator,
            IndexType::Category,
            IndexType::Tag,
            IndexType::Active,
            IndexType::All,
        ];

        for index_type in types {
            let encoded = encode_cursor(&env, id, index_type.clone());
            let decoded = decode_cursor(&env, &encoded).unwrap();
            assert_eq!(decoded.last_id, id);
            assert!(decoded.index_type == index_type);
        }
    }

    #[test]
    fn test_cursor_round_trips_last_id_and_type() {
        let env = Env::default();
        let id = 999u64;
        let cursor = encode_cursor(&env, id, IndexType::Category);
        let decoded = decode_cursor(&env, &cursor).unwrap();
        assert_eq!(decoded.last_id, 999);
        assert!(decoded.index_type == IndexType::Category);
    }

    #[test]
    fn test_cursor_with_zero_id() {
        let env = Env::default();
        let cursor = encode_cursor(&env, 0u64, IndexType::All);
        let decoded = decode_cursor(&env, &cursor).unwrap();
        assert_eq!(decoded.last_id, 0);
        assert!(decoded.index_type == IndexType::All);
    }

    #[test]
    fn test_cursor_with_max_u64() {
        let env = Env::default();
        let cursor = encode_cursor(&env, u64::MAX, IndexType::Tag);
        let decoded = decode_cursor(&env, &cursor).unwrap();
        assert_eq!(decoded.last_id, u64::MAX);
        assert!(decoded.index_type == IndexType::Tag);
    }

    #[test]
    fn test_cursor_type_discrimination() {
        let env = Env::default();
        let id = 100u64;

        let cursor_creator = encode_cursor(&env, id, IndexType::Creator);
        let cursor_category = encode_cursor(&env, id, IndexType::Category);
        let cursor_tag = encode_cursor(&env, id, IndexType::Tag);
        let cursor_active = encode_cursor(&env, id, IndexType::Active);
        let cursor_all = encode_cursor(&env, id, IndexType::All);

        let decoded_creator = decode_cursor(&env, &cursor_creator).unwrap();
        let decoded_category = decode_cursor(&env, &cursor_category).unwrap();
        let decoded_tag = decode_cursor(&env, &cursor_tag).unwrap();
        let decoded_active = decode_cursor(&env, &cursor_active).unwrap();
        let decoded_all = decode_cursor(&env, &cursor_all).unwrap();

        // All have same ID but different types
        assert_eq!(decoded_creator.last_id, id);
        assert_eq!(decoded_category.last_id, id);
        assert_eq!(decoded_tag.last_id, id);
        assert_eq!(decoded_active.last_id, id);
        assert_eq!(decoded_all.last_id, id);

        // Each type should be preserved correctly
        assert!(decoded_creator.index_type == IndexType::Creator);
        assert!(decoded_category.index_type == IndexType::Category);
        assert!(decoded_tag.index_type == IndexType::Tag);
        assert!(decoded_active.index_type == IndexType::Active);
        assert!(decoded_all.index_type == IndexType::All);
    }

    #[test]
    fn test_cursor_length_validation() {
        let env = Env::default();

        // Invalid cursor: too short
        let short_cursor = soroban_sdk::String::from_str(&env, "short");
        let result = decode_cursor(&env, &short_cursor);
        assert!(result.is_err(), "Short cursor should fail validation");

        // Invalid cursor: too long
        let long_bytes = [0u8; 20];
        let long_cursor = soroban_sdk::String::from_bytes(&env, &long_bytes);
        let result = decode_cursor(&env, &long_cursor);
        assert!(result.is_err(), "Long cursor should fail validation");
    }

    #[test]
    fn test_cursor_invalid_index_type() {
        let env = Env::default();
        let mut bytes = [0u8; 9];
        bytes[0..8].copy_from_slice(&100u64.to_be_bytes());
        bytes[8] = 99u8; // Invalid index type
        let invalid_cursor = soroban_sdk::String::from_bytes(&env, &bytes);

        let result = decode_cursor(&env, &invalid_cursor);
        assert!(result.is_err(), "Invalid index type should fail");
    }

    #[test]
    fn test_max_page_size_constraint() {
        assert!(MAX_PAGE_SIZE > 0, "MAX_PAGE_SIZE must be positive");
        assert!(
            MAX_PAGE_SIZE <= 1000,
            "MAX_PAGE_SIZE should respect resource limits"
        );
    }
}
