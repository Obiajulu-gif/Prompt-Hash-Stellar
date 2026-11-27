/**
 * Admin routes for the Schema Migration Compatibility Matrix & Fixtures.
 *
 * GET  /api/admin/schema-migrations/matrix           schema:read
 * GET  /api/admin/schema-migrations/fixtures         schema:read
 * POST /api/admin/schema-migrations/evaluate         schema:write
 * POST /api/admin/schema-migrations/verify-rollback  schema:write
 */

import express from "express";
import {
  EvaluateSchemaMigrationCompatibility,
  GetSchemaMigrationFixtures,
  GetSchemaMigrationMatrix,
  VerifySchemaMigrationRollback,
} from "../controllers/schemaMigrationControllers";
import { requireAdminScope } from "../middleware/adminAuth";

export const schemaMigrationRouter = express.Router();

schemaMigrationRouter.get(
  "/matrix",
  requireAdminScope("schema:read"),
  GetSchemaMigrationMatrix,
);

schemaMigrationRouter.get(
  "/fixtures",
  requireAdminScope("schema:read"),
  GetSchemaMigrationFixtures,
);

schemaMigrationRouter.post(
  "/evaluate",
  requireAdminScope("schema:write"),
  EvaluateSchemaMigrationCompatibility,
);

schemaMigrationRouter.post(
  "/verify-rollback",
  requireAdminScope("schema:write"),
  VerifySchemaMigrationRollback,
);
