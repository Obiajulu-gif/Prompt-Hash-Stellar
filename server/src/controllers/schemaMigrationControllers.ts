/**
 * Admin HTTP controllers for the Schema Migration Compatibility Matrix & Fixtures.
 *
 * All routes are protected by `requireAdminScope` (`schema:read` or `schema:write`)
 * and additionally verify the authenticated admin identity and scope inside the
 * controller so direct unit invocations and misconfigured mounts fail closed.
 */

import type { Response } from "express";
import type { AdminRequest } from "../middleware/adminAuth";
import { NEXT_PROMPT_SCHEMA_VERSION } from "../services/schemaMigrationCompatibility";
import {
  MIGRATION_FIXTURE_CATALOG,
  MIGRATION_FIXTURE_NAMES,
  SchemaMigrationMatrixError,
  buildSchemaMigrationCompatibilityMatrix,
  evaluateMigrationFixtureCell,
  isMigrationFixtureName,
  loadMigrationFixture,
  schemaMigrationMatrixRemedy,
  verifyMigrationFixtureSet,
  verifyRollbackEquivalence,
  type MigrationFixtureName,
} from "../services/migrationFixturesService";

function assertAdminAccess(
  req: AdminRequest,
  requiredScope: "schema:read" | "schema:write",
): string {
  const admin = req.admin;
  const actor = admin?.sub?.trim();
  if (!admin || !actor || admin.role !== "admin") {
    throw new SchemaMigrationMatrixError(
      "authorization_required",
      "An authenticated admin session is required for schema migration compatibility operations.",
    );
  }
  const scopes: readonly string[] = Array.isArray(admin.scope)
    ? admin.scope
    : Array.isArray((admin as unknown as { scopes?: string[] }).scopes)
      ? ((admin as unknown as { scopes: string[] }).scopes)
      : [];
  if (!scopes.includes(requiredScope)) {
    throw new SchemaMigrationMatrixError(
      "insufficient_scope",
      `Admin token lacks required scope "${requiredScope}".`,
    );
  }
  return actor;
}

function sendControllerError(res: Response, err: unknown): Response {
  if (err instanceof SchemaMigrationMatrixError) {
    const status =
      err.code === "authorization_required"
        ? 401
        : err.code === "insufficient_scope"
          ? 403
          : 400;
    return res.status(status).json({
      error: err.message,
      code: err.code,
      remedy: schemaMigrationMatrixRemedy(err.code),
    });
  }
  return res.status(500).json({
    error: "Failed to process schema migration compatibility request.",
  });
}

/**
 * GET /api/admin/schema-migrations/matrix
 * Query: ?toVersion=3&fixtures=v0_legacy,v1_legacy
 */
export const GetSchemaMigrationMatrix = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  try {
    const actor = assertAdminAccess(req, "schema:read");

    const rawToVersion = req.query?.toVersion;
    const targetVersion =
      rawToVersion === undefined || rawToVersion === ""
        ? NEXT_PROMPT_SCHEMA_VERSION
        : Number(rawToVersion);

    if (!Number.isInteger(targetVersion) || targetVersion < 1) {
      throw new SchemaMigrationMatrixError(
        "invalid_target_version",
        "Query parameter `toVersion` must be a positive integer.",
      );
    }

    let fixtures: MigrationFixtureName[] | undefined;
    const rawFixtures = req.query?.fixtures;
    if (typeof rawFixtures === "string" && rawFixtures.trim().length > 0) {
      const names = rawFixtures
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const name of names) {
        if (!isMigrationFixtureName(name)) {
          throw new SchemaMigrationMatrixError(
            "invalid_fixture_name",
            `Unknown migration fixture "${name}". Supported fixtures: ${MIGRATION_FIXTURE_NAMES.join(", ")}.`,
          );
        }
      }
      fixtures = names as MigrationFixtureName[];
    }

    const matrix = await buildSchemaMigrationCompatibilityMatrix({
      fixtures,
      targetVersion,
    });

    return res.status(200).json({
      evaluatedBy: actor,
      ...matrix,
    });
  } catch (err) {
    return sendControllerError(res, err);
  }
};

