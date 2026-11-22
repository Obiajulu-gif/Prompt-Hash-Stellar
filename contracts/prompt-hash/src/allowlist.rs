//! Strict destination and content allow-lists for `PromptHashContract`.
//!
//! Enforces explicit allow-lists for:
//! 1. Payout / settlement destination addresses (`DestinationAllowlist`).
//! 2. Marketplace content categories (`CategoryAllowlist`).
//! 3. Content media URL schemes (`https://`, `ipfs://`, `ar://`).
//!
//! All mutations require admin authorization and preserve existing contract
//! ABIs and error codes (reusing `Error::Unauthorized`,
//! `Error::InvalidCategoryLength`, `Error::InvalidImageUrlLength`, and
//! `Error::InvalidMetadata`).

use crate::types::Error;
use soroban_sdk::{Address, Env, String, Vec};

pub const MAX_ALLOWED_DESTINATIONS: u32 = 64;
pub const MAX_ALLOWED_CATEGORIES: u32 = 32;

/// Strictly allow-listed payout / settlement destination addresses.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DestinationAllowlist {
    entries: Vec<Address>,
}

impl DestinationAllowlist {
    pub fn new(env: &Env) -> Self {
        Self {
            entries: Vec::new(env),
        }
    }

    pub fn len(&self) -> u32 {
        self.entries.len()
    }

    pub fn is_allowed(&self, destination: &Address) -> bool {
        for i in 0..self.entries.len() {
            if let Some(addr) = self.entries.get(i) {
                if &addr == destination {
                    return true;
                }
            }
        }
        false
    }

    pub fn require_allowed(&self, destination: &Address) -> Result<(), Error> {
        if !self.is_allowed(destination) {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    /// Admin-only: adds `destination` to the allow-list (idempotent on retry).
    pub fn add(
        &mut self,
        caller: &Address,
        admin: &Address,
        destination: Address,
    ) -> Result<(), Error> {
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        if self.is_allowed(&destination) {
            return Ok(());
        }
        if self.entries.len() >= MAX_ALLOWED_DESTINATIONS {
            return Err(Error::InvalidMetadata);
        }
        self.entries.push_back(destination);
        Ok(())
    }

    /// Admin-only: revokes `destination` from the allow-list (rollback-safe).
    pub fn remove(
        &mut self,
        env: &Env,
        caller: &Address,
        admin: &Address,
        destination: &Address,
    ) -> Result<bool, Error> {
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        let mut next = Vec::new(env);
        let mut removed = false;
        for i in 0..self.entries.len() {
            if let Some(addr) = self.entries.get(i) {
                if &addr == destination {
                    removed = true;
                } else {
                    next.push_back(addr);
                }
            }
        }
        self.entries = next;
        Ok(removed)
    }
}

/// Strictly allow-listed marketplace content categories.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CategoryAllowlist {
    entries: Vec<String>,
}

impl CategoryAllowlist {
    pub fn new(env: &Env) -> Self {
        Self {
            entries: Vec::new(env),
        }
    }

    pub fn len(&self) -> u32 {
        self.entries.len()
    }

    pub fn is_allowed(&self, category: &String) -> bool {
        for i in 0..self.entries.len() {
            if let Some(cat) = self.entries.get(i) {
                if &cat == category {
                    return true;
                }
            }
        }
        false
    }

    pub fn require_allowed(&self, category: &String) -> Result<(), Error> {
        if !self.is_allowed(category) {
            return Err(Error::InvalidCategoryLength);
        }
        Ok(())
    }

    /// Admin-only: adds `category` to the content allow-list (idempotent).
    pub fn add(
        &mut self,
        caller: &Address,
        admin: &Address,
        category: String,
    ) -> Result<(), Error> {
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        if category.is_empty() {
            return Err(Error::InvalidCategoryLength);
        }
        if self.is_allowed(&category) {
            return Ok(());
        }
        if self.entries.len() >= MAX_ALLOWED_CATEGORIES {
            return Err(Error::InvalidMetadata);
        }
        self.entries.push_back(category);
        Ok(())
    }

    /// Admin-only: removes `category` from the content allow-list.
    pub fn remove(
        &mut self,
        env: &Env,
        caller: &Address,
        admin: &Address,
        category: &String,
    ) -> Result<bool, Error> {
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        let mut next = Vec::new(env);
        let mut removed = false;
        for i in 0..self.entries.len() {
            if let Some(cat) = self.entries.get(i) {
                if &cat == category {
                    removed = true;
                } else {
                    next.push_back(cat);
                }
            }
        }
        self.entries = next;
        Ok(removed)
    }
}

/// Validates that a content URL starts with a strictly allow-listed scheme:
/// `https://`, `ipfs://`, or `ar://`, and has a non-empty host/CID suffix.
pub fn validate_content_url_scheme(url: &String) -> Result<(), Error> {
    let len = url.len() as usize;
    if len < 6 || len > 512 {
        return Err(Error::InvalidImageUrlLength);
    }
    let mut buf = [0u8; 8];
    let prefix_len = if len < 8 { len } else { 8 };
    url.copy_into_slice(&mut buf[..prefix_len]);

    let is_https = prefix_len == 8 && &buf[..8] == b"https://" && len > 8;
    let is_ipfs = prefix_len >= 7 && &buf[..7] == b"ipfs://" && len > 7;
    let is_ar = prefix_len >= 5 && &buf[..5] == b"ar://" && len > 5;

    if is_https || is_ipfs || is_ar {
        Ok(())
    } else {
        Err(Error::InvalidImageUrlLength)
    }
}

/// Unified pre-mutation gate enforcing destination, category, and URL scheme
/// allow-lists.
pub fn validate_listing_allowlists(
    destinations: &DestinationAllowlist,
    categories: &CategoryAllowlist,
    payout_destination: &Address,
    category: &String,
    image_url: &String,
) -> Result<(), Error> {
    destinations.require_allowed(payout_destination)?;
    categories.require_allowed(category)?;
    validate_content_url_scheme(image_url)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn normal_path_allows_registered_destination_category_and_safe_schemes() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);

