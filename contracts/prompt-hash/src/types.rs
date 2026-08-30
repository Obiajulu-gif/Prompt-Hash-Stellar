use soroban_sdk::{
    contracterror, contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, IntoVal, String, Vec,
};

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
    InvalidSplits = 27,
    ListingExpired = 28,
    LicenseNotFound = 29,
    InvalidLicenseTransfer = 30,
    RevisionFieldsUnchanged = 31,
    DuplicateSplitRecipient = 32,
    TooManySplits = 33,
    FeeExceedsMaximum = 34,
    DisputeAlreadyOpen = 35,
    DisputeNotFound = 36,
    DisputeResolved = 37,
    InvalidBundle = 38,
    BundleNotFound = 39,
    AccessPassNotFound = 40,
    InvalidAccessDuration = 41,
    BulkPurchaseTooLarge = 42,
    DuplicatePromptId = 43,
    InvalidStatusTransition = 44,
    AlreadyInitialized = 45,
    InvalidCursor = 46,
    InvalidTtlPolicy = 47,
    AuthorizationExpired = 48,
    AuthorizationNonceConsumed = 49,
    InvalidAuthorizationSignature = 50,
    AuthorizationBuyerMismatch = 51,
    AuthorizationPromptMismatch = 52,
    AuthorizationDomainMismatch = 53,
    AuthorizationNotYetValid = 54,

    // Signed quote commitments and slippage protection (#565).
    QuoteExpired = 55,
    QuoteNotYetValid = 56,
    QuoteNonceConsumed = 57,
    QuoteDomainMismatch = 58,
    QuoteAcquisitionMismatch = 59,
    QuoteAssetMismatch = 60,
    /// The listing revision or fee/split configuration changed after the quote
    /// was produced, so a committed commercial term no longer holds.
    QuoteTermsChanged = 61,
    /// The charge computed at execution exceeds the quote's authorized amount.
    QuoteChargeExceeded = 62,
    /// A tip was supplied without an explicit tip amount on the quote.
    UnauthorizedTip = 63,

    // Append-only settlement records (#567).
    SettlementNotFound = 64,
    SettlementAlreadyFinalized = 65,
    /// The entitlement pointer does not reference the settlement being acted on.
    SettlementEntitlementMismatch = 66,
    DuplicateSettlementSubmission = 67,

    // Signed resale orders (#568).
    ResaleOrderNotFound = 68,
    ResaleOrderExpired = 69,
    ResaleOrderCancelled = 70,
    ResaleOrderNonceConsumed = 71,
    ResaleOrderBuyerMismatch = 72,
    ResaleOrderDomainMismatch = 73,
    /// The seller no longer holds the entitlement the order was written against.
    ResaleOrderOwnershipChanged = 74,
    /// Proceeds after royalties fall below the seller's stated minimum.
    ResaleProceedsBelowMinimum = 75,
    InvalidResaleOrderSignature = 76,

    // Two-phase governance (#569).
    GovernanceProposalNotFound = 77,
    GovernanceProposalExists = 78,
    GovernanceDelayNotElapsed = 79,
    GovernanceProposalExpired = 80,
    /// Current configuration no longer matches the proposal's expected state.
    GovernanceStateMismatch = 81,
    GovernanceNonceConsumed = 82,
    InvalidGovernanceDelay = 83,

    MaxSupplyBelowCommitted = 84,
    DisputeWindowClosed = 85,
    DisputeWindowNotElapsed = 86,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PromptSaleStatus {
    Draft,
    Active,
    Paused,
    Retired,
    /// Restricted for policy violation (copyright, abuse, malware).
    /// Hidden from public marketplace but preserves buyer access records.
    Restricted,
}

/// Instance storage keys — contract-level configuration stored in
/// `env.storage().instance()`. These have no TTL and survive upgrades.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InstanceDataKey {
    PromptCounter,
    FeePercentage,
    FeeWallet,
    XlmAddress,
    Reentrancy,
    ReferralPercentage,
    IsPaused,
    /// Monotonic counter backing append-only settlement IDs (#567).
    SettlementCounter,
    /// Ledger delay that must elapse between proposing and executing a
    /// high-risk governance action (#569).
    GovernanceDelayLedgers,
}

