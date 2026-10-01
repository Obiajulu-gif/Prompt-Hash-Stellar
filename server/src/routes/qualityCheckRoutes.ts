import express from "express";
import { qualityCheckService } from "../services/qualityCheckService.js";
import { requireAdminScope } from "../middleware/adminAuth.js";

export const qualityCheckRouter = express.Router();

// Run quality checks on a prompt
qualityCheckRouter.post(
  "/:promptId/check",
  async (req, res) => {
    try {
      const result = await qualityCheckService.runChecks(req.params.promptId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Get quality check result for a prompt
qualityCheckRouter.get(
  "/:promptId",
  async (req, res) => {
    try {
      const result = await qualityCheckService.getCheckResult(req.params.promptId);
      if (!result) {
        return res.status(404).json({ error: "No checks found for this prompt" });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Check if prompt can be published as paid
qualityCheckRouter.get(
  "/:promptId/can-publish-paid",
  async (req, res) => {
    try {
      const result = await qualityCheckService.canPublishPaid(req.params.promptId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Get quality check history
qualityCheckRouter.get(
  "/:promptId/history",
  async (req, res) => {
    try {
      const history = await qualityCheckService.getCheckHistory(req.params.promptId);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Override quality checks (admin only)
qualityCheckRouter.post(
  "/:promptId/override",
  requireAdminScope("quality:override"),
  async (req, res) => {
    try {
      const { overriddenBy, reason } = req.body;
      const result = await qualityCheckService.overrideChecks(
        req.params.promptId,
        overriddenBy,
        reason
      );
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Get quality rules documentation
qualityCheckRouter.get(
  "/rules/list",
  async (req, res) => {
    try {
      const rules = qualityCheckService.getQualityRules();
      res.json(rules);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);
