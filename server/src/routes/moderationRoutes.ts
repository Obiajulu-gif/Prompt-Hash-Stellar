/**
 * Moderation routes — bulk moderation queue (#moderation-queue).
 *
 * All routes require admin authentication via requireAdminScope.
 *
 *   GET  /api/moderation/queue                       – filtered prompt queue
 *   POST /api/moderation/bulk                        – bulk approve/reject/hide/restore
 *   GET  /api/moderation/decisions                   – decision audit list
 *   POST /api/moderation/decisions/:id/rollback      – rollback a decision
 */

import express from "express";
import {
  GetModerationQueue,
  BulkModerationAction,
  ListModerationDecisions,
  RollbackModerationDecision,
} from "../controllers/moderationControllers";
import { requireAdminScope } from "../middleware/adminAuth";

export const moderationRouter = express.Router();

// Queue — read access to the moderation queue
moderationRouter.get(
  "/queue",
  requireAdminScope("moderation:read"),
  GetModerationQueue,
);

// Bulk action — write access (approve/reject/hide/restore)
moderationRouter.post(
  "/bulk",
  requireAdminScope("moderation:write"),
  BulkModerationAction,
);

// Decision list — read access to audit records
moderationRouter.get(
  "/decisions",
  requireAdminScope("moderation:read"),
  ListModerationDecisions,
);

// Rollback — write access (reverses a previous decision)
moderationRouter.post(
  "/decisions/:id/rollback",
  requireAdminScope("moderation:write"),
  RollbackModerationDecision,
);