/// Persistent storage keys — per-item records stored in
/// `env.storage().persistent()`. These carry a TTL managed via
/// `Storage::extend_key_ttl`/`extend_all_ttl`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Prompt(u64),
    CreatorPrompts(Address),
    BuyerPrompts(Address),
    CategoryPrompts(String), // Index: category → Vec<prompt_ids>
    TagPrompts(String),      // Index: tag → Vec<prompt_ids>
    ActivePrompts,           // Index: all active → Vec<prompt_ids>
    AllPrompts,              // Index: all → Vec<prompt_ids>
    Purchase(u64, Address),
    PurchaseEscrow(u64, Address), // Settlement tracking for refunds (#420)
    VoucherKey(u64, BytesN<32>),
    /// Nonce consumed for a signed discount authorization.
    /// Key: (prompt_id, nonce_hash) where nonce_hash = sha256(nonce_bytes)
    NonceConsumed(u64, BytesN<32>),
    /// Snapshot of a listing taken before a revision (#226).
    /// Key: (prompt_id, revision_number_before_change)
    ListingRevision(u64, u32),
    PurchaseDispute(u64, Address),
    Bundle(u128),
    BundleCounter,
    CreatorBundles(Address),
    /// Bundle purchase prompt IDs for refund processing, keyed by (buyer, bundle_id)
    /// Stores the list of prompt_ids in a bundle purchase for proper refund handling (#595).
    BundlePurchasePrompts(Address, u128),
    /// Maps a bundle escrow (prompt_id=0) to its bundle_id for refund processing (#595).
    /// Keyed by (buyer, timestamp) to uniquely identify the escrow.
    BundleEscrowBundleId(Address, u64),
    AccessPass(u128),
    AccessPassCounter,
    CreatorAccessPasses(Address),
    CatalogPass(Address, Address),
    /// Access pass escrow for dispute/refund tracking, keyed by (pass_id, buyer)
    /// to avoid collisions between multiple passes for the same buyer (#564).
    AccessPassEscrow(u128, Address),
    /// Access pass dispute record, keyed by (pass_id, buyer).
    AccessPassPurchaseDispute(u128, Address),

    /// Nonce consumed for a signed quote commitment (#565).
    /// Key: (buyer, nonce) — scoped to the buyer so nonces need no global store.
    QuoteNonceConsumed(Address, BytesN<32>),

    /// Append-only settlement record, keyed by its own settlement ID (#567).
    /// Never overwritten: a repeat purchase allocates a fresh ID.
    Settlement(u128),
    /// Current entitlement pointer: (prompt_id, buyer) -> settlement_id.
    /// Keeps access checks O(1) without scanning history.
    EntitlementPointer(u64, Address),
    /// Bounded index of a buyer's settlement IDs for one prompt, for pagination.
    BuyerSettlements(u64, Address),
    /// Escrow and dispute records keyed by settlement ID rather than by buyer,
    /// so settling or refunding one acquisition cannot mutate another.
    SettlementEscrow(u128),
    SettlementDispute(u128),

    /// A seller-signed resale order, keyed by its order hash (#568).
    ResaleOrder(BytesN<32>),
    /// Nonce consumed for a resale order. Key: (seller, nonce).
    ResaleOrderNonce(Address, BytesN<32>),

    /// A pending two-phase governance action, keyed by proposal hash (#569).
    GovernanceProposal(BytesN<32>),

    /// Aggregate per-asset escrow liability, keyed by SAC asset address (#570).
    AssetLiability(Address),
    /// Marks that `migrate_asset_liability` has already backfilled the given
    /// escrow into `AssetLiability`, so a repeat call is a safe no-op (#570).
    EscrowLiabilityMigrated(u64, Address),
    
    /// Moderation audit record, keyed by (prompt_id, moderation_timestamp).
    /// Preserves complete history of policy actions for compliance.
    ModerationRecord(u64, u64),
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

