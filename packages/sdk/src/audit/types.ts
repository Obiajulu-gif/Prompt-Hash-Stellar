/**
 * Versioned audit-event contract — Issue #1094.
 *
 * Defines the canonical shape of every audit event emitted by PromptHash
 * services, the actor/resource/correlation envelope, the version scheme, and
 * the redaction rules that govern which fields may never reach a log sink.
 *
 * ## Design goals
 *
 * 1. **Queryable across releases** — every event carries a stable `name`,
 *    `schemaVersion`, and `correlationId` so security dashboards can join
 *    events from old and new contract deploys.
 * 2. **No secrets or personal data in logs** — fields listed in
 *    `REDACTED_FIELDS` and `HASHED_FIELDS` are enforced by `redactEvent`
 *    before any event reaches a sink.
 * 3. **Backward-compatible by default** — consumers call `isCompatible`
 *    before decoding; a `schemaVersion` bump is the only signal they need.
 * 4. **Finite, documented vocabulary** — event names are drawn from
 *    `AuditEventName`; unknown names never reach the validated pipeline.
 */

// ─── Versioning ───────────────────────────────────────────────────────────────

/**
 * Current schema version for the audit-event envelope.
 *
 * Rules:
 *  - **Additive field** (optional, non-breaking): do NOT bump.
 *  - **New required field** or **renamed/removed field** (breaking): bump.
 *  - Every bump adds a row to `SCHEMA_MIGRATION_NOTES` below.
 */
export const AUDIT_SCHEMA_VERSION = 1 as const;
export type AuditSchemaVersion = 1;

/** All schema versions this build can read (older events on the same stream). */
export const SUPPORTED_AUDIT_SCHEMA_VERSIONS: readonly AuditSchemaVersion[] = [1];

// ─── Event names ─────────────────────────────────────────────────────────────

/**
 * Finite vocabulary of audit event names.
 *
 * Naming convention: `<Domain>.<Action>` in PascalCase.
 * Adding a new name is non-breaking (consumers skip unknown names).
 * Renaming or removing a name is a breaking change → bump AUDIT_SCHEMA_VERSION.
 */
export type AuditEventName =
  // Marketplace
  | "Prompt.Created"
  | "Prompt.Updated"
  | "Prompt.PriceUpdated"
  | "Prompt.SaleStatusUpdated"
  | "Prompt.AdminModerated"
  // Entitlements
  | "Prompt.Purchased"
  | "License.Transferred"
  | "Bundle.Created"
  | "Bundle.Purchased"
  | "AccessPass.Created"
  | "AccessPass.Purchased"
  // Settlement / fees
  | "Fee.Updated"
  | "Fee.WalletUpdated"
  | "PlatformFee.Updated"
  | "Payout.Released"
  | "Solvency.ViolationDetected"
  // Governance / admin
  | "Contract.PausedStateChanged"
  | "Contract.Upgraded"
  | "Admin.ActionTaken"
  // Vouchers
  | "Voucher.Added"
  | "Voucher.Removed"
  // Listings
  | "Listing.Extended"
  | "Listing.Revised"
  // Splits
  | "Splits.Updated"
  // Disputes
  | "Dispute.Opened"
  | "Dispute.Resolved";

// ─── Actor ────────────────────────────────────────────────────────────────────

/**
 * Who or what triggered the event.
 *
 * At most one of `stellarAddress`, `serviceId`, or `adminRole` is set;
 * the others are `undefined`.  `stellarAddress` values are stored as-is
 * (they are public keys — not personal data) but are **hashed** in
 * external log exports (see `HASHED_FIELDS`).
 */
export interface AuditActor {
  /** Stellar strkey (G… or C…) of the transaction signer, when on-chain. */
  stellarAddress?: string;
  /** Internal service identifier (e.g. `"indexer"`, `"webhook-outbox"`). */
  serviceId?: string;
  /**
   * Human-readable admin role label (e.g. `"platform-admin"`).
   * Never contains a name, email, or account credential.
   */
  adminRole?: string;
}

// ─── Resource ────────────────────────────────────────────────────────────────

/**
 * The primary object the event is about.
 *
 * `type` is always present; `id` is present for entity-scoped events and
 * absent for contract-wide events (e.g. paused-state changes).
 */
export interface AuditResource {
  /**
   * Resource kind, drawn from a finite set so dashboards can filter.
   * Values: "prompt" | "bundle" | "access-pass" | "license" | "contract" |
   *         "voucher" | "listing" | "fee" | "dispute" | "payout"
   */
  type:
    | "prompt"
    | "bundle"
    | "access-pass"
    | "license"
    | "contract"
    | "voucher"
    | "listing"
    | "fee"
    | "dispute"
    | "payout";
  /** Numeric or string entity id, omitted for contract-wide events. */
  id?: string | number | bigint;
}

