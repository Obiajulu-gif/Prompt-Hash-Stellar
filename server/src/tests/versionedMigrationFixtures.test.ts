import { describe, expect, it } from "vitest";
import {
  MIGRATION_FIXTURE_CATALOG,
  MIGRATION_FIXTURE_NAMES,
  SchemaMigrationMatrixError,
  buildSchemaMigrationCompatibilityMatrix,
  classifyCompatibilityReportStatus,
  evaluateMigrationFixtureCell,
  isMigrationFixtureName,
  loadAllMigrationFixtures,
  loadMigrationFixture,
  schemaMigrationMatrixRemedy,
  verifyMigrationFixtureSet,
  verifyRollbackEquivalence,
} from "../services/migrationFixturesService";
import { NEXT_PROMPT_SCHEMA_VERSION } from "../services/schemaMigrationCompatibility";
import {
  EvaluateSchemaMigrationCompatibility,
  GetSchemaMigrationFixtures,
  GetSchemaMigrationMatrix,
  VerifySchemaMigrationRollback,
} from "../controllers/schemaMigrationControllers";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  return res;
}

function mockAdminReq(
  overrides: Record<string, unknown> = {},
  scopes: string[] = ["schema:read", "schema:write"],
) {
  return {
    admin: {
      sub: "ops-migration-admin",
      role: "admin",
      scope: scopes,
    },
    query: {},
    body: {},
    params: {},
    ...overrides,
  } as any;
}

