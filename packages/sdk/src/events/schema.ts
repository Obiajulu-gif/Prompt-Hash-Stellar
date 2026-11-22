/**
 * Canonical, versioned event schema — Issue #424 (scoped slice).
 *
 * This is the single checked-in specification that
 * {@link decodeEvent}/`decode.ts` derives its decoders from, instead of
 * each consumer (indexer, SDK, frontend) hand-rolling its own field list
 * per event. It mirrors the `#[contractevent]` struct definitions in
 * `contracts/prompt-hash/src/events.rs` as of schema version 1.
 *
 * ## Schema drift detection
 * `detectSchemaDrift` compares an observed event payload (field names and
 * primitive shapes as seen on the wire or in a consumer's decoder) against
 * the canonical schema for that event name and version. It classifies every
 * mismatch so cross-service consumers can distinguish:
 *   - `missing_field`: a field required by the schema is absent (breaking).
 *   - `type_mismatch`: a field exists but its declared type disagrees (breaking).
 *   - `unexpected_field`: the observed payload carries a field the schema does
 *     not know about (additive drift; tolerated but reported).
 *   - `unknown_event`: no schema is registered for the event name/version.
 *
 * Authorization path: drift reports are only trusted when the observed
 * payload originates from a source on the allowlist passed by the caller.
 * Payloads from unlisted sources are rejected with `unauthorized_source`
 * and never produce a drift verdict, so an untrusted producer cannot spoof
 * a "compatible" result for a breaking change.
 *
 * Retry path: `detectSchemaDriftWithRetry` re-runs detection when the
 * observed payload is still being produced (transient decoding failure).
 * Retries stop on the first conclusive verdict; exhausted retries return
 * the last error so callers can roll back or alert instead of looping.
 *
 * ## Edge cases and recovery
 * - An observed payload that is not an object yields `malformed_payload`.
 * - An unknown version falls back to `unknown_event` (never silently to v1).
 * - Rollback: callers should keep the previously pinned schema version and
 *   switch back to it when `drift.breaking` is true; this module never mutates
 *   the registry at runtime, so rollback is simply re-pinning a version.
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
  PromptUpdated: {
    name: "PromptUpdated",
    version: 1,
    fields: [
      { name: "prompt_id", type: "u64" },
      { name: "version", type: "u32" },
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
      // Ledger sequence the change took effect at (#566). Fields are
      // decoded by name, so this addition is safe for any consumer still
      // reading the pre-#566 shape — it simply won't request this field.
      { name: "effective_ledger", type: "u32" },
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
  SolvencyViolationDetected: {
    name: "SolvencyViolationDetected",
    version: 1,
    fields: [
      { name: "asset", type: "address" },
      { name: "tracked_liability", type: "i128" },
      { name: "actual_balance", type: "i128" },
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
  PromptUpdated: {
    name: "PromptUpdated",
    version: 2,
    fields: [
      { name: "prompt_id", type: "u64" },
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

/** Classification of a single schema drift finding. */
export type DriftKind =
  | "missing_field"
  | "type_mismatch"
  | "unexpected_field";

export interface DriftFinding {
  kind: DriftKind;
  field: string;
  expected?: EventFieldType;
  observed?: string;
  /** `missing_field` and `type_mismatch` are breaking; `unexpected_field` is additive. */
  breaking: boolean;
}

export type DriftStatus =
  | "compatible"
  | "drifted"
  | "malformed_payload"
  | "unknown_event"
  | "unauthorized_source";

export interface DriftReport {
  status: DriftStatus;
  eventName: string;
  version: number;
  findings: DriftFinding[];
  /** True when any finding is breaking, or the verdict is not conclusive. */
  breaking: boolean;
}

/** Observed payload: field name -> raw value as seen by the consumer. */
export type ObservedPayload = Record<string, unknown>;

/** Optional observed type tags, keyed by field name, used when values are ambiguous. */
export type ObservedTypes = Record<string, string>;

export interface DriftInput {
  eventName: string;
  version?: number;
  payload: unknown;
  /** Optional explicit observed types; when absent, types are inferred from values. */
  observedTypes?: ObservedTypes;
  /** Producer identifier; checked against `allowedSources` when provided. */
  source?: string;
}