/// Reason for content moderation action.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ModerationReason {
    Copyright,
    Abuse,
    Malware,
    PolicyViolation,
    Other,
}

/// Moderation audit record preserving complete policy action history.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModerationRecord {
    pub prompt_id: u64,
    pub moderator: Address,
    pub action: PromptSaleStatus,
    pub reason: ModerationReason,
    pub policy_reference: String,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SettlementStatus {
    Pending,  // Purchase received, awaiting settlement
    Settled,  // Payment distributed successfully
    Refunded, // Purchase refunded atomically
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PurchaseEscrow {
    pub prompt_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub status: SettlementStatus,
    pub created_at: u64,
    pub settled_at: u64, // 0 if not yet settled
    /// Deadline (unix timestamp) by which a buyer must open a dispute.
    /// After this passes with no open dispute, settlement becomes
    /// permissionless (#541).
    pub dispute_deadline: u64,
    pub asset: Address,
    pub referrer: Option<Address>,
    pub creator_amount: i128,
    pub fee_amount: i128,
    pub referral_amount: i128,
    pub payout_plan: PayoutPlan,
}

/// Immutable payout snapshot captured at purchase time (#562).
/// Stored inside `PurchaseEscrow` so settlement is independent of
/// any subsequent listing or configuration mutation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutPlan {
    /// The prompt creator who receives the creator share.
    pub creator: Address,
    /// Platform fee wallet address at time of purchase.
    pub fee_wallet: Address,
    /// Platform fee amount in stroops.
    pub fee_amount: i128,
    /// Optional referrer address.
    pub referrer: Option<Address>,
    /// Referral commission amount in stroops.
    pub referral_amount: i128,
    /// Collaborator splits snapshot (recipient, amount) at purchase time.
    pub splits: Vec<PayoutSplit>,
    /// Creator's share after all deductions.
    pub creator_amount: i128,
}

/// A single collaborator split entry in the payout snapshot.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutSplit {
    pub recipient: Address,
    pub amount: i128,
}

/// Aggregate escrow liability tracked for one SAC asset (#570).
///
/// `pending` is the total amount held for escrows awaiting settlement or
/// refund. `disputed` is the subset currently under an open dispute — moved
/// out of `pending` while the dispute is open so operators can see disputed
/// exposure separately, and moved back on settle/refund/reject. The two
/// buckets never overlap; `pending + disputed` is the asset's total
/// customer liability the contract's SAC balance must cover.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetLiability {
    pub pending: i128,
    pub disputed: i128,
}

