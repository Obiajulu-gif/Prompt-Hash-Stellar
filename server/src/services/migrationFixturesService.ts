/**
 * Migration Fixtures & Compatibility Verification Service (#1138).
 *
 * Provides structured loading, schema version validation, and compatibility
 * assertions across versioned prompt fixtures (v0, v1, v2, v3, and incompatible boundary cases).
 */

import { promises as fs } from "fs";
import path from "path";
import {
  checkPromptMigrationCompatibility,
  type PromptMigrationCompatibilityReport,
  NEXT_PROMPT_SCHEMA_VERSION,
} from "./schemaMigrationCompatibility";

export type MigrationFixtureName =
  | "v0_legacy"
  | "v1_legacy"
  | "v2_production"
  | "v3_target"
  | "incompatible_cases";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/migrations");

/**
 * Loads a versioned migration fixture by name.
 */
export async function loadMigrationFixture(
  name: MigrationFixtureName,
): Promise<Record<string, unknown>[]> {
  const filePath = path.join(FIXTURES_DIR, `${name}.json`);
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

/**
 * Runs the migration compatibility verification over a set of fixtures.
 */
export function verifyMigrationFixtureSet(
  records: unknown[],
  targetVersion: number = NEXT_PROMPT_SCHEMA_VERSION,
): PromptMigrationCompatibilityReport {
  return checkPromptMigrationCompatibility(records, { toVersion: targetVersion });
}

/**
 * Verifies that a rollback plan can restore the original pre-migration state.
 * Space: O(N), Time: O(N) where N is number of records.
 */
export function verifyRollbackEquivalence(
  originalRecords: Record<string, any>[],
  restoredRecords: Record<string, any>[],
): boolean {
  if (originalRecords.length !== restoredRecords.length) return false;

  const restoredMap = new Map(restoredRecords.map((r) => [String(r._id || r.id), r]));

  for (const original of originalRecords) {
    const key = String(original._id || original.id);
    const restored = restoredMap.get(key);
    if (!restored) return false;

    // Compare original keys with restored keys
    for (const field of Object.keys(original)) {
      if (JSON.stringify(original[field]) !== JSON.stringify(restored[field])) {
        return false;
      }
    }
  }

  return true;
}

