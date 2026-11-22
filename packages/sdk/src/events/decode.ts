/**
 * Versioned event decoder — Issue #424 (scoped slice).
 *
 * Decoders here are derived at runtime from the single {@link EVENT_SCHEMAS}
 * specification (schema.ts) rather than hand-written per event, so every
 * event decodes through the same field-coercion logic. An event/version
 * combination this build doesn't recognize decodes to
 * `{ recognized: false }` instead of throwing or silently mis-decoding —
 * see `docs/event-versioning.md` for the compatibility policy this
 * supports.
 *
 * Schema drift detection: when a payload carries fields that the checked-in
 * schema for its (type, version) does not declare, or lacks fields the schema
 * requires, the decoder reports the mismatch via `drift` on the decoded result
 * rather than silently dropping or fabricating data. Drift never throws;
 * callers decide whether to log, alert, or reject.
 *
 * Edge cases and recovery:
 * - Unknown event type or unsupported version: returned as `recognized: false`
 *   with the raw payload preserved for replay once a build with the schema ships.
 * - Missing required field: decoded as `undefined` (or the type's zero value)
 *   and listed in `drift.missingFields`; the event is still `recognized: true`
 *   so indexers keep progressing. Consumers relying on the field must check
 *   `drift`.
 * - Extra field not in schema: ignored for `data` (preserving the existing
 *   contract) but listed in `drift.extraFields` so it is visible to operators.
 * - Coercion failure (e.g. non-numeric value for u64): the field is returned
 *   as `undefined` and recorded in `drift.invalidFields` instead of throwing.
 */
import {
  CURRENT_EVENT_SCHEMA_VERSION,
  ALL_EVENT_SCHEMAS,
  getEventSchema,
  type EventFieldType,
} from "./schema.js";

export interface SchemaDrift {
  /** Schema-declared fields absent from the payload. */
  missingFields: string[];
  /** Payload fields not declared in the schema for this type/version. */
  extraFields: string[];
  /** Fields whose value could not be coerced to the declared type. */
  invalidFields: string[];
}

export interface DecodedEvent<T = Record<string, unknown>> {
  recognized: true;
  type: string;
  version: number;
  data: T;
  /** Present only when the payload diverged from the checked-in schema. */
  drift?: SchemaDrift;
}

export interface UnrecognizedEvent {
  recognized: false;
  type: string;
  version: number;
  /** Reason decoding was skipped — an unknown event name or an unsupported version. */
  reason: "unknown_type" | "unsupported_version";
  /** The raw, un-decoded payload as received (e.g. from `scValToNative`). */
  raw: unknown;
}

export type DecodeResult<T = Record<string, unknown>> = DecodedEvent<T> | UnrecognizedEvent;

const RESERVED_KEYS = new Set(["version"]);

function coerceField(type: EventFieldType, value: unknown): unknown {
  switch (type) {
    case "u32":
      return typeof value === "number" ? value : Number(value as never);
    case "u64":
    case "u128":
    case "i128":
      // Soroban SDKs decode 64/128-bit integers as `bigint`; normalize any
      // numeric/string input so callers get a consistent type regardless of
      // which layer (raw RPC vs. already-`scValToNative`'d) produced it.
      return typeof value === "bigint" ? value : BigInt(value as never);
    case "bool":
      return Boolean(value);
    case "string":
      return value === undefined || value === null ? undefined : String(value);
    case "address":
      return value === undefined || value === null ? undefined : String(value);
    case "bytes32":
      // Left as whatever byte representation the caller's SDK layer used
      // (e.g. Buffer/Uint8Array) — this schema only asserts presence.
      return value;
    case "option<address>":
      return value === undefined || value === null ? undefined : String(value);
    case "vec<u64>":
      return Array.isArray(value)
        ? value.map((v) => (typeof v === "bigint" ? v : BigInt(v as never)))
        : [];
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Decodes a raw event payload (already run through the caller's
 * `scValToNative`-equivalent) against the checked-in schema for `type`.
 *
 * Never throws: an unknown `type`, or a `version` this build doesn't have a
 * schema entry for, returns an {@link UnrecognizedEvent} instead — callers
 * (indexer, webhooks, frontend) can log/skip/queue-for-replay rather than
 * crash when a newer contract deploy adds an event type they don't know
 * about yet.
 */
export function decodeEvent(
  type: string,
  raw: unknown,
  version: number = CURRENT_EVENT_SCHEMA_VERSION,
): DecodeResult {
  const source = (raw ?? {}) as Record<string, unknown>;

  let targetVersion = version;
  if (source && typeof source.version === "number") {
    targetVersion = source.version;
  } else if (source && typeof source.version === "bigint") {
    targetVersion = Number(source.version);
  }

  const hasEventName = Boolean(ALL_EVENT_SCHEMAS[type]);
  if (!hasEventName) {
    return { recognized: false, type, version: targetVersion, reason: "unknown_type", raw };
  }

  const schema = getEventSchema(type, targetVersion);
  if (!schema) {
    return { recognized: false, type, version: targetVersion, reason: "unsupported_version", raw };
  }

  const declared = new Set(schema.fields.map((f) => f.name));
  const drift: SchemaDrift = { missingFields: [], extraFields: [], invalidFields: [] };

  const data: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const present = Object.prototype.hasOwnProperty.call(source, field.name);
    if (!present) {
      drift.missingFields.push(field.name);
    }
    try {
      const coerced = coerceField(field.type, source[field.name]);
      if (typeof coerced === "number" && Number.isNaN(coerced)) {
        drift.invalidFields.push(field.name);
      }
      data[field.name] = coerced;
    } catch {
      drift.invalidFields.push(field.name);
      data[field.name] = undefined;
    }
  }

  for (const key of Object.keys(source)) {
    if (!declared.has(key) && !RESERVED_KEYS.has(key)) {
      drift.extraFields.push(key);
    }
  }

  const hasDrift =
    drift.missingFields.length > 0 ||
    drift.extraFields.length > 0 ||
    drift.invalidFields.length > 0;

  return hasDrift
    ? { recognized: true, type, version: targetVersion, data, drift }
    : { recognized: true, type, version: targetVersion, data };
}
