import express from "express";
import { featureFlagService } from "../services/featureFlagService.js";
import { requireAdminScope } from "../middleware/adminAuth.js";

export const featureFlagRouter = express.Router();

// Admin routes
featureFlagRouter.post(
  "/",
  requireAdminScope("flags:write"),
  async (req, res) => {
    try {
      const { name, description, status, environments, rolloutPercentage, createdBy } = req.body;
      const flag = await featureFlagService.createFlag({
        name,
        description,
        status,
        environments,
        rolloutPercentage,
        createdBy,
      });
      res.json(flag);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

featureFlagRouter.get(
  "/",
  requireAdminScope("flags:read"),
  async (req, res) => {
    try {
      const flags = await featureFlagService.getAllFlags();
      res.json(flags);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

featureFlagRouter.get(
  "/:name",
  requireAdminScope("flags:read"),
  async (req, res) => {
    try {
      const flag = await featureFlagService.getFlag(req.params.name);
      if (!flag) {
        return res.status(404).json({ error: "Flag not found" });
      }
      res.json(flag);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

featureFlagRouter.patch(
  "/:name",
  requireAdminScope("flags:write"),
  async (req, res) => {
    try {
      const { status, environments, rolloutPercentage } = req.body;
      const flag = await featureFlagService.updateFlag(req.params.name, {
        status,
        environments,
        rolloutPercentage,
      });
      res.json(flag);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

featureFlagRouter.delete(
  "/:name",
  requireAdminScope("flags:write"),
  async (req, res) => {
    try {
      await featureFlagService.deleteFlag(req.params.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Public route to check if a feature is enabled (for client-side)
featureFlagRouter.post(
  "/check/:name",
  async (req, res) => {
    try {
      const { userId } = req.body;
      const isEnabled = await featureFlagService.isEnabled(req.params.name, undefined, userId);
      res.json({ enabled: isEnabled });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);
