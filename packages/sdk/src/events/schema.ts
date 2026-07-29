/**
 * Canonical, versioned event schema — Issue #424 (scoped slice).
 *
 * This is the single checked-in specification that
 * {@link decodeEvent}/`decode.ts` derives its decoders from, instead of
 * each consumer (indexer, SDK, frontend) hand-rolling its own field list
 * per event. It mirrors the `#[contractevent]` struct definitions in
 * `contracts/prompt-hash/src/events.rs` as of schema version 1.
 *
 * ## What this does NOT cover yet (see docs/event-versioning.md)
 * - The contract does not currently emit an explicit `version` field on the
 *   wire — every event is treated as implicit version 1 until events.rs is
 *   updated to include one. `decodeEvent` already accepts/threads a version
 *   number so that change is additive when it lands.
 * - No CI job yet fails when events.rs changes without a matching schema
 *   update (acceptance criterion 2) — this file is currently kept in sync
 *   by hand and reviewed alongside contract changes.
 * - The indexer (`server/src/services/indexer.ts`) has not been migrated
 *   to use this decoder; it still hand-decodes each topic. Migrating it is
 *   left as explicit follow-up so this slice doesn't risk production event
 *   processing.
 */

/** Field primitive types this schema can describe and safely coerce. */
export type EventFieldType =
  | "u32"
  | "u64"
  | "u128"
  | "i128"
  | "bool"
  | "string"
  | "address"
  | "bytes32"
  | "option<address>"
  | "vec<u64>";

export interface EventFieldSpec {
  name: string;
  type: EventFieldType;
}

export interface EventSchema {
  /** Event/topic name, matching the `#[contractevent]` struct name in events.rs. */
  name: string;
  /** Schema version this definition describes. Bump on any breaking change. */
  version: number;
  fields: EventFieldSpec[];
}

/** Current schema version emitted by the contract (see file-level doc for caveats). */
export const CURRENT_EVENT_SCHEMA_VERSION = 1;

/**
 * One entry per `#[contractevent]` in `contracts/prompt-hash/src/events.rs`.
 * Keyed by event/topic name.
 */
export const EVENT_SCHEMAS: Record<string, EventSchema> = {
  PromptCreated: {
    name: "PromptCreated",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "creator", type: "address" },
      { name: "price_stroops", type: "i128" },
      { name: "asset", type: "address" },
    ],
  },
  PromptSaleStatusUpdated: {
    name: "PromptSaleStatusUpdated",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "active", type: "bool" },
    ],
  },
  PromptAdminModerated: {
    name: "PromptAdminModerated",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "admin", type: "address" },
      { name: "active", type: "bool" },
    ],
  },
  PromptPriceUpdated: {
    name: "PromptPriceUpdated",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "price_stroops", type: "i128" },
    ],
  },
  PromptPurchased: {
    name: "PromptPurchased",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "buyer", type: "address" },
      { name: "creator", type: "address" },
      { name: "price_stroops", type: "i128" },
      { name: "referrer", type: "option<address>" },
    ],
  },
  LicenseTransferred: {
    name: "LicenseTransferred",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "seller", type: "address" },
      { name: "buyer", type: "address" },
      { name: "creator", type: "address" },
      { name: "resale_price", type: "i128" },
      { name: "royalty_amount", type: "i128" },
    ],
  },
  PromptTipped: {
    name: "PromptTipped",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "buyer", type: "address" },
      { name: "amount_tipped", type: "i128" },
    ],
  },
  VoucherAdded: {
    name: "VoucherAdded",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "hashed_code", type: "bytes32" },
      { name: "discount_bps", type: "u32" },
    ],
  },
  VoucherRemoved: {
    name: "VoucherRemoved",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "hashed_code", type: "bytes32" },
    ],
  },
  ContractPausedStateChanged: {
    name: "ContractPausedStateChanged",
    version: 1,
    fields: [{ name: "is_paused", type: "bool" }],
  },
  FeeUpdated: {
    name: "FeeUpdated",
    version: 1,
    fields: [{ name: "new_fee_percentage", type: "u32" }],
  },
  FeeWalletUpdated: {
    name: "FeeWalletUpdated",
    version: 1,
    fields: [{ name: "new_fee_wallet", type: "address" }],
  },
  PlatformFeeUpdated: {
    name: "PlatformFeeUpdated",
    version: 1,
    fields: [
      { name: "old_fee", type: "u32" },
      { name: "new_fee", type: "u32" },
      { name: "admin", type: "address" },
    ],
  },
  ListingExtended: {
    name: "ListingExtended",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "new_expires_at", type: "u64" },
    ],
  },
  ListingRevised: {
    name: "ListingRevised",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "new_revision", type: "u32" },
    ],
  },
  SplitsUpdated: {
    name: "SplitsUpdated",
    version: 1,
    fields: [{ name: "prompt_id", type: "u64" }],
  },
  DisputeOpened: {
    name: "DisputeOpened",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "buyer", type: "address" },
    ],
  },
  DisputeResolved: {
    name: "DisputeResolved",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "buyer", type: "address" },
      { name: "refunded", type: "bool" },
    ],
  },
  BundleCreated: {
    name: "BundleCreated",
    version: 1,
    fields: [
      { name: "bundle_id", type: "u128" },
      { name: "creator", type: "address" },
      { name: "price_stroops", type: "i128" },
    ],
  },
  BundlePurchased: {
    name: "BundlePurchased",
    version: 1,
    fields: [
      { name: "bundle_id", type: "u128" },
      { name: "buyer", type: "address" },
      { name: "creator", type: "address" },
      { name: "price_stroops", type: "i128" },
      { name: "prompt_ids", type: "vec<u64>" },
    ],
  },
  AccessPassCreated: {
    name: "AccessPassCreated",
    version: 1,
    fields: [
      { name: "pass_id", type: "u128" },
      { name: "creator", type: "address" },
      { name: "duration_secs", type: "u64" },
      { name: "price_stroops", type: "i128" },
    ],
  },
  AccessPassPurchased: {
    name: "AccessPassPurchased",
    version: 1,
    fields: [
      { name: "pass_id", type: "u128" },
      { name: "buyer", type: "address" },
      { name: "creator", type: "address" },
      { name: "expires_at", type: "u64" },
    ],
  },
  ContractUpgraded: {
    name: "ContractUpgraded",
    version: 1,
    fields: [
      { name: "old_wasm_hash", type: "bytes32" },
      { name: "new_wasm_hash", type: "bytes32" },
      { name: "admin", type: "address" },
    ],
  },
};

