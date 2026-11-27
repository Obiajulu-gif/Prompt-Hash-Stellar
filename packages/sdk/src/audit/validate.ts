/**
 * Schema validation and backward-compatibility helpers — Issue #1094.
 *
 * `validateAuditEvent` checks that a plain object satisfies the
 * `AuditEvent` envelope contract.  It never throws: it returns a typed
 * result so callers can quarantine, log, or dead-letter invalid events
 * without crashing.
 *
 * `isCompatible` answers whether this build can safely decode an event
 * whose `schemaVersion` it has just read off the wire.
 */
import {
  AUDIT_SCHEMA_VERSION,
  SUPPORTED_AUDIT_SCHEMA_VERSIONS,
  REDACTED_FIELDS,
  type AuditEvent,
  type AuditSchemaVersion,
} from "./types.js";

// ─── Compatibility ────────────────────────────────────────────────────────────

/**
 * True when this SDK build supports the given schema version.
 *
 * Consumers should call this before attempting to decode an event from a
 * remote source (indexer replay queue, webhook delivery).  An unsupported
 * version should be quarantined — not silently dropped — so it can be
 * replayed after an upgrade.
 */
export function isCompatible(version: number): version is AuditSchemaVersion {
  return (SUPPORTED_AUDIT_SCHEMA_VERSIONS as readonly number[]).includes(version);
}

/**
 * True when `version` is newer than the highest version this build knows.
 * Useful for distinguishing "version I haven't seen before" from
 * "version that predates my oldest supported version".
 */
export function isFutureVersion(version: number): boolean {
  return version > AUDIT_SCHEMA_VERSION;
}

// ─── Validation result ────────────────────────────────────────────────────────

export type ValidationOk<P extends Record<string, unknown>> = {
  valid: true;
  event: AuditEvent<P>;
};

export type ValidationError = {
  valid: false;
  errors: string[];
  /** The raw input, preserved for quarantine/dead-letter storage. */
  raw: unknown;
};

export type ValidationResult<P extends Record<string, unknown> = Record<string, unknown>> =
  | ValidationOk<P>
  | ValidationError;

// ─── Validator ────────────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a plain (possibly untrusted) object against the AuditEvent
 * envelope schema.
 *
 * Checks performed:
 *  1. Envelope shape — required fields present and correctly typed.
 *  2. Schema version — supported by this build.
 *  3. No redacted fields in the payload — events that reach this validator
 *     after `redactEvent` must not contain plaintext secrets.
 *  4. Actor has at least one identifying field.
 *  5. Resource has a valid `type`.
 *
 * @param raw  The untrusted input (e.g. parsed JSON from a queue message).
 */
export function validateAuditEvent<P extends Record<string, unknown> = Record<string, unknown>>(
  raw: unknown,
): ValidationResult<P> {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { valid: false, errors: ["Input is not a plain object"], raw };
  }

  // 1. schemaVersion
  const { schemaVersion, name, occurredAt, actor, resource, correlation, payload } = raw;

  if (typeof schemaVersion !== "number") {
    errors.push("schemaVersion must be a number");
  } else if (!isCompatible(schemaVersion)) {
    errors.push(
      `schemaVersion ${schemaVersion} is not supported by this build ` +
        `(supported: ${SUPPORTED_AUDIT_SCHEMA_VERSIONS.join(", ")})`,
    );
  }

  // 2. name
  if (!isNonEmptyString(name)) {
    errors.push("name must be a non-empty string");
  }

  // 3. occurredAt — must be an ISO-8601 string parseable by Date
  if (!isNonEmptyString(occurredAt)) {
    errors.push("occurredAt must be a non-empty string");
  } else if (Number.isNaN(Date.parse(occurredAt))) {
    errors.push(`occurredAt "${occurredAt}" is not a valid ISO-8601 date`);
  }

  // 4. actor — must have at least one identifying field
  if (!isPlainObject(actor)) {
    errors.push("actor must be a plain object");
  } else {
    const { stellarAddress, serviceId, adminRole } = actor;
    if (
      !isNonEmptyString(stellarAddress) &&
      !isNonEmptyString(serviceId) &&
      !isNonEmptyString(adminRole)
    ) {
      errors.push(
        "actor must have at least one of: stellarAddress, serviceId, adminRole",
      );
    }
  }

  // 5. resource
  const VALID_RESOURCE_TYPES = new Set([
    "prompt", "bundle", "access-pass", "license", "contract",
    "voucher", "listing", "fee", "dispute", "payout",
  ]);
  if (!isPlainObject(resource)) {
    errors.push("resource must be a plain object");
  } else if (!isNonEmptyString(resource.type) || !VALID_RESOURCE_TYPES.has(resource.type)) {
    errors.push(
      `resource.type must be one of: ${[...VALID_RESOURCE_TYPES].join(", ")}`,
    );
  }

  // 6. correlation — optional but must be an object when present
  if (correlation !== undefined && !isPlainObject(correlation)) {
    errors.push("correlation must be a plain object when present");
  }

  // 7. payload — must be a plain object; must not contain REDACTED_FIELDS
  if (!isPlainObject(payload)) {
    errors.push("payload must be a plain object");
  } else {
    const leaked = Object.keys(payload).filter((k) => REDACTED_FIELDS.has(k));
    if (leaked.length > 0) {
      errors.push(
        `payload contains redacted field(s): ${leaked.join(", ")} — ` +
          "call redactEvent before validation",
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, raw };
  }

  return { valid: true, event: raw as unknown as AuditEvent<P> };
}