        let mut dests = DestinationAllowlist::new(&env);
        let mut cats = CategoryAllowlist::new(&env);

        dests.add(&admin, &admin, treasury.clone()).unwrap();
        cats.add(&admin, &admin, String::from_str(&env, "Software Development"))
            .unwrap();

        let cat = String::from_str(&env, "Software Development");
        for url_str in [
            "https://cdn.prompthash.xyz/img/1.png",
            "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            "ar://abc123def456",
        ] {
            let url = String::from_str(&env, url_str);
            assert_eq!(
                validate_listing_allowlists(&dests, &cats, &treasury, &cat, &url),
                Ok(())
            );
        }
    }

    #[test]
    fn failure_path_rejects_unlisted_destination_category_and_unsafe_urls() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let allowed_dest = Address::generate(&env);
        let unknown_dest = Address::generate(&env);

        let mut dests = DestinationAllowlist::new(&env);
        let mut cats = CategoryAllowlist::new(&env);
        dests.add(&admin, &admin, allowed_dest.clone()).unwrap();
        cats.add(&admin, &admin, String::from_str(&env, "Art"))
            .unwrap();

        let allowed_cat = String::from_str(&env, "Art");
        let unknown_cat = String::from_str(&env, "Unapproved");
        let safe_url = String::from_str(&env, "https://example.com/ok.png");

        // Unlisted destination rejected.
        assert_eq!(
            validate_listing_allowlists(&dests, &cats, &unknown_dest, &allowed_cat, &safe_url),
            Err(Error::Unauthorized)
        );

        // Unlisted category rejected.
        assert_eq!(
            validate_listing_allowlists(&dests, &cats, &allowed_dest, &unknown_cat, &safe_url),
            Err(Error::InvalidCategoryLength)
        );

        // Disallowed URL schemes rejected.
        for bad_url in [
            "http://insecure.example.com/a.png",
            "javascript:alert(1)",
            "data:image/png;base64,AAAA",
            "file:///etc/passwd",
            "https://",
            "",
        ] {
            let url = String::from_str(&env, bad_url);
            assert_eq!(
                validate_listing_allowlists(&dests, &cats, &allowed_dest, &allowed_cat, &url),
                Err(Error::InvalidImageUrlLength),
                "Expected bad URL `{}` to be rejected",
                bad_url
            );
        }

        // Cardinality cap enforced on destination allow-list.
        let mut capped = DestinationAllowlist::new(&env);
        for _ in 0..MAX_ALLOWED_DESTINATIONS {
            capped
                .add(&admin, &admin, Address::generate(&env))
                .unwrap();
        }
        assert_eq!(
            capped.add(&admin, &admin, Address::generate(&env)),
            Err(Error::InvalidMetadata)
        );
    }

    #[test]
    fn retry_and_rollback_paths_behave_deterministically() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let partner = Address::generate(&env);
        let cat = String::from_str(&env, "Research");
        let url = String::from_str(&env, "ipfs://QmExampleCid12345");

        let mut dests = DestinationAllowlist::new(&env);
        let mut cats = CategoryAllowlist::new(&env);

        // Initial attempt fails before allow-listing.
        assert_eq!(
            validate_listing_allowlists(&dests, &cats, &partner, &cat, &url),
            Err(Error::Unauthorized)
        );

        // Admin allow-lists destination & category (idempotent duplicate add succeeds).
        dests.add(&admin, &admin, partner.clone()).unwrap();
        dests.add(&admin, &admin, partner.clone()).unwrap();
        assert_eq!(dests.len(), 1);
        cats.add(&admin, &admin, cat.clone()).unwrap();

        // Retry succeeds cleanly.
        assert_eq!(
            validate_listing_allowlists(&dests, &cats, &partner, &cat, &url),
            Ok(())
        );

        // Rollback / revocation: admin removes partner destination.
        assert_eq!(dests.remove(&env, &admin, &admin, &partner), Ok(true));
        assert_eq!(dests.len(), 0);
        assert_eq!(
            validate_listing_allowlists(&dests, &cats, &partner, &cat, &url),
            Err(Error::Unauthorized)
        );
    }

    #[test]
    fn authorization_path_blocks_non_admin_allowlist_mutations() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);
        let cat = String::from_str(&env, "Security");

        let mut dests = DestinationAllowlist::new(&env);
        let mut cats = CategoryAllowlist::new(&env);

        // Attacker cannot add to destination or category allow-lists.
        assert_eq!(
            dests.add(&attacker, &admin, target.clone()),
            Err(Error::Unauthorized)
        );
        assert_eq!(
            cats.add(&attacker, &admin, cat.clone()),
            Err(Error::Unauthorized)
        );
        assert_eq!(dests.len(), 0);
        assert_eq!(cats.len(), 0);

        // Admin adds entries; attacker cannot remove them.
        dests.add(&admin, &admin, target.clone()).unwrap();
        cats.add(&admin, &admin, cat.clone()).unwrap();
        assert_eq!(
            dests.remove(&env, &attacker, &admin, &target),
            Err(Error::Unauthorized)
        );
        assert_eq!(
            cats.remove(&env, &attacker, &admin, &cat),
            Err(Error::Unauthorized)
        );
        assert!(dests.is_allowed(&target));
        assert!(cats.is_allowed(&cat));
    }
}
