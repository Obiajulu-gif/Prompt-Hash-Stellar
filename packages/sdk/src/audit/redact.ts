/**
 * Redaction and field-hashing for audit events — Issue #1094.
 *
 * Applies the rules declared in `types.ts` (`REDACTED_FIELDS`,
 * `HASHED_FIELDS`) to a raw audit event before it reaches any external sink
 * (log, analytics, webhook).  The transform is deterministic and pure: it
 * returns a new object and never mutates the input.
 *
 * ## Hashing
 *
 * SHA-256 is used because it is already a dependency of this package (the
 * receipt module uses it) and because the same hash function is used in the
 * contract for voucher codes — a consistent choice reduces the chance of a
 * mismatch.  The output is lowercase hex (64 characters) prefixed with
 * `"sha256:"` so a consumer can tell a hashed value from a plaintext one
 * without out-of-band context.
 */
import { createHash } from "node:crypto";
import {
  REDACTED_FIELDS,
  HASHED_FIELDS,
  REDACTION_SENTINEL,
  type AuditEvent,
} from "./types.js";

/** Hex-encoded SHA-256 of `value`, prefixed with `"sha256:"`. */
export function sha256Hex(value: string): string {
  return "sha256:" + createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Walk every key in `obj` and apply redaction/hashing rules.
 *
 * - Keys in `REDACTED_FIELDS` are replaced with `REDACTION_SENTINEL`.
 * - Keys in `HASHED_FIELDS` are replaced with `sha256Hex(String(value))`.
 * - All other keys are left unchanged.
 * - The function recurses into plain objects but not arrays (array values in
 *   audit payloads are identifiers like `prompt_ids: bigint[]` which do not
 *   require field-level redaction).
 *
 * @internal Use `redactEvent` for the full envelope.
 */
export function redactObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(key)) {
      result[key] = REDACTION_SENTINEL;
      continue;
    }
    if (HASHED_FIELDS.has(key)) {
      result[key] =
        value === undefined || value === null
          ? value
          : sha256Hex(String(value));
      continue;
    }
    // Recurse into nested plain objects (e.g. actor, resource, correlation).
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Uint8Array)
    ) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Return a redacted copy of `event` safe for external log sinks.
 *
 * The envelope fields (`schemaVersion`, `name`, `occurredAt`) are never
 * redacted — they are the queryable identity of the event.  Redaction is
 * applied to `actor`, `resource`, `correlation`, and `payload`.
 */
export function redactEvent<P extends Record<string, unknown>>(
  event: AuditEvent<P>,
): AuditEvent<Record<string, unknown>> {
  return {
    schemaVersion: event.schemaVersion,
    name: event.name,
    occurredAt: event.occurredAt,
    actor: redactObject(event.actor as Record<string, unknown>) as AuditEvent["actor"],
    resource: event.resource,          // only `type` and `id` — never sensitive
    correlation: redactObject(
      event.correlation as Record<string, unknown>,
    ) as AuditEvent["correlation"],
    payload: redactObject(event.payload as Record<string, unknown>),
  };
}