export interface DriftOptions {
  /** If set, payloads whose `source` is not in this list are rejected. */
  allowedSources?: readonly string[];
}

function inferObservedType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") return value.startsWith("G") || value.startsWith("C") ? "address" : "string";
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (Array.isArray(value)) return "vec";
  if (typeof value === "object") return "object";
  return typeof value;
}

/** Whether an observed type tag is an acceptable realisation of a schema type. */
function isCompatible(expected: EventFieldType, observed: string): boolean {
  switch (expected) {
    case "u32":
    case "u64":
    case "u128":
    case "i128":
      return observed === "integer" || observed === expected;
    case "bool":
      return observed === "bool";
    case "string":
      return observed === "string";
    case "address":
      return observed === "address" || observed === "string";
    case "bytes32":
      return observed === "bytes32" || observed === "string" || observed === "object";
    case "option<address>":
      return observed === "null" || observed === "address" || observed === "string";
    case "vec<u64>":
      return observed === "vec";
    default:
      return false;
  }
}

/**
 * Compares an observed payload against the canonical schema for an event.
 * Pure function: does not mutate the registry or the input.
 */
export function detectSchemaDrift(input: DriftInput, options: DriftOptions = {}): DriftReport {
  const version = input.version ?? 1;
  const base = { eventName: input.eventName, version, findings: [] as DriftFinding[] };

  if (
    options.allowedSources &&
    (input.source === undefined || !options.allowedSources.includes(input.source))
  ) {
    return { ...base, status: "unauthorized_source", breaking: true };
  }

  const schema = getEventSchema(input.eventName, version);
  if (!schema) {
    return { ...base, status: "unknown_event", breaking: true };
  }

  if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) {
    return { ...base, status: "malformed_payload", breaking: true };
  }

  const payload = input.payload as ObservedPayload;
  const findings: DriftFinding[] = [];
  const expectedNames = new Set(schema.fields.map((f) => f.name));

  for (const field of schema.fields) {
    if (!(field.name in payload)) {
      // Optional (`option<...>`) fields may be absent-as-null; absence of a
      // required field is breaking.
      if (field.type === "option<address>") continue;
      findings.push({
        kind: "missing_field",
        field: field.name,
        expected: field.type,
        breaking: true,
      });
      continue;
    }
    const observed = input.observedTypes?.[field.name] ?? inferObservedType(payload[field.name]);
    if (!isCompatible(field.type, observed)) {
      findings.push({
        kind: "type_mismatch",
        field: field.name,
        expected: field.type,
        observed,
        breaking: true,
      });
    }
  }

  for (const key of Object.keys(payload)) {
    if (!expectedNames.has(key)) {
      findings.push({ kind: "unexpected_field", field: key, observed: inferObservedType(payload[key]), breaking: false });
    }
  }

  const breaking = findings.some((f) => f.breaking);
  return {
    ...base,
    findings,
    status: findings.length === 0 ? "compatible" : "drifted",
    breaking,
  };
}

export interface RetryOptions {
  /** Total attempts including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Produces the payload for a given attempt (1-based); used when the producer is still settling. */
  fetchPayload: (attempt: number) => unknown;
  /** Returns true when a report is conclusive and retrying should stop. */
  isConclusive?: (report: DriftReport) => boolean;
}

export interface RetryResult {
  report: DriftReport;
  attempts: number;
  exhausted: boolean;
}

/**
 * Retries drift detection while the observed payload is not yet conclusive
 * (by default: a `malformed_payload` result from a still-settling producer).
 * Stops on the first conclusive verdict; returns the last report with
 * `exhausted: true` when retries run out, so callers can alert or roll back.
 */
export function detectSchemaDriftWithRetry(
  input: Omit<DriftInput, "payload">,
  retry: RetryOptions,
  options: DriftOptions = {},
): RetryResult {
  const maxAttempts = Math.max(1, retry.maxAttempts ?? 3);
  const isConclusive =
    retry.isConclusive ?? ((r: DriftReport) => r.status !== "malformed_payload");
  let report: DriftReport | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    report = detectSchemaDrift({ ...input, payload: retry.fetchPayload(attempt) }, options);
    if (isConclusive(report)) {
      return { report, attempts: attempt, exhausted: false };
    }
  }
  return { report: report!, attempts: maxAttempts, exhausted: true };
}
