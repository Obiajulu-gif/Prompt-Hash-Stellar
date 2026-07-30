#[cfg(test)]
mod tests {
    use crate::pagination::{decode_cursor, encode_cursor, IndexType};
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
}