/**
 * GET /api/admin/schema-migrations/fixtures
 * Lists the catalog of checked-in migration fixtures or returns a single fixture with ?name=<fixture>.
 */
export const GetSchemaMigrationFixtures = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  try {
    assertAdminAccess(req, "schema:read");

    const requestedName = req.query?.name;
    if (typeof requestedName === "string" && requestedName.trim().length > 0) {
      const trimmed = requestedName.trim();
      if (!isMigrationFixtureName(trimmed)) {
        throw new SchemaMigrationMatrixError(
          "invalid_fixture_name",
          `Unknown migration fixture "${trimmed}". Supported fixtures: ${MIGRATION_FIXTURE_NAMES.join(", ")}.`,
        );
      }
      const records = await loadMigrationFixture(trimmed);
      return res.status(200).json({
        fixture: MIGRATION_FIXTURE_CATALOG[trimmed],
        records,
      });
    }

    const catalog = await Promise.all(
      MIGRATION_FIXTURE_NAMES.map(async (name) => {
        const records = await loadMigrationFixture(name);
        return {
          ...MIGRATION_FIXTURE_CATALOG[name],
          recordCount: records.length,
        };
      }),
    );

    return res.status(200).json({
      fixtures: catalog,
    });
  } catch (err) {
    return sendControllerError(res, err);
  }
};

/**
 * POST /api/admin/schema-migrations/evaluate
 * Body: { fixture?: MigrationFixtureName, records?: unknown[], toVersion?: number }
 */
export const EvaluateSchemaMigrationCompatibility = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  try {
    const actor = assertAdminAccess(req, "schema:write");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const targetVersion =
      body.toVersion === undefined
        ? NEXT_PROMPT_SCHEMA_VERSION
        : Number(body.toVersion);

    if (!Number.isInteger(targetVersion) || targetVersion < 1) {
      throw new SchemaMigrationMatrixError(
        "invalid_target_version",
        "`toVersion` must be a positive integer.",
      );
    }

    if (body.fixture !== undefined) {
      if (!isMigrationFixtureName(body.fixture)) {
        throw new SchemaMigrationMatrixError(
          "invalid_fixture_name",
          `Unknown migration fixture "${String(body.fixture)}". Supported fixtures: ${MIGRATION_FIXTURE_NAMES.join(", ")}.`,
        );
      }
      const cell = await evaluateMigrationFixtureCell(body.fixture, targetVersion);
      return res.status(200).json({
        evaluatedBy: actor,
        mode: "fixture",
        cell,
      });
    }

    if (!Array.isArray(body.records)) {
      throw new SchemaMigrationMatrixError(
        "invalid_records_payload",
        "Request body must provide either a valid `fixture` name or a `records` array.",
      );
    }

    const report = verifyMigrationFixtureSet(body.records, targetVersion);
    return res.status(200).json({
      evaluatedBy: actor,
      mode: "records",
      report,
    });
  } catch (err) {
    return sendControllerError(res, err);
  }
};

/**
 * POST /api/admin/schema-migrations/verify-rollback
 * Body: { originalRecords: Record<string, unknown>[], restoredRecords: Record<string, unknown>[] }
 */
export const VerifySchemaMigrationRollback = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  try {
    const actor = assertAdminAccess(req, "schema:write");
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (!Array.isArray(body.originalRecords) || !Array.isArray(body.restoredRecords)) {
      throw new SchemaMigrationMatrixError(
        "invalid_records_payload",
        "Both `originalRecords` and `restoredRecords` must be arrays.",
      );
    }

    const equivalent = verifyRollbackEquivalence(
      body.originalRecords as Record<string, unknown>[],
      body.restoredRecords as Record<string, unknown>[],
    );
    const originalReport = verifyMigrationFixtureSet(body.originalRecords);
    const restoredReport = verifyMigrationFixtureSet(body.restoredRecords);

    return res.status(200).json({
      evaluatedBy: actor,
      equivalent,
      fingerprintMatch: originalReport.fingerprint === restoredReport.fingerprint,
      originalFingerprint: originalReport.fingerprint,
      restoredFingerprint: restoredReport.fingerprint,
    });
  } catch (err) {
    return sendControllerError(res, err);
  }
};
