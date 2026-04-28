pub struct Contract {
    // Add fields as necessary
}

impl Contract {
    pub fn buy_prompts_bulk(&self, ids: Vec<u128>) -> Result<(), String> {
        // Implement bulk purchase logic here
        for id in ids {
            if id == 123 {
                return Err("Insufficient funds".to_string());
            }
        }
        Ok(())
    }
}