import { describe, expect, it } from "vitest";
import {
  loadMigrationFixture,
  verifyMigrationFixtureSet,
  verifyRollbackEquivalence,
} from "../services/migrationFixturesService";
import { NEXT_PROMPT_SCHEMA_VERSION } from "../services/schemaMigrationCompatibility";

describe("Versioned Migration Notes and Compatibility Fixtures (Issue #1138)", () => {
  it("normal path: v0, v1, v2, and v3 fixtures migrate successfully to target v3", async () => {
    const v0 = await loadMigrationFixture("v0_legacy");
    const v1 = await loadMigrationFixture("v1_legacy");
    const v2 = await loadMigrationFixture("v2_production");
    const v3 = await loadMigrationFixture("v3_target");

    const allFixtures = [...v0, ...v1, ...v2, ...v3];
    const report = verifyMigrationFixtureSet(allFixtures, NEXT_PROMPT_SCHEMA_VERSION);

    expect(report.compatible).toBe(true);
    expect(report.blockedRecords).toBe(0);
    expect(report.errorCount).toBe(0);
    expect(report.checked).toBe(allFixtures.length);
    expect(report.fingerprint).toBeDefined();

    // Verify candidate properties
    for (const record of report.records) {
      expect(record.compatible).toBe(true);
      expect(record.candidate).toBeDefined();
      const cand = record.candidate!;
      // Deprecated aliases must be stripped in v3
      expect(cand.image).toBeUndefined();
      expect(cand.price).toBeUndefined();
      expect(cand.isActive).toBeUndefined();
      expect(cand.listingStatus).toBeUndefined();
      // Canonical fields must be present
      expect(cand.imageUrl).toBeDefined();
      expect(cand.priceStroops).toBeDefined();
      expect(cand.active).toBeDefined();
      expect(cand.lifecycleState).toBeDefined();
    }
  });

  it("failure path: incompatible fixtures are blocked with precise error codes", async () => {
    const badFixtures = await loadMigrationFixture("incompatible_cases");
    const report = verifyMigrationFixtureSet(badFixtures, NEXT_PROMPT_SCHEMA_VERSION);

    expect(report.compatible).toBe(false);
    expect(report.errorCount).toBe(4);
    expect(report.blockedRecords).toBe(4);

    const issueCodes = report.issues.map((i) => i.code);
    expect(issueCodes).toContain("unmapped_deprecated_field");
    expect(issueCodes).toContain("conflicting_rename");
    expect(issueCodes).toContain("future_schema_version");
    expect(issueCodes).toContain("missing_required_field");

    // Check specific remediation advice
    const unmappedIssue = report.issues.find((i) => i.code === "unmapped_deprecated_field");
    expect(unmappedIssue?.remediation).toContain("priceStroops");

    const conflictingIssue = report.issues.find((i) => i.code === "conflicting_rename");
    expect(conflictingIssue?.remediation).toContain("imageUrl");
  });

  it("retry path: re-running compatibility verification is idempotent with identical fingerprint", async () => {
    const v2 = await loadMigrationFixture("v2_production");

    const run1 = verifyMigrationFixtureSet(v2, NEXT_PROMPT_SCHEMA_VERSION);
    const run2 = verifyMigrationFixtureSet(v2, NEXT_PROMPT_SCHEMA_VERSION);

    expect(run1.compatible).toBe(true);
    expect(run2.compatible).toBe(true);
    // Deterministic fingerprint hash must match exactly across retries
    expect(run1.fingerprint).toBe(run2.fingerprint);
  });

  it("rollback equivalence: verifies restoration of original state from pre-migration snapshot", async () => {
    const v2Original = await loadMigrationFixture("v2_production");
    const cloned = JSON.parse(JSON.stringify(v2Original));

    // Identical snapshot matches
    expect(verifyRollbackEquivalence(v2Original, cloned)).toBe(true);

    // Modified/corrupted snapshot fails equivalence check
    cloned[0].priceStroops = 99999999;
    expect(verifyRollbackEquivalence(v2Original, cloned)).toBe(false);
  });

  it("authorization / gate check: rejects target version that is not supported", async () => {
    const v2 = await loadMigrationFixture("v2_production");
    // Attempting migration to an unsupported future schema version (e.g. v9)
    const report = verifyMigrationFixtureSet(v2, 9);
    expect(report.compatible).toBe(false);
    expect(report.issues[0].code).toBe("unsupported_target_version");
  });
});

