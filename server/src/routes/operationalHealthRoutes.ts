import express from "express";
import { operationalHealthService } from "../services/operationalHealthService.js";
import { requireAdminScope } from "../middleware/adminAuth.js";

export const operationalHealthRouter = express.Router();

/**
 * GET /api/admin/operational-health
 * Returns consolidated maintainer report of unresolved exceptions, stale jobs,
 * reconciliation drift, and active incidents with sensitive data redacted.
 */
operationalHealthRouter.get(
  "/",
  requireAdminScope("health:read"),
  async (req, res) => {
    try {
      const report = await operationalHealthService.generateHealthReport();
      res.json({
        success: true,
        report,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to generate operational health report" });
    }
  }
);

/**
 * GET /api/admin/operational-health/summary
 * Lightweight status check for health probes & automated monitoring.
 */
operationalHealthRouter.get(
  "/summary",
  async (_req, res) => {
    try {
      const report = await operationalHealthService.generateHealthReport();
      res.json({
        status: report.status,
        timestamp: report.timestamp,
        summary: report.summary,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);
