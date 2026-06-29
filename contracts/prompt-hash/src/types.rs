use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Env, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    PromptNotFound = 2,
    CreatorCannotBuy = 3,
    PromptInactive = 4,
    AlreadyPurchased = 5,
    InvalidPrice = 6,
    InvalidFeePercentage = 7,
    InvalidTitleLength = 8,
    InvalidCategoryLength = 9,
    InvalidPreviewLength = 10,
    InvalidEncryptedPromptLength = 11,
    InvalidWrappedKeyLength = 12,
    InvalidImageUrlLength = 13,
    InvalidIvLength = 14,
    FeeWalletNotSet = 15,
    XlmAddressNotSet = 16,
    ArithmeticOverflow = 17,
    ReentrancyGuard = 18,
    ContractIsPaused = 19,
    ReferrerCannotBeBuyerOrCreator = 20,
    InvalidPaymentAmount = 21,
    InvalidVoucher = 22,
    InvalidReferralPercentage = 23,
    InvalidDiscountPercentage = 24,
    MaxSupplyReached = 25,
    InvalidAsset = 26,
    // #50 – revenue splits
    InvalidSplits = 27,
    // #49 – time-bound listing expiry
    ListingExpired = 28,
    LicenseNotFound = 29,
    InvalidLicenseTransfer = 30,
    // #226 – listing revision support
    RevisionFieldsUnchanged = 31,
    // #217 – collaborator split management
    DuplicateSplitRecipient = 32,
    TooManySplits = 33,
    FeeExceedsMaximum = 34,
    DisputeAlreadyOpen = 35,
    DisputeNotFound = 36,
    DisputeResolved = 37,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Prompt(u128),
    PromptCounter,
    FeePercentage,
    FeeWallet,
    XlmAddress,
    CreatorPrompts(Address),
    BuyerPrompts(Address),
    Purchase(u128, Address),
    Reentrancy,
    ReferralPercentage,
    IsPaused,
    VoucherKey(u128, BytesN<32>),
    /// Snapshot of a listing taken before a revision (#226).
    /// Key: (prompt_id, revision_number_before_change)
    ListingRevision(u128, u32),
    PurchaseDispute(u128, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    Open,
    Refunded,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeReason {
    InvalidEncryptedPayload,
    MissingMetadata,
    FailedIntegrityVerification,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PurchaseDispute {
    pub prompt_id: u128,
    pub buyer: Address,
    pub reason: DisputeReason,
    pub opened_at: u64,
    pub resolved_at: u64,
    pub status: DisputeStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Purchase {
    pub prompt_id: u128,
    pub original_creator: Address,
    pub owner: Address,
    pub original_price: i128,
    pub last_transfer_price: i128,
    pub transfer_count: u32,
    pub last_transferred_at: u64,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PricingConfig {
    pub price: i128,
    pub asset: Address,
}

/// A single revenue-split entry stored inside a prompt.
/// `bps` is the share of the full payment (in basis points) paid to `recipient`
/// before the creator receives the remainder.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Split {
    pub recipient: Address,
    pub bps: u32,
}

/// Full listing configuration passed to create_prompt.
/// Bundles pricing, optional expiry, and optional revenue splits into a single
/// parameter so the function stays within Soroban's 10-parameter limit.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingConfig {
    pub price: i128,
    pub asset: Address,
    /// Unix timestamp after which the listing can no longer be purchased.
    /// `0` means the listing never expires.
    pub expires_at: u64,
    /// Optional co-creator revenue splits (empty Vec = no splits).
    pub splits: Vec<Split>,
    /// Search tags used for marketplace discovery. Tags should be lowercase kebab-case.
    pub tags: Vec<String>,
    /// Maximum number of licenses that can be sold (0 = unlimited).
    pub max_supply: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Prompt {
    pub id: u128,
    pub creator: Address,
    pub image_url: String,
    pub title: String,
    pub category: String,
    pub preview_text: String,
    pub encrypted_prompt: String,
    pub encryption_iv: String,
    pub wrapped_key: String,
    pub content_hash: BytesN<32>,
    pub price_stroops: i128,
    pub asset: Address,
    pub active: bool,
    pub sales_count: u64,
    pub max_supply: u64,
    /// Unix timestamp after which the listing can no longer be purchased.
    /// `0` means the listing never expires.
    pub expires_at: u64,
    /// Optional co-creator revenue splits applied against the full payment.
    pub splits: Vec<Split>,
    /// Monotonically increasing revision counter. Starts at 0 on creation and
    /// increments by 1 on each successful `revise_listing` call (#226).
    pub revision: u32,
    /// Search tags used for marketplace discovery. Tags should be lowercase kebab-case.
    pub tags: Vec<String>,
}

/// Snapshot of the mutable listing fields captured before a revision (#226).
/// Stored under `DataKey::ListingRevision(prompt_id, old_revision)` so
/// buyers can verify what metadata was in effect when they purchased.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingRevisionRecord {
    pub prompt_id: u128,
    pub revision: u32,
    pub title: String,
    pub category: String,
    pub preview_text: String,
    pub image_url: String,
    pub price_stroops: i128,
    pub revised_at: u64,
}

pub trait PromptHashTrait {
    fn __constructor(
        env: Env,
        admin: Address,
        fee_wallet: Address,
        xlm_sac: Address,
    ) -> Result<(), Error>;

    #[allow(clippy::too_many_arguments)]
    fn create_prompt(
        env: Env,
        creator: Address,
        image_url: String,
        title: String,
        category: String,
        preview_text: String,
        encrypted_prompt: String,
        encryption_iv: String,
        wrapped_key: String,
        content_hash: BytesN<32>,
        listing: ListingConfig,
    ) -> Result<u128, Error>;

    fn set_prompt_sale_status(
        env: Env,
        creator: Address,
        prompt_id: u128,
        active: bool,
    ) -> Result<(), Error>;

    fn set_prompt_max_supply(
        env: Env,
        creator: Address,
        prompt_id: u128,
        max_supply: u64,
    ) -> Result<(), Error>;

    fn update_prompt_price(
        env: Env,
        creator: Address,
        prompt_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error>;

    fn buy_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u128,
        referrer: Option<Address>,
        payment_amount_stroops: i128,
        voucher: Option<Bytes>,
    ) -> Result<(), Error>;

    fn lease_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u128,
        lease_duration_secs: u64,
    ) -> Result<(), Error>;

    /// Push the expiry date of a listing forward. `new_expires_at` must be
    /// strictly greater than the current ledger timestamp.
    fn extend_listing(
        env: Env,
        creator: Address,
        prompt_id: u128,
        new_expires_at: u64,
    ) -> Result<(), Error>;

    /// Purchase multiple prompts atomically in a single transaction.
    /// `prompt_ids` and `payment_amounts` must have equal length.
    /// An optional `referrer` applies to every prompt in the batch.
    /// If any individual purchase fails the entire transaction reverts.
    fn buy_prompts_bulk(
        env: Env,
        buyer: Address,
        prompt_ids: Vec<u128>,
        payment_amounts: Vec<i128>,
        referrer: Option<Address>,
    ) -> Result<(), Error>;

    fn transfer_license(
        env: Env,
        seller: Address,
        prompt_id: u128,
        new_buyer: Address,
        resale_price: i128,
    ) -> Result<(), Error>;

    /// Update the mutable metadata fields of an existing listing.
    ///
    /// The old title, category, preview_text, image_url, and price_stroops are
    /// preserved as a `ListingRevisionRecord` keyed on the pre-change revision
    /// number. Existing `Purchase` records remain valid — revision does not
    /// affect access rights (#226).
    #[allow(clippy::too_many_arguments)]
    fn revise_listing(
        env: Env,
        creator: Address,
        prompt_id: u128,
        title: String,
        category: String,
        preview_text: String,
        image_url: String,
        price_stroops: i128,
    ) -> Result<u32, Error>;

    /// Return the metadata snapshot for a specific revision number (#226).
    fn get_listing_revision(
        env: Env,
        prompt_id: u128,
        revision: u32,
    ) -> Result<ListingRevisionRecord, Error>;

    /// Replace the collaborator split configuration on an existing listing (#217).
    /// Only the original creator may call this. The new splits must pass the same
    /// validation as `create_prompt` (total bps + fee ≤ 10 000, no zero-bps
    /// entries, no duplicate recipients, at most 10 entries).
    fn update_splits(
        env: Env,
        creator: Address,
        prompt_id: u128,
        new_splits: Vec<Split>,
    ) -> Result<(), Error>;

    fn has_access(env: Env, user: Address, prompt_id: u128) -> Result<bool, Error>;
    fn get_prompt(env: Env, prompt_id: u128) -> Result<Prompt, Error>;
    fn get_all_prompts(env: Env) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_category(env: Env, category: String) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_tag(env: Env, tag: String) -> Result<Vec<Prompt>, Error>;
    fn open_dispute(
        env: Env,
        buyer: Address,
        prompt_id: u128,
        reason: DisputeReason,
    ) -> Result<(), Error>;
    fn resolve_dispute(
        env: Env,
        admin: Address,
        prompt_id: u128,
        buyer: Address,
        refund: bool,
    ) -> Result<(), Error>;
    fn get_dispute(env: Env, prompt_id: u128, buyer: Address) -> Result<PurchaseDispute, Error>;
    fn get_prompts_by_creator(env: Env, creator: Address) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_buyer(env: Env, buyer: Address) -> Result<Vec<Prompt>, Error>;
    fn set_fee_percentage(env: Env, new_fee_percentage: u32) -> Result<(), Error>;
    fn set_fee_wallet(env: Env, new_fee_wallet: Address) -> Result<(), Error>;
    fn get_fee_percentage(env: Env) -> u32;
    fn get_fee_wallet(env: Env) -> Option<Address>;
    fn set_referral_percentage(env: Env, new_referral_percentage: u32) -> Result<(), Error>;
    fn get_referral_percentage(env: Env) -> u32;
    // New platform fee governance API
    fn update_platform_fee(env: Env, admin: Address, new_fee: u32) -> Result<(), Error>;
    fn get_platform_fee(env: Env) -> u32;
    fn set_pause_status(env: Env, paused: bool) -> Result<(), Error>;
    fn is_paused(env: Env) -> bool;
    fn add_voucher(
        env: Env,
        creator: Address,
        prompt_id: u128,
        hashed_code: BytesN<32>,
        discount_bps: u32,
    ) -> Result<(), Error>;
    fn remove_voucher(
        env: Env,
        creator: Address,
        prompt_id: u128,
        hashed_code: BytesN<32>,
    ) -> Result<(), Error>;
    fn get_xlm_sac(env: Env) -> Option<Address>;

    /// Fetch multiple prompts by ID in a single call. Returns only prompts
    /// that exist — missing IDs are silently skipped.
    fn get_prompts_by_ids(env: Env, prompt_ids: Vec<u128>) -> Result<Vec<Prompt>, Error>;

    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error>;
    fn extend_ttl(env: Env, key: DataKey) -> Result<(), Error>;
    /// Bulk-extend TTL for all active storage entries. Intended for periodic
    /// admin maintenance (#26).
    fn extend_all_ttl(env: Env) -> Result<(), Error>;
}
