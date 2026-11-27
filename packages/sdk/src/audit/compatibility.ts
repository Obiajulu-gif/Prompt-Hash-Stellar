/**
 * Backward-compatibility helpers — Issue #1094.
 *
 * When the audit-event envelope schema is bumped (AUDIT_SCHEMA_VERSION > 1),
 * old events stored in the database or on a replay queue will still carry the
 * old schemaVersion.  `migrateEvent` upgrades a single event from any
 * supported past version to the current one so a uniform pipeline can process
 * the whole history without branching per-version.
 *
 * Adding a new migration step here is the only code change needed when the
 * schema version is bumped — `validateAuditEvent` and `redactEvent` always
 * operate on the current shape.
 */
import { AUDIT_SCHEMA_VERSION, SCHEMA_MIGRATION_NOTES, type AuditEvent } from "./types.js";

export interface MigrationResult {
  migrated: boolean;
  /** Number of version steps applied (0 when already current). */
  steps: number;
  event: AuditEvent;
}

/**
 * Upgrade `event` from its current `schemaVersion` to `AUDIT_SCHEMA_VERSION`.
 *
 * Returns the event unchanged (with `migrated: false, steps: 0`) when it is
 * already at the current version.  Returns a transformed copy (never mutates)
 * when one or more migration steps are needed.
 *
 * Throws only when the event's `schemaVersion` is unknown (i.e. not in
 * `SUPPORTED_AUDIT_SCHEMA_VERSIONS` and not reachable by the migration chain).
 * Callers that want resilience should validate with `isCompatible` first and
 * quarantine the event if it returns false.
 */
export function migrateEvent(event: AuditEvent): MigrationResult {
  if (event.schemaVersion === AUDIT_SCHEMA_VERSION) {
    return { migrated: false, steps: 0, event };
  }

  let current: AuditEvent = { ...event };
  let steps = 0;

  // Walk the migration chain: apply each step whose fromVersion matches the
  // current schemaVersion until we reach AUDIT_SCHEMA_VERSION.
  while (current.schemaVersion < AUDIT_SCHEMA_VERSION) {
    const note = SCHEMA_MIGRATION_NOTES.find(
      (n) => n.fromVersion === current.schemaVersion,
    );
    if (!note) {
      throw new Error(
        `No migration path from schemaVersion ${current.schemaVersion} ` +
          `to ${AUDIT_SCHEMA_VERSION}. ` +
          "Add an entry to SCHEMA_MIGRATION_NOTES in types.ts.",
      );
    }

    current = applyMigrationStep(current, note.fromVersion, note.toVersion);
    steps++;
  }

  return { migrated: true, steps, event: current };
}

/**
 * Apply one migration step, transforming `event` from `fromVersion` to
 * `toVersion`.
 *
 * Add a `case` branch here for every version bump.  The switch is
 * exhaustive-by-convention: an unhandled step throws immediately so it is
 * caught during development rather than silently producing wrong data.
 */
function applyMigrationStep(
  event: AuditEvent,
  fromVersion: number,
  toVersion: number,
): AuditEvent {
  switch (`${fromVersion}->${toVersion}`) {
    // No migrations yet — AUDIT_SCHEMA_VERSION is 1.
    // When version 2 ships, add:
    // case "1->2":
    //   return {
    //     ...event,
    //     schemaVersion: 2,
    //     payload: { ...event.payload, tags: (event.payload as any).tags ?? [] },
    //   };
    default:
      throw new Error(
        `applyMigrationStep: no handler for ${fromVersion}->${toVersion}. ` +
          "Add a case branch in compatibility.ts.",
      );
  }
}

/**
 * Summarise every migration path from `fromVersion` to `AUDIT_SCHEMA_VERSION`
 * as a human-readable string.  Used in test output and error messages.
 */
export function migrationPathSummary(fromVersion: number): string {
  const steps: string[] = [];
  let v = fromVersion;
  while (v < AUDIT_SCHEMA_VERSION) {
    const note = SCHEMA_MIGRATION_NOTES.find((n) => n.fromVersion === v);
    if (!note) break;
    steps.push(`v${v}→v${note.toVersion}: ${note.changes}`);
    v = note.toVersion;
  }
  return steps.length === 0
    ? `v${fromVersion} is already current (no migration needed)`
    : steps.join(" | ");
}
