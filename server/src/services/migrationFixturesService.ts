/**
 * Schema Migration Compatibility Matrix & Fixtures Service.
 *
 * Provides a canonical compatibility matrix across Prompt storage schema versions
 * (v0, v1, v2, v3) and negative/boundary fixtures, supporting:
 *   - Read-only compatibility evaluation over the checked-in fixture suite
 *   - Custom batch evaluation against any target schema version
 *   - Deterministic SHA-256 matrix and cell fingerprinting for idempotent retries
 *   - Rollback equivalence verification and recovery guidance
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { canonicalJson } from "./canonicalSerialization";
import {
  CURRENT_PROMPT_SCHEMA_VERSION,
} from "./schemaVersioning";
import {
  NEXT_PROMPT_SCHEMA_VERSION,
  PROMPT_V3_MANIFEST,
  checkPromptMigrationCompatibility,
  type CompatibilityIssueCode,
  type PromptMigrationCompatibilityReport,
} from "./schemaMigrationCompatibility";

export type MigrationFixtureName =
  | "v0_legacy"
  | "v1_legacy"
  | "v2_production"
  | "v3_target"
  | "incompatible_cases";

export const MIGRATION_FIXTURE_NAMES: readonly MigrationFixtureName[] = [
  "v0_legacy",
  "v1_legacy",
  "v2_production",
  "v3_target",
  "incompatible_cases",
] as const;

export type TransitionCompatibilityStatus =
  | "compatible"
  | "compatible_with_warnings"
  | "blocked";

export interface MigrationFixtureDescriptor {
  name: MigrationFixtureName;
  sourceVersion: number | "mixed";
  targetVersion: number;
  expectedStatus: TransitionCompatibilityStatus;
  expectedErrorCodes: readonly CompatibilityIssueCode[];
  description: string;
  rollbackStrategy: string;
}

export const MIGRATION_FIXTURE_CATALOG: Record<
  MigrationFixtureName,
  MigrationFixtureDescriptor
> = {
  v0_legacy: {
    name: "v0_legacy",
    sourceVersion: 0,
    targetVersion: NEXT_PROMPT_SCHEMA_VERSION,
    expectedStatus: "compatible_with_warnings",
    expectedErrorCodes: [],
    description:
      "Unversioned / v0 prototype records using deprecated aliases (image, isActive, listingStatus) and missing optional defaults.",
    rollbackStrategy:
      "Restore pre-migration v0 snapshot and verify SHA-256 fingerprint equivalence; v2 read path preserves legacy defaults.",
  },
  v1_legacy: {
    name: "v1_legacy",
    sourceVersion: 1,
    targetVersion: NEXT_PROMPT_SCHEMA_VERSION,
    expectedStatus: "compatible_with_warnings",
    expectedErrorCodes: [],
    description:
      "v1 pre-stroop records with legacy aliases, moderation precedence over listingStatus, and custom subcategory fields.",
    rollbackStrategy:
      "Restore pre-migration v1 snapshot at batch boundary and confirm rollback equivalence against retained source documents.",
  },
  v2_production: {
    name: "v2_production",
    sourceVersion: CURRENT_PROMPT_SCHEMA_VERSION,
    targetVersion: NEXT_PROMPT_SCHEMA_VERSION,
    expectedStatus: "compatible_with_warnings",
    expectedErrorCodes: [],
    description:
      "Current v2 production records including dual-written transitional aliases alongside canonical v2 fields.",
    rollbackStrategy:
      "Revert batch writes from retained v2 backup; keep dual-read aliases active until post-migration verification completes.",
  },
  v3_target: {
    name: "v3_target",
    sourceVersion: NEXT_PROMPT_SCHEMA_VERSION,
    targetVersion: NEXT_PROMPT_SCHEMA_VERSION,
    expectedStatus: "compatible_with_warnings",
    expectedErrorCodes: [],
    description:
      "Already-migrated v3 target records verifying idempotent no-op re-runs and custom unknown-field preservation.",
    rollbackStrategy:
      "No-op transition; records are already at v3. Use pre-upgrade backup only if rolling back the entire deployment to v2.",
  },
  incompatible_cases: {
    name: "incompatible_cases",
    sourceVersion: "mixed",
    targetVersion: NEXT_PROMPT_SCHEMA_VERSION,
    expectedStatus: "blocked",
    expectedErrorCodes: [
      "unmapped_deprecated_field",
      "conflicting_rename",
      "future_schema_version",
      "missing_required_field",
    ],
    description:
      "Negative boundary fixtures exercising unmapped legacy price, conflicting alias renames, future schema versions, and missing required fields.",
    rollbackStrategy:
      "Fail-closed preflight gate blocks execution before any write occurs; remediate source records or upgrade consumer build.",
  },
};

export interface SchemaMigrationMatrixCell {
  fixture: MigrationFixtureName;
  sourceVersion: number | "mixed";
  targetVersion: number;
  expectedStatus: TransitionCompatibilityStatus;
  actualStatus: TransitionCompatibilityStatus;
  matchesExpectation: boolean;
  checked: number;
  compatible: boolean;
  blockedRecords: number;
  errorCount: number;
  warningCount: number;
  issueCodes: CompatibilityIssueCode[];
  fingerprint: string;
  description: string;
  rollbackStrategy: string;
  report: PromptMigrationCompatibilityReport;
}

export interface SchemaMigrationCompatibilityMatrix {
  fromVersion: number;
  toVersion: number;
  manifest: typeof PROMPT_V3_MANIFEST;
  allExpectationsMet: boolean;
  totalFixtures: number;
  totalRecordsChecked: number;
  cells: SchemaMigrationMatrixCell[];
  matrixFingerprint: string;
  migrationPlan: string[];
  rollbackPlan: string[];
}

export type SchemaMigrationMatrixErrorCode =
  | "invalid_fixture_name"
  | "invalid_records_payload"
  | "invalid_target_version"
  | "authorization_required"
  | "insufficient_scope";

export class SchemaMigrationMatrixError extends Error {
  constructor(
    public readonly code: SchemaMigrationMatrixErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SchemaMigrationMatrixError";
  }
}

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/migrations");

export function isMigrationFixtureName(value: unknown): value is MigrationFixtureName {
  return (
    typeof value === "string" &&
    (MIGRATION_FIXTURE_NAMES as readonly string[]).includes(value)
  );
}

export function classifyCompatibilityReportStatus(
  report: PromptMigrationCompatibilityReport,
): TransitionCompatibilityStatus {
  if (!report.compatible || report.errorCount > 0) {
    return "blocked";
  }
  if (report.warningCount > 0) {
    return "compatible_with_warnings";
  }
  return "compatible";
}

/**
 * Loads a versioned migration fixture by name.
 */
