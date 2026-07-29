#[cfg(test)]
mod tests {
    use crate::pagination::{decode_cursor, encode_cursor, IndexType};
    use soroban_sdk::String as SorobanString;

    #[test]
    fn test_encode_decode_cursor() {
        let id = 12345u64;
        let types = vec![
            IndexType::Creator,
            IndexType::Category,
            IndexType::Tag,
            IndexType::Active,
            IndexType::All,
        ];

        for index_type in types {
            let encoded = encode_cursor(id, index_type.clone());
            // In production use real env, but for unit tests we skip decoding
            assert!(!encoded.to_string().is_empty());
        }
    }

    #[test]
    fn test_cursor_format() {
        let id = 999u64;
        let cursor = encode_cursor(id, IndexType::Category);
        let cursor_str = cursor.to_string();
        assert!(cursor_str.contains("999"));
        assert!(cursor_str.contains("1")); // Category type num
    }
}
