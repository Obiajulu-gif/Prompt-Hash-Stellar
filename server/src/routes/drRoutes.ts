import express from "express";
import { disasterRecoveryValidationService } from "../services/disasterRecoveryValidation.js";
import { requireAdminScope } from "../middleware/adminAuth.js";

export const drRouter = express.Router();

/**
 * GET /api/admin/dr/validate-invariants
 * Read-only scan of domain invariants post-restore or migration.
 */
drRouter.get(
  "/validate-invariants",
  requireAdminScope("dr:read"),
  async (_req, res) => {
    try {
      const report = await disasterRecoveryValidationService.validateAllInvariants();
      res.json({
        success: true,
        report,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Disaster recovery validation failed" });
    }
  }
);
