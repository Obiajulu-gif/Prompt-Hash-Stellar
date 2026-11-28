/**
 * Versioned audit-event contract — Issue #1094.
 *
 * Public surface of the `@prompthash/sdk` audit module.
 */

export type {
  AuditEvent,
  AuditActor,
  AuditResource,
  AuditCorrelation,
  AuditEventName,
  AuditSchemaVersion,
  SchemaMigrationNote,
} from "./types.js";

export {
  AUDIT_SCHEMA_VERSION,
  SUPPORTED_AUDIT_SCHEMA_VERSIONS,
  REDACTED_FIELDS,
  HASHED_FIELDS,
  REDACTION_SENTINEL,
  SCHEMA_MIGRATION_NOTES,
} from "./types.js";

export { redactEvent, redactObject, sha256Hex } from "./redact.js";

export type { ValidationResult, ValidationOk, ValidationError } from "./validate.js";
export { validateAuditEvent, isCompatible, isFutureVersion } from "./validate.js";

export type { MigrationResult } from "./compatibility.js";
export { migrateEvent, migrationPathSummary } from "./compatibility.js";