/// Read-only solvency snapshot for one asset (#570). `surplus` is
/// `actual_balance - tracked_liability`: rounding dust, accidental direct
/// transfers, or other non-customer balance. A negative surplus means the
/// contract's SAC balance no longer covers its tracked liabilities.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetSolvency {
    pub tracked_liability: i128,
    pub actual_balance: i128,
    pub surplus: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PurchaseDispute {
    pub prompt_id: u64,
    pub buyer: Address,
    pub reason: DisputeReason,
    pub opened_at: u64,
    pub resolved_at: u64,
    pub status: DisputeStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Purchase {
    pub prompt_id: u64,
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

/// On-chain listing record.
///
/// `creator` is intentionally immutable: license fees (`buy_prompt`) always
/// route to the address that created the listing. Changing who operates a
/// listing is coordinated OFF-chain (indexed `Prompt.owner` re-pointing,
/// see docs/architecture.md) and never mutates this struct.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Prompt {
    pub id: u64,
    pub creator: Address,
    pub image_url: String,
    pub title: String,
    pub category: String,
    pub preview_text: String,
    pub encrypted_payload: String,
    pub encryption_iv: String,
    pub wrapped_key: String,
    pub content_hash: BytesN<32>,
    pub price_stroops: i128,
    pub asset: Address,
    pub status: PromptSaleStatus,
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bundle {
    pub id: u128,
    pub creator: Address,
    pub title: String,
    pub prompt_ids: Vec<u64>,
    pub price_stroops: i128,
    pub asset: Address,
    pub active: bool,
    pub sales_count: u64,
    /// Unix timestamp after which the bundle can no longer be purchased.
    /// `0` means the bundle never expires.
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessPass {
    pub id: u128,
    pub creator: Address,
    pub title: String,
    pub duration_secs: u64,
    pub price_stroops: i128,
    pub asset: Address,
    pub status: PromptSaleStatus,
    pub sales_count: u32,
    pub max_supply: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CatalogPassPurchase {
    pub creator: Address,
    pub buyer: Address,
    pub pass_id: u128,
    pub expires_at: u64,
}

/// Snapshot of the mutable listing fields captured before a revision (#226).
/// Stored under `DataKey::ListingRevision(prompt_id, old_revision)` so
/// buyers can verify what metadata was in effect when they purchased.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingRevisionRecord {
    pub prompt_id: u64,
    pub revision: u32,
    pub title: String,
    pub category: String,
    pub preview_text: String,
    pub image_url: String,
    pub price_stroops: i128,
    pub revised_at: u64,
}

/// A creator-signed discount authorization.
///
/// Replaces raw voucher preimages with a signed payload that binds the
/// discount to a specific prompt, buyer, nonce, expiry, and domain
/// (network_id + contract_id). This prevents front-running, replay across
/// contracts/networks, and nonce reuse.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignedDiscountAuthorization {
    pub prompt_id: u64,
    pub buyer: Address,
    pub discount_bps: u32,
    pub nonce: BytesN<32>,
    pub expiry_ledger: u32,
    pub network_id: BytesN<32>,
    pub contract_id: BytesN<32>,
}

impl SignedDiscountAuthorization {
    /// Compute the domain-separated message hash for signature verification.
    /// The domain separator prevents replay across different contracts/networks.
    pub fn hash(&self, env: &Env) -> BytesN<32> {
        let mut buf = Vec::new(env);
        // Domain separator: network_id || contract_id
        buf.push_back(self.network_id.to_val());
        buf.push_back(self.contract_id.to_val());
        // Payload: prompt_id || buyer || discount_bps || nonce || expiry_ledger
        buf.push_back((self.prompt_id as u128).into_val(env));
        buf.push_back(self.buyer.to_val());
        buf.push_back((self.discount_bps as u128).into_val(env));
        buf.push_back(self.nonce.to_val());
        buf.push_back((self.expiry_ledger as u128).into_val(env));
        let raw = env.crypto().sha256(&buf.to_xdr(env));
        BytesN::from_array(env, &raw.to_array())
    }
}

/// Which checkout path a quote authorizes (#565).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AcquisitionKind {
    DirectPurchase,
    Lease,
    Bundle,
    AccessPass,
    BulkCheckout,
    ResaleFill,
}

/// A bounded quote commitment covering every checkout path (#565).
///
/// Binds the authorization to the network, contract, acquisition, asset and the
/// exact commercial terms in effect when the quote was produced. `terms_hash`
/// covers the listing revision, fee schedule, splits, bundle membership and
/// pass duration, so any of those changing between simulation and submission
/// invalidates the quote before funds move.
///
/// `max_charge` is a ceiling, not a target: the buyer is never debited above it.
/// A tip is carried separately in `tip_amount` so an excess payment can never be
/// silently reinterpreted as a gratuity.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuoteCommitment {
    pub network_id: BytesN<32>,
    pub contract_id: BytesN<32>,
    pub buyer: Address,
    pub kind: AcquisitionKind,
    /// prompt_id, bundle_id or pass_id depending on `kind`.
    pub acquisition_id: u128,
    pub asset: Address,
    /// Hash over the expected revision and fee/split/membership configuration.
    pub terms_hash: BytesN<32>,
    /// Maximum the buyer authorizes for the purchase itself, excluding any tip.
    pub max_charge: i128,
    /// Explicit tip. `0` means no tip is authorized.
    pub tip_amount: i128,
    pub not_before_ledger: u32,
    pub expiry_ledger: u32,
    pub nonce: BytesN<32>,
}