// ─── Correlation ──────────────────────────────────────────────────────────────

/**
 * Identifiers that connect this event to a wider trace.
 *
 * All fields are optional because on-chain events have no HTTP request
 * context.  Consumers must handle absent fields gracefully.
 */
export interface AuditCorrelation {
  /** Stellar transaction hash that produced this event. */
  txHash?: string;
  /** Ledger sequence number at which the event was finalized. */
  ledger?: number;
  /** W3C Trace-Context `traceparent` or equivalent request-scoped trace id. */
  traceId?: string;
  /** Idempotency key passed by the calling client, when available. */
  idempotencyKey?: string;
}

// ─── Envelope ────────────────────────────────────────────────────────────────

/**
 * The versioned envelope every audit event is wrapped in.
 *
 * `payload` carries the event-specific fields defined per-event in
 * `EVENT_AUDIT_PAYLOADS`.  Consumers that don't recognise `name` skip the
 * event; consumers that don't support `schemaVersion` quarantine it.
 */
export interface AuditEvent<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Schema version for the envelope itself (not the contract schema version). */
  schemaVersion: AuditSchemaVersion;
  /** Stable event name from the `AuditEventName` vocabulary. */
  name: AuditEventName;
  /** ISO-8601 timestamp at which the event was observed off-chain. */
  occurredAt: string;
  actor: AuditActor;
  resource: AuditResource;
  correlation: AuditCorrelation;
  /** Event-specific payload. Fields listed in REDACTED_FIELDS must be absent here. */
  payload: P;
}

// ─── Redaction rules ─────────────────────────────────────────────────────────

/**
 * Fields that must be **completely excluded** from any audit event payload
 * before it reaches a log sink, analytics store, or external webhook.
 *
 * These are secret or high-sensitivity values whose presence in a log is a
 * security or privacy violation regardless of context.
 *
 * Keep this list append-only: removing an entry is a breaking change because
 * older events in the store may have been produced before the field was
 * redacted, and consumers rely on the invariant holding forward.
 */
export const REDACTED_FIELDS: ReadonlySet<string> = new Set([
  "privateKey",
  "secretKey",
  "encryptedContent",
  "ciphertext",
  "rawBody",
  "rawHeaders",
  "rawXdr",
  "password",
  "apiKey",
  "sessionToken",
  "accessToken",
  "refreshToken",
  "voucherCode",       // plaintext voucher codes; hashed_code is the safe form
  "contentHash",       // derived from encrypted prompt content — only hash is safe
  "nin",               // national identity number
  "taxId",
  "bankAccount",
]);

/**
 * Fields that must be **SHA-256 hashed** (hex-encoded) before reaching a log
 * sink.  The hash preserves correlateability across events (same input →
 * same hash) without storing the raw value.
 *
 * Rationale for each:
 *  - `stellarAddress` / `buyer` / `creator` / `seller`: public keys used for
 *    correlation; direct storage in external exports is PII under some
 *    jurisdictions.
 *  - `hashed_code`: already a contract-side hash; re-hash for log export so
 *    the contract hash cannot be used to brute-force voucher codes.
 *  - `referrer`: optional address field; same rationale as stellarAddress.
 */
export const HASHED_FIELDS: ReadonlySet<string> = new Set([
  "stellarAddress",
  "buyer",
  "creator",
  "seller",
  "referrer",
  "hashed_code",
  "admin",
  "new_fee_wallet",
]);

/**
 * The sentinel value written into a redacted field position.
 * Consumers MUST treat this string as absent data, never decode it.
 */
export const REDACTION_SENTINEL = "[REDACTED]";

// ─── Schema migration notes ───────────────────────────────────────────────────

/**
 * Append one entry here every time `AUDIT_SCHEMA_VERSION` is bumped.
 *
 * Fields:
 *  - `fromVersion`: the version readers of the old shape are on.
 *  - `toVersion`: the version this entry migrates to.
 *  - `breaking`: true if old consumers must upgrade before reading new events.
 *  - `changes`: human-readable summary of what changed.
 *  - `migrationHint`: how an old event (fromVersion) can be transformed to the
 *    new shape; "no-op" when the change is purely additive.
 */
export interface SchemaMigrationNote {
  fromVersion: number;
  toVersion: number;
  breaking: boolean;
  changes: string;
  migrationHint: string;
}

export const SCHEMA_MIGRATION_NOTES: readonly SchemaMigrationNote[] = [
  // No entries yet — AUDIT_SCHEMA_VERSION is 1.
  // When version 2 ships, add:
  // {
  //   fromVersion: 1,
  //   toVersion: 2,
  //   breaking: false,         // set true if a required field was added/renamed
  //   changes: "Added `payload.tags` optional string array.",
  //   migrationHint: "Treat missing `tags` as an empty array.",
  // },
];