/**
 * Explicit schema definitions for version 2 events (upgraded events containing explicit version fields or expanded parameters).
 */
export const EVENT_SCHEMAS_V2: Record<string, EventSchema> = {
  PromptCreated: {
    name: "PromptCreated",
    version: 2,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "creator", type: "address" },
      { name: "price_stroops", type: "i128" },
      { name: "asset", type: "address" },
      { name: "version", type: "u32" },
    ],
  },
  PromptPurchased: {
    name: "PromptPurchased",
    version: 2,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "buyer", type: "address" },
      { name: "creator", type: "address" },
      { name: "price_stroops", type: "i128" },
      { name: "referrer", type: "option<address>" },
      { name: "version", type: "u32" },
    ],
  },
  PromptPriceUpdated: {
    name: "PromptPriceUpdated",
    version: 2,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "price_stroops", type: "i128" },
      { name: "version", type: "u32" },
    ],
  },
  PromptSaleStatusUpdated: {
    name: "PromptSaleStatusUpdated",
    version: 2,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "active", type: "bool" },
      { name: "version", type: "u32" },
    ],
  },
  FeeUpdated: {
    name: "FeeUpdated",
    version: 2,
    fields: [
      { name: "new_fee_percentage", type: "u32" },
      { name: "version", type: "u32" },
    ],
  },
  ContractUpgraded: {
    name: "ContractUpgraded",
    version: 2,
    fields: [
      { name: "old_wasm_hash", type: "bytes32" },
      { name: "new_wasm_hash", type: "bytes32" },
      { name: "admin", type: "address" },
      { name: "version", type: "u32" },
    ],
  },
};

/** Multi-version event schema registry indexed by event name and schema version. */
export const ALL_EVENT_SCHEMAS: Record<string, Record<number, EventSchema>> = {
  ...Object.fromEntries(
    Object.entries(EVENT_SCHEMAS).map(([name, schema]) => [name, { 1: schema }]),
  ),
};

for (const [name, schemaV2] of Object.entries(EVENT_SCHEMAS_V2)) {
  if (!ALL_EVENT_SCHEMAS[name]) {
    ALL_EVENT_SCHEMAS[name] = {};
  }
  ALL_EVENT_SCHEMAS[name][2] = schemaV2;
}

/**
 * Resolves an event schema for a given event name and schema version.
 */
export function getEventSchema(type: string, version: number = 1): EventSchema | undefined {
  return ALL_EVENT_SCHEMAS[type]?.[version];
}