/// One acquisition attempt, keyed by its own settlement ID (#567).
///
/// Records are append-only. Reacquiring an expired or refunded license
/// allocates a new ID rather than overwriting the prior commercial and dispute
/// record, so historical settlement and receipts stay unambiguous.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementRecord {
    pub settlement_id: u128,
    pub prompt_id: u64,
    pub buyer: Address,
    pub kind: AcquisitionKind,
    pub amount: i128,
    pub asset: Address,
    pub status: SettlementStatus,
    pub created_at: u64,
    pub settled_at: u64,
    /// Settlement this one superseded, if it was a reacquisition.
    pub supersedes: Option<u128>,
    pub payout_plan: PayoutPlan,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ResaleOrderStatus {
    Open,
    Filled,
    Cancelled,
}

/// A seller-signed resale order (#568).
///
/// Replaces dual-authorization `transfer_license`, which needed both parties in
/// one invocation and carried no nonce, expiry or cancellation state. The seller
/// signs once; a buyer fills later without a synchronous seller signature.
///
/// `buyer` set to `None` is an open order; `Some(addr)` restricts the fill to
/// that address. Ownership and entitlement expiry are revalidated at fill time.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResaleOrder {
    pub network_id: BytesN<32>,
    pub contract_id: BytesN<32>,
    pub seller: Address,
    pub prompt_id: u64,
    /// Entitlement being sold, so a later reacquisition cannot be substituted.
    pub settlement_id: u128,
    pub asset: Address,
    pub price: i128,
    /// Minimum the seller accepts after royalties are routed.
    pub min_proceeds: i128,
    /// `None` leaves the order open to any buyer.
    pub buyer: Option<Address>,
    pub royalty_bps: u32,
    pub expiry_ledger: u32,
    pub nonce: BytesN<32>,
    pub status: ResaleOrderStatus,
}

/// The high-risk changes that must go through the delay (#569).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GovernanceAction {
    /// Upgrade the contract WASM to the given hash.
    Upgrade(BytesN<32>),
    /// Redirect platform fees to a new wallet.
    SetFeeWallet(Address),
    SetFeePercentage(u32),
    SetReferralPercentage(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceProposal {
    pub action: GovernanceAction,
    pub proposer: Address,
    pub proposed_at_ledger: u32,
    /// Earliest ledger at which execution is permitted.
    pub executable_at_ledger: u32,
    /// Ledger after which the proposal can no longer be executed.
    pub expiry_ledger: u32,
    pub expected_state_hash: BytesN<32>,
    pub nonce: BytesN<32>,
}

/// Report describing detected drift between canonical prompt records and secondary indexes (#652).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexDriftReport {
    pub start_id: u64,
    pub end_id: u64,
    pub total_prompts_scanned: u64,
    pub missing_in_all: u32,
    pub missing_in_active: u32,
    pub stale_in_active: u32,
    pub missing_in_category: u32,
    pub missing_in_tags: u32,
    pub missing_in_creator: u32,
    pub next_cursor: Option<u64>,
}