describe("Schema Migration Compatibility Matrix & Fixtures", () => {
  describe("normal path: compatibility matrix and fixture suite", () => {
    it("v0, v1, v2, and v3 fixtures migrate successfully to target v3", async () => {
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

    it("loads all fixtures and evaluates the full compatibility matrix with all expectations met", async () => {
      const all = await loadAllMigrationFixtures();
      expect(Object.keys(all)).toEqual([...MIGRATION_FIXTURE_NAMES]);

      const matrix = await buildSchemaMigrationCompatibilityMatrix();
      expect(matrix.fromVersion).toBe(2);
      expect(matrix.toVersion).toBe(NEXT_PROMPT_SCHEMA_VERSION);
      expect(matrix.totalFixtures).toBe(MIGRATION_FIXTURE_NAMES.length);
      expect(matrix.allExpectationsMet).toBe(true);
      expect(matrix.matrixFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(matrix.migrationPlan.length).toBeGreaterThanOrEqual(5);
      expect(matrix.rollbackPlan.length).toBeGreaterThanOrEqual(5);

      for (const cell of matrix.cells) {
        expect(cell.matchesExpectation).toBe(true);
        expect(cell.description.length).toBeGreaterThan(10);
        expect(cell.rollbackStrategy.length).toBeGreaterThan(10);
      }
    });

    it("evaluates moderation precedence and custom unknown fields across fixtures", async () => {
      const v1Cell = await evaluateMigrationFixtureCell("v1_legacy");
      expect(v1Cell.compatible).toBe(true);
      // Second v1 record has listingStatus=published but moderationStatus=restricted -> hidden
      const restrictedCandidate = v1Cell.report.records.find(
        (r) => r.recordId === "64f1a2b3c4d5e6f7a8b90011",
      )?.candidate;
      expect(restrictedCandidate?.lifecycleState).toBe("hidden");

      const v3Cell = await evaluateMigrationFixtureCell("v3_target");
      expect(v3Cell.compatible).toBe(true);
      const customFieldRecord = v3Cell.report.records.find(
        (r) => r.recordId === "64f1a2b3c4d5e6f7a8b90031",
      );
      expect(customFieldRecord?.unknownFields).toContain("customProvenanceTag");
      expect(customFieldRecord?.candidate?.customProvenanceTag).toBe("import-batch-2026");
    });

    it("classifies report status as compatible when there are zero errors and zero warnings", () => {
      const v2CleanOnly = [
        {
          _id: "clean-v2-only",
          schemaVersion: 2,
          title: "Clean V2 Prompt",
          category: "Programming",
          description: "No aliases or legacy version warnings.",
          tags: ["clean"],
          imageUrl: "https://example.com/clean.png",
          priceStroops: 10000000,
          active: true,
          lifecycleState: "published",
          licence: "standard",
          moderationStatus: "none",
        },
      ];
      const report = verifyMigrationFixtureSet(v2CleanOnly);
      expect(classifyCompatibilityReportStatus(report)).toBe("compatible");
    });
  });

  describe("failure path: incompatible fixtures and validation errors", () => {
    it("blocks incompatible fixtures with precise error codes and remediation advice", async () => {
      const badFixtures = await loadMigrationFixture("incompatible_cases");
      const report = verifyMigrationFixtureSet(badFixtures, NEXT_PROMPT_SCHEMA_VERSION);

      expect(report.compatible).toBe(false);
      expect(report.errorCount).toBe(4);
      expect(report.blockedRecords).toBe(4);
      expect(classifyCompatibilityReportStatus(report)).toBe("blocked");

      const issueCodes = report.issues.map((i) => i.code);
      expect(issueCodes).toContain("unmapped_deprecated_field");
      expect(issueCodes).toContain("conflicting_rename");
      expect(issueCodes).toContain("future_schema_version");
      expect(issueCodes).toContain("missing_required_field");

      const unmappedIssue = report.issues.find((i) => i.code === "unmapped_deprecated_field");
      expect(unmappedIssue?.remediation).toContain("priceStroops");

      const conflictingIssue = report.issues.find((i) => i.code === "conflicting_rename");
      expect(conflictingIssue?.remediation).toContain("imageUrl");
    });

    it("rejects unknown fixture names, malformed payloads, and invalid target versions", async () => {
      expect(isMigrationFixtureName("v0_legacy")).toBe(true);
      expect(isMigrationFixtureName("unknown_fixture")).toBe(false);

      await expect(
        loadMigrationFixture("unknown_fixture" as any),
      ).rejects.toThrowError(SchemaMigrationMatrixError);

      await expect(
        buildSchemaMigrationCompatibilityMatrix({ fixtures: [] }),
      ).rejects.toMatchObject({ code: "invalid_fixture_name" });

      expect(() => verifyMigrationFixtureSet("not-an-array" as any)).toThrowError(
        SchemaMigrationMatrixError,
      );

      expect(() => verifyMigrationFixtureSet([], 0)).toThrowError(
        SchemaMigrationMatrixError,
      );

      for (const code of [
        "invalid_fixture_name",
        "invalid_records_payload",
        "invalid_target_version",
        "authorization_required",
        "insufficient_scope",
      ] as const) {
        expect(schemaMigrationMatrixRemedy(code).length).toBeGreaterThan(10);
      }
    });
  });

  describe("retry & rollback equivalence path", () => {
    it("re-running compatibility verification and matrix build is idempotent with identical fingerprints", async () => {
      const v2 = await loadMigrationFixture("v2_production");

      const run1 = verifyMigrationFixtureSet(v2, NEXT_PROMPT_SCHEMA_VERSION);
      const run2 = verifyMigrationFixtureSet(v2, NEXT_PROMPT_SCHEMA_VERSION);

      expect(run1.compatible).toBe(true);
      expect(run2.compatible).toBe(true);
      expect(run1.fingerprint).toBe(run2.fingerprint);

      const matrix1 = await buildSchemaMigrationCompatibilityMatrix();
      const matrix2 = await buildSchemaMigrationCompatibilityMatrix();
      expect(matrix1.matrixFingerprint).toBe(matrix2.matrixFingerprint);
      expect(matrix1.cells.map((c) => c.fingerprint)).toEqual(
        matrix2.cells.map((c) => c.fingerprint),
      );
    });

    it("verifies restoration of original state from pre-migration snapshot regardless of key order", async () => {
      const v2Original = await loadMigrationFixture("v2_production");
      const cloned = JSON.parse(JSON.stringify(v2Original));

      // Identical snapshot matches
      expect(verifyRollbackEquivalence(v2Original, cloned)).toBe(true);

      // Reordered object keys still match canonically
      const reordered = cloned.map((rec: Record<string, unknown>) => {
        const reversedEntries = Object.entries(rec).reverse();
        return Object.fromEntries(reversedEntries);
      });
      expect(verifyRollbackEquivalence(v2Original, reordered)).toBe(true);

      // Extra unexpected field on restored snapshot fails equivalence
      const withExtraField = JSON.parse(JSON.stringify(v2Original));
      withExtraField[0].unexpectedLeakedField = "leak";
      expect(verifyRollbackEquivalence(v2Original, withExtraField)).toBe(false);

      // Modified/corrupted field value fails equivalence
      cloned[0].priceStroops = 99999999;
      expect(verifyRollbackEquivalence(v2Original, cloned)).toBe(false);
    });
  });

  describe("authorization & admin controller contract", () => {
    it("rejects target version that is not supported by the migration gate", async () => {
      const v2 = await loadMigrationFixture("v2_production");
      const report = verifyMigrationFixtureSet(v2, 9);
      expect(report.compatible).toBe(false);
      expect(report.issues[0].code).toBe("unsupported_target_version");
    });

    it("denies unauthenticated or under-scoped requests with 401 and 403", async () => {
      const unauthRes = mockRes();
      await GetSchemaMigrationMatrix({ query: {} } as any, unauthRes);
      expect(unauthRes.statusCode).toBe(401);
      expect(unauthRes.body.code).toBe("authorization_required");

      const readOnlyAdminReq = mockAdminReq(
        { body: { fixture: "v2_production" } },
        ["schema:read"],
      );
      const forbiddenRes = mockRes();
      await EvaluateSchemaMigrationCompatibility(readOnlyAdminReq, forbiddenRes);
      expect(forbiddenRes.statusCode).toBe(403);
      expect(forbiddenRes.body.code).toBe("insufficient_scope");
    });

    it("allows authorized admin to inspect the matrix, filter fixtures, evaluate batches, and verify rollback", async () => {
      // 1. GET /matrix
      const matrixRes = mockRes();
      await GetSchemaMigrationMatrix(
        mockAdminReq({ query: { fixtures: "v0_legacy,incompatible_cases" } }),
        matrixRes,
      );
      expect(matrixRes.statusCode).toBe(200);
      expect(matrixRes.body.evaluatedBy).toBe("ops-migration-admin");
      expect(matrixRes.body.totalFixtures).toBe(2);
      expect(matrixRes.body.allExpectationsMet).toBe(true);

      // 2. GET /fixtures catalog & single fixture
      const catalogRes = mockRes();
      await GetSchemaMigrationFixtures(mockAdminReq(), catalogRes);
      expect(catalogRes.statusCode).toBe(200);
      expect(catalogRes.body.fixtures).toHaveLength(MIGRATION_FIXTURE_NAMES.length);

      const singleFixtureRes = mockRes();
      await GetSchemaMigrationFixtures(
        mockAdminReq({ query: { name: "v1_legacy" } }),
        singleFixtureRes,
      );
      expect(singleFixtureRes.statusCode).toBe(200);
      expect(singleFixtureRes.body.fixture.name).toBe(MIGRATION_FIXTURE_CATALOG.v1_legacy.name);
      expect(singleFixtureRes.body.records.length).toBeGreaterThanOrEqual(2);

      // 3. POST /evaluate (named fixture & raw records)
      const evalFixtureRes = mockRes();
      await EvaluateSchemaMigrationCompatibility(
        mockAdminReq({ body: { fixture: "v2_production" } }),
        evalFixtureRes,
      );
      expect(evalFixtureRes.statusCode).toBe(200);
      expect(evalFixtureRes.body.mode).toBe("fixture");
      expect(evalFixtureRes.body.cell.compatible).toBe(true);

      const v3Records = await loadMigrationFixture("v3_target");
      const evalRecordsRes = mockRes();
      await EvaluateSchemaMigrationCompatibility(
        mockAdminReq({ body: { records: v3Records } }),
        evalRecordsRes,
      );
      expect(evalRecordsRes.statusCode).toBe(200);
      expect(evalRecordsRes.body.mode).toBe("records");
      expect(evalRecordsRes.body.report.compatible).toBe(true);

      // 4. POST /verify-rollback
      const rollbackRes = mockRes();
      await VerifySchemaMigrationRollback(
        mockAdminReq({
          body: {
            originalRecords: v3Records,
            restoredRecords: JSON.parse(JSON.stringify(v3Records)),
          },
        }),
        rollbackRes,
      );
      expect(rollbackRes.statusCode).toBe(200);
      expect(rollbackRes.body.equivalent).toBe(true);
      expect(rollbackRes.body.fingerprintMatch).toBe(true);
    });

    it("returns 400 with stable error code and remedy for bad query or body parameters", async () => {
      const badVersionRes = mockRes();
      await GetSchemaMigrationMatrix(
        mockAdminReq({ query: { toVersion: "0" } }),
        badVersionRes,
      );
      expect(badVersionRes.statusCode).toBe(400);
      expect(badVersionRes.body.code).toBe("invalid_target_version");

      const badFixtureRes = mockRes();
      await GetSchemaMigrationFixtures(
        mockAdminReq({ query: { name: "nonexistent" } }),
        badFixtureRes,
      );
      expect(badFixtureRes.statusCode).toBe(400);
      expect(badFixtureRes.body.code).toBe("invalid_fixture_name");

      const badEvalRes = mockRes();
      await EvaluateSchemaMigrationCompatibility(
        mockAdminReq({ body: {} }),
        badEvalRes,
      );
      expect(badEvalRes.statusCode).toBe(400);
      expect(badEvalRes.body.code).toBe("invalid_records_payload");
    });
  });
});