export async function loadMigrationFixture(
  name: MigrationFixtureName,
): Promise<Record<string, unknown>[]> {
  if (!isMigrationFixtureName(name)) {
    throw new SchemaMigrationMatrixError(
      "invalid_fixture_name",
      `Unknown migration fixture "${String(name)}". Supported fixtures: ${MIGRATION_FIXTURE_NAMES.join(", ")}.`,
    );
  }
  const filePath = path.join(FIXTURES_DIR, `${name}.json`);
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

/**
 * Loads all checked-in migration fixtures keyed by fixture name.
 */
export async function loadAllMigrationFixtures(): Promise<
  Record<MigrationFixtureName, Record<string, unknown>[]>
> {
  const entries = await Promise.all(
    MIGRATION_FIXTURE_NAMES.map(async (name) => [
      name,
      await loadMigrationFixture(name),
    ] as const),
  );
  return Object.fromEntries(entries) as Record<
    MigrationFixtureName,
    Record<string, unknown>[]
  >;
}

/**
 * Runs the migration compatibility verification over a set of fixtures.
 */
export function verifyMigrationFixtureSet(
  records: unknown[],
  targetVersion: number = NEXT_PROMPT_SCHEMA_VERSION,
): PromptMigrationCompatibilityReport {
  if (!Array.isArray(records)) {
    throw new SchemaMigrationMatrixError(
      "invalid_records_payload",
      "Migration compatibility verification requires an array of records.",
    );
  }
  if (
    typeof targetVersion !== "number" ||
    !Number.isInteger(targetVersion) ||
    targetVersion < 1
  ) {
    throw new SchemaMigrationMatrixError(
      "invalid_target_version",
      "Target schema version must be a positive integer.",
    );
  }
  return checkPromptMigrationCompatibility(records, { toVersion: targetVersion });
}

/**
 * Evaluates a single named fixture against the compatibility matrix expectations.
 */
export async function evaluateMigrationFixtureCell(
  name: MigrationFixtureName,
  targetVersion: number = NEXT_PROMPT_SCHEMA_VERSION,
): Promise<SchemaMigrationMatrixCell> {
  const descriptor = MIGRATION_FIXTURE_CATALOG[name];
  if (!descriptor) {
    throw new SchemaMigrationMatrixError(
      "invalid_fixture_name",
      `Unknown migration fixture "${String(name)}".`,
    );
  }

  const records = await loadMigrationFixture(name);
  const report = verifyMigrationFixtureSet(records, targetVersion);
  const actualStatus = classifyCompatibilityReportStatus(report);
  const issueCodes = Array.from(new Set(report.issues.map((i) => i.code)));

  const expectedStatusForTarget =
    targetVersion === descriptor.targetVersion ? descriptor.expectedStatus : "blocked";
  const expectedErrorCodesForTarget =
    targetVersion === descriptor.targetVersion
      ? descriptor.expectedErrorCodes
      : (["unsupported_target_version"] as const);

  const hasAllExpectedErrors = expectedErrorCodesForTarget.every((code) =>
    issueCodes.includes(code),
  );
  const matchesExpectation =
    actualStatus === expectedStatusForTarget && hasAllExpectedErrors;

  return {
    fixture: name,
    sourceVersion: descriptor.sourceVersion,
    targetVersion,
    expectedStatus: expectedStatusForTarget,
    actualStatus,
    matchesExpectation,
    checked: report.checked,
    compatible: report.compatible,
    blockedRecords: report.blockedRecords,
    errorCount: report.errorCount,
    warningCount: report.warningCount,
    issueCodes,
    fingerprint: report.fingerprint,
    description: descriptor.description,
    rollbackStrategy: descriptor.rollbackStrategy,
    report,
  };
}

/**
 * Builds and evaluates the full schema migration compatibility matrix across
 * all checked-in versioned and negative fixtures.
 */
export async function buildSchemaMigrationCompatibilityMatrix(
  options: {
    fixtures?: readonly MigrationFixtureName[];
    targetVersion?: number;
  } = {},
): Promise<SchemaMigrationCompatibilityMatrix> {
  const fixtureNames = options.fixtures ?? MIGRATION_FIXTURE_NAMES;
  const targetVersion = options.targetVersion ?? NEXT_PROMPT_SCHEMA_VERSION;

  if (!Array.isArray(fixtureNames) || fixtureNames.length === 0) {
    throw new SchemaMigrationMatrixError(
      "invalid_fixture_name",
      "At least one migration fixture name must be provided.",
    );
  }

  for (const name of fixtureNames) {
    if (!isMigrationFixtureName(name)) {
      throw new SchemaMigrationMatrixError(
        "invalid_fixture_name",
        `Unknown migration fixture "${String(name)}". Supported fixtures: ${MIGRATION_FIXTURE_NAMES.join(", ")}.`,
      );
    }
  }

  const cells: SchemaMigrationMatrixCell[] = [];
  for (const name of fixtureNames) {
    cells.push(await evaluateMigrationFixtureCell(name, targetVersion));
  }

  const totalRecordsChecked = cells.reduce((sum, cell) => sum + cell.checked, 0);
  const allExpectationsMet = cells.every((cell) => cell.matchesExpectation);

  const matrixFingerprint = createHash("sha256")
    .update(
      canonicalJson({
        fromVersion: PROMPT_V3_MANIFEST.fromVersion,
        toVersion: targetVersion,
        cells: cells.map((cell) => ({
          fixture: cell.fixture,
          sourceVersion: cell.sourceVersion,
          targetVersion: cell.targetVersion,
          actualStatus: cell.actualStatus,
          matchesExpectation: cell.matchesExpectation,
          fingerprint: cell.fingerprint,
        })),
      }),
    )
    .digest("hex");

  const referenceReport =
    cells[0]?.report ?? checkPromptMigrationCompatibility([], { toVersion: targetVersion });

  return {
    fromVersion: PROMPT_V3_MANIFEST.fromVersion,
    toVersion: targetVersion,
    manifest: PROMPT_V3_MANIFEST,
    allExpectationsMet,
    totalFixtures: cells.length,
    totalRecordsChecked,
    cells,
    matrixFingerprint,
    migrationPlan: referenceReport.migrationPlan,
    rollbackPlan: referenceReport.rollbackPlan,
  };
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

    for (const field of Object.keys(original)) {
      if (canonicalJson(original[field]) !== canonicalJson(restored[field])) {
        return false;
      }
    }

    for (const field of Object.keys(restored)) {
      if (!(field in original)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Maps error codes to operator remediation guidance.
 */
export function schemaMigrationMatrixRemedy(
  code: SchemaMigrationMatrixErrorCode,
): string {
  switch (code) {
    case "invalid_fixture_name":
      return `Pass one or more valid fixture names (${MIGRATION_FIXTURE_NAMES.join(", ")}).`;
    case "invalid_records_payload":
      return "Provide a JSON array of Prompt records under `records` or select a named `fixture`.";
    case "invalid_target_version":
      return `Provide a positive integer targetVersion (current build targets v${NEXT_PROMPT_SCHEMA_VERSION}).`;
    case "authorization_required":
      return "Authenticate with a valid admin bearer token before accessing schema migration endpoints.";
    case "insufficient_scope":
      return "Use an admin token carrying `schema:read` for matrix inspection or `schema:write` for evaluation and rollback checks.";
  }
}