/// Result of an admin-authorized catalog secondary index repair operation (#652).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexRepairSummary {
    pub start_id: u64,
    pub end_id: u64,
    pub prompts_processed: u64,
    pub repairs_applied: u32,
    pub is_dry_run: bool,
    pub next_cursor: Option<u64>,
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
    ) -> Result<u64, Error>;

    fn set_prompt_sale_status(
        env: Env,
        creator: Address,
        prompt_id: u64,
        status: PromptSaleStatus,
    ) -> Result<(), Error>;

    fn admin_set_prompt_sale_status(
        env: Env,
        admin: Address,
        prompt_id: u64,
        status: PromptSaleStatus,
        reason: ModerationReason,
        policy_reference: String,
    ) -> Result<(), Error>;

    fn set_prompt_max_supply(
        env: Env,
        creator: Address,
        prompt_id: u64,
        max_supply: u64,
    ) -> Result<(), Error>;

    fn update_prompt_price(
        env: Env,
        creator: Address,
        prompt_id: u64,
        price_stroops: i128,
    ) -> Result<(), Error>;

    fn buy_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        referrer: Option<Address>,
        payment_amount_stroops: i128,
        voucher: Option<Bytes>,
    ) -> Result<(), Error>;

    fn buy_prompt_with_auth(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        referrer: Option<Address>,
        payment_amount_stroops: i128,
        authorization: SignedDiscountAuthorization,
        creator_sig: BytesN<64>,
    ) -> Result<(), Error>;

    /// Add a signed discount authorization. The creator signs the authorization
    /// off-chain and submits the signature to the contract for verification.
    /// This replaces the old `add_voucher` which used raw hashed preimages.
    fn add_signed_discount_auth(
        env: Env,
        creator: Address,
        authorization: SignedDiscountAuthorization,
        signature: BytesN<64>,
    ) -> Result<(), Error>;

    /// Revoke a signed discount authorization by consuming its nonce.
    fn revoke_discount_auth(
        env: Env,
        creator: Address,
        prompt_id: u64,
        nonce: BytesN<32>,
    ) -> Result<(), Error>;

    fn lease_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        lease_duration_secs: u64,
    ) -> Result<(), Error>;

    /// Push the expiry date of a listing forward. `new_expires_at` must be
    /// strictly greater than the current ledger timestamp.
    fn extend_listing(
        env: Env,
        creator: Address,
        prompt_id: u64,
        new_expires_at: u64,
    ) -> Result<(), Error>;

    /// Purchase multiple prompts atomically in a single transaction.
    /// `prompt_ids` and `payment_amounts` must have equal length.
    /// An optional `referrer` applies to every prompt in the batch.
    /// If any individual purchase fails the entire transaction reverts.
    fn buy_prompts_bulk(
        env: Env,
        buyer: Address,
        prompt_ids: Vec<u64>,
        payment_amounts: Vec<i128>,
        referrer: Option<Address>,
    ) -> Result<(), Error>;

    /// Dry-run validation for bulk purchases without state mutation.
    /// Returns per-item validity status so frontend can filter invalid IDs before submitting.
    /// Does not require auth (read-only check).
    fn validate_bulk_purchase(
        env: Env,
        buyer: Address,
        prompt_ids: Vec<u64>,
        payment_amounts: Vec<i128>,
    ) -> Result<Vec<bool>, Error>;

    fn create_bundle(
        env: Env,
        creator: Address,
        title: String,
        prompt_ids: Vec<u64>,
        price_stroops: i128,
        asset: Address,
        expires_at: u64,
    ) -> Result<u128, Error>;

    fn buy_bundle(
        env: Env,
        buyer: Address,
        bundle_id: u128,
        payment_amount_stroops: i128,
    ) -> Result<(), Error>;

    fn get_bundle(env: Env, bundle_id: u128) -> Result<Bundle, Error>;

    fn get_bundles_by_creator(env: Env, creator: Address) -> Result<Vec<Bundle>, Error>;

    #[allow(clippy::too_many_arguments)]
    fn create_access_pass(
        env: Env,
        creator: Address,
        title: String,
        duration_secs: u64,
        price_stroops: i128,
        asset: Address,
        // Maximum number of active pass grants this pass can issue (0 = unlimited).
        max_supply: u32,
    ) -> Result<u128, Error>;

    /// Pause, reactivate, or retire an access pass. Existing buyer grants are
    /// unaffected — they follow their own stored `expires_at` regardless of
    /// the pass's current status (#539).
    fn set_access_pass_status(
        env: Env,
        creator: Address,
        pass_id: u128,
        status: PromptSaleStatus,
    ) -> Result<(), Error>;

    fn update_access_pass_price(
        env: Env,
        creator: Address,
        pass_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error>;

    fn buy_access_pass(
        env: Env,
        buyer: Address,
        pass_id: u128,
        payment_amount_stroops: i128,
    ) -> Result<(), Error>;

    fn get_access_pass(env: Env, pass_id: u128) -> Result<AccessPass, Error>;

    fn get_access_passes_by_creator(env: Env, creator: Address) -> Result<Vec<AccessPass>, Error>;

    fn transfer_license(
        env: Env,
        seller: Address,
        prompt_id: u64,
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
        prompt_id: u64,
        title: String,
        category: String,
        preview_text: String,
        image_url: String,
        price_stroops: i128,
    ) -> Result<u32, Error>;

    fn get_listing_revision(
        env: Env,
        prompt_id: u64,
        revision: u32,
    ) -> Result<ListingRevisionRecord, Error>;

    fn update_splits(
        env: Env,
        creator: Address,
        prompt_id: u64,
        new_splits: Vec<Split>,
    ) -> Result<(), Error>;

    fn has_access(env: Env, user: Address, prompt_id: u64) -> Result<bool, Error>;
    fn get_prompt(env: Env, prompt_id: u64) -> Result<Prompt, Error>;

    /// Canonical SHA-256 hash of the current listing state (owner, price, asset,
    /// version/revision, expiry). Buyers sign this hash off-chain so a drifted
    /// listing cannot be used to replay a stale purchase authorization (#698).
    fn listing_snapshot_hash(env: Env, prompt_id: u64) -> Result<BytesN<32>, Error>;
    /// Returns true iff `expected` equals the current listing snapshot hash.
    fn verify_listing_snapshot(
        env: Env,
        prompt_id: u64,
        expected: BytesN<32>,
    ) -> Result<bool, Error>;
    fn get_all_prompts(env: Env) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_category(env: Env, category: String) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_tag(env: Env, tag: String) -> Result<Vec<Prompt>, Error>;

    // Paginated catalog queries (bounded, respects resource limits).
    fn get_all_prompts_paginated(
        env: Env,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error>;
    fn get_prompts_by_category_page(
        env: Env,
        category: String,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error>;
    fn get_prompts_by_tag_paginated(
        env: Env,
        tag: String,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error>;
    fn get_active_prompts_paginated(
        env: Env,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error>;
    fn get_prompts_by_creator_paginated(
        env: Env,
        creator: Address,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error>;
    fn get_prompts_by_buyer_paginated(
        env: Env,
        buyer: Address,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<(Vec<Prompt>, Option<String>), Error>;

    // Secondary index drift verification and admin repair (#652).
    fn verify_catalog_indexes(
        env: Env,
        start_id: u64,
        batch_size: u64,
    ) -> Result<IndexDriftReport, Error>;
    fn repair_catalog_indexes(
        env: Env,
        admin: Address,
        start_id: u64,
        batch_size: u64,
        dry_run: bool,
    ) -> Result<IndexRepairSummary, Error>;

    // Checked accounting counter reconciliation (#653).
    fn reconcile_sales_counter(
        env: Env,
        admin: Address,
        prompt_id: u64,
    ) -> Result<u64, Error>;

    // TTL maintenance (operator utilities).
    fn renew_critical_keys(env: Env, cursor: Option<u64>) -> Result<(u32, Option<u64>), Error>;
    fn get_expiry_risk_metrics(env: Env) -> Result<Vec<(String, String)>, Error>;

    fn open_dispute(
        env: Env,
        buyer: Address,
        prompt_id: u64,
        reason: DisputeReason,
    ) -> Result<(), Error>;
    fn resolve_dispute(
        env: Env,
        admin: Address,
        prompt_id: u64,
        buyer: Address,
        refund: bool,
    ) -> Result<(), Error>;
    fn get_dispute(env: Env, prompt_id: u64, buyer: Address) -> Result<PurchaseDispute, Error>;
    fn settle_purchase(
        env: Env,
        caller: Address,
        prompt_id: u64,
        buyer: Address,
    ) -> Result<(), Error>;
    fn get_purchase_escrow(env: Env, prompt_id: u64, buyer: Address) -> Option<PurchaseEscrow>;
    /// Open a dispute against an access pass purchase (#564).
    fn open_access_pass_dispute(
        env: Env,
        buyer: Address,
        pass_id: u128,
        reason: DisputeReason,
    ) -> Result<(), Error>;
    /// Resolve (approve refund or reject) an access pass dispute (#564).
    fn resolve_access_pass_dispute(
        env: Env,
        admin: Address,
        pass_id: u128,
        buyer: Address,
        refund: bool,
    ) -> Result<(), Error>;
    /// Settle (release funds from) a pending access pass purchase escrow (#564).
    fn settle_access_pass_purchase(
        env: Env,
        caller: Address,
        pass_id: u128,
        buyer: Address,
    ) -> Result<(), Error>;
    fn get_prompts_by_creator(env: Env, creator: Address) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_buyer(env: Env, buyer: Address) -> Result<Vec<Prompt>, Error>;
    fn set_fee_wallet(env: Env, new_fee_wallet: Address) -> Result<(), Error>;
    fn get_fee_wallet(env: Env) -> Option<Address>;
    fn set_fee_percentage(env: Env, new_fee_percentage: u32) -> Result<(), Error>;
    fn get_fee_percentage(env: Env) -> u32;
    fn set_referral_percentage(env: Env, new_referral_percentage: u32) -> Result<(), Error>;
    fn get_referral_percentage(env: Env) -> u32;
    // New platform fee governance API
    fn update_platform_fee(env: Env, admin: Address, new_fee: u32) -> Result<(), Error>;
    fn get_platform_fee(env: Env) -> u32;
    /// One-time post-upgrade fix for deployments that hold a fee percentage
    /// set above `MAX_PLATFORM_FEE` by the legacy `set_fee_percentage`
    /// ceiling. Clamps it down; a no-op if already within bound (#566).
    fn migrate_platform_fee_bound(env: Env, admin: Address) -> Result<(), Error>;

    // Per-asset escrow liability and solvency reconciliation (#570).
    fn get_asset_liability(env: Env, asset: Address) -> AssetLiability;
    fn get_asset_solvency(env: Env, asset: Address) -> AssetSolvency;
    /// Compares tracked liability against the contract's actual SAC balance
    /// for `asset` and pauses the contract if the balance no longer covers
    /// tracked liabilities. Safe to call permissionlessly as a monitor.
    fn check_asset_solvency(env: Env, asset: Address) -> Result<AssetSolvency, Error>;
    /// One-time backfill of a single pre-existing Pending/Disputed escrow
    /// into the per-asset liability ledger, for deployments upgrading into
    /// this feature. Idempotent — a repeat call for an already-migrated
    /// escrow is a no-op.
    fn migrate_asset_liability(
        env: Env,
        admin: Address,
        prompt_id: u64,
        buyer: Address,
    ) -> Result<(), Error>;
    fn set_pause_status(env: Env, paused: bool) -> Result<(), Error>;
    fn is_paused(env: Env) -> bool;
    fn add_voucher(
        env: Env,
        creator: Address,
        prompt_id: u64,
        hashed_code: BytesN<32>,
        discount_bps: u32,
    ) -> Result<(), Error>;
    fn remove_voucher(
        env: Env,
        creator: Address,
        prompt_id: u64,
        hashed_code: BytesN<32>,
    ) -> Result<(), Error>;
    fn get_xlm_sac(env: Env) -> Option<Address>;

    /// Fetch multiple prompts by ID in a single call. Returns only prompts
    /// that exist — missing IDs are silently skipped.
    fn get_prompts_by_ids(env: Env, prompt_ids: Vec<u64>) -> Result<Vec<Prompt>, Error>;

    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error>;
    fn extend_ttl(env: Env, key: DataKey) -> Result<(), Error>;
    /// Bulk-extend TTL for all active storage entries. Intended for periodic
    /// admin maintenance (#26).
    fn extend_all_ttl(env: Env) -> Result<(), Error>;
}
