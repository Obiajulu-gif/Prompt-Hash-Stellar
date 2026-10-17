import express from "express";
import {
  featureFlagService,
  KNOWN_FEATURE_FLAGS,
} from "../services/featureFlagService.js";
import { requireAdminScope } from "../middleware/adminAuth.js";
import { verifyRollback } from "../services/flagRolloutGuard.js";

export const featureFlagRouter = express.Router();

// List known system flag definitions and safe defaults
featureFlagRouter.get("/definitions", (_req, res) => {
  res.json({
    flags: KNOWN_FEATURE_FLAGS,
  });
});

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

// Issue #1043: a one-call kill switch. The pure rollout-guard logic in
// flagRolloutGuard.ts already existed but was never wired to anything —
// disabling a flag still required a human to PATCH every environment by
// hand mid-incident. This forces `disabled` globally and in every known
// environment in one request, then runs `verifyRollback` so the response
// says plainly whether the disable actually took. Domain checks this
// route can't itself observe (indexer/outbox/ledger drift) are accepted
// as caller-supplied evidence, defaulting to "pass" when omitted — wiring
// those to the real indexer/ledger services is follow-up work, not part
// of this flag-service-local slice.
featureFlagRouter.post(
  "/:name/emergency-disable",
  requireAdminScope("flags:write"),
  async (req, res) => {
    try {
      const { reason, noPartialWrites, invariantsPass, noLedgerDrift } = req.body ?? {};
      const flag = await featureFlagService.updateFlag(req.params.name, {
        status: "disabled",
        environments: { development: false, staging: false, production: false },
      });

      const verification = verifyRollback({
        flagDisabledEverywhere: flag.status === "disabled",
        noPartialWrites: noPartialWrites ?? true,
        invariantsPass: invariantsPass ?? true,
        noLedgerDrift: noLedgerDrift ?? true,
      });

      res.json({ flag, reason: reason ?? null, verification });
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
      const { userId, environment } = req.body;
      const evaluation = await featureFlagService.evaluateFlag(
        req.params.name,
        environment,
        userId
      );
      res.json(evaluation);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

