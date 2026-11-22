import express, { type Response } from "express";
import {
  featureFlagService,
  KNOWN_FEATURE_FLAGS,
  snapshotFlag,
  type UpdateFlagInput,
} from "../services/featureFlagService.js";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth.js";
import {
  applyAuditedConfigChange,
  AuditEvidenceUnavailableError,
} from "../services/adminConfigAudit.js";
import {
  buildConfigDiffPreview,
  FEATURE_FLAG_UPDATE_SCHEMA,
  validateConfigInput,
} from "../services/adminConfigSchema.js";
import { evaluateRolloutGuard, verifyRollback, type RolloutScope } from "../services/flagRolloutGuard.js";

export const featureFlagRouter = express.Router();

// List known system flag definitions and safe defaults
featureFlagRouter.get("/definitions", (_req, res) => {
  res.json({
    flags: KNOWN_FEATURE_FLAGS,
  });
});

// Admin routes. Every mutation is applied through `applyAuditedConfigChange`
// so it leaves hash-chained audit evidence or is rolled back (#1026).

function auditContext(req: AdminRequest) {
  const idempotencyKey = req.headers["idempotency-key"];
  return {
    actor: req.admin?.sub ?? "unknown-admin",
    requestId: req.correlationId ?? req.requestId ?? null,
    clientIp: String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "") || null,
    changeId: typeof idempotencyKey === "string" && idempotencyKey ? idempotencyKey : null,
    reason: typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null,
  };
}

function sendChangeError(res: Response, err: any, fallbackStatus: number) {
  if (err instanceof AuditEvidenceUnavailableError) {
    res.setHeader("Retry-After", "30");
    return res.status(503).json({
      error: err.code,
      message: err.message,
      rolledBack: err.rolledBack,
    });
  }
  return res.status(fallbackStatus).json({ error: err.message });
}

featureFlagRouter.post(
  "/",
  requireAdminScope("flags:write"),
  async (req: AdminRequest, res: Response) => {
    const { name, description, status, environments, rolloutPercentage } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required." });
    }
    const ctx = auditContext(req);
    try {
      const result = await applyAuditedConfigChange({
        ...ctx,
        configType: "feature_flag",
        configKey: name.toLowerCase(),
        operation: "create",
        load: () => featureFlagService.getFlag(name),
        apply: () =>
          featureFlagService.createFlag({
            name,
            description,
            status,
            environments,
            rolloutPercentage,
            // The authenticated admin, never a client-supplied value.
            createdBy: ctx.actor,
          }),
        restore: (before) =>
          featureFlagService.restoreFlag(name, before ? snapshotFlag(before) : null),
        snapshot: snapshotFlag,
      });
      res.setHeader("X-Config-Change-Id", result.changeId);
      return res.json(result.value);
    } catch (err: any) {
      return sendChangeError(res, err, 400);
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
      const flag = await featureFlagService.getFlag(String(req.params.name));
      if (!flag) {
        return res.status(404).json({ error: "Flag not found" });
      }
      res.json(flag);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Dry run for a flag change (#909): validates the proposed patch against the
// update schema and returns the field-level diff plus a rollback patch. Nothing
// is written and no audit record is created.
featureFlagRouter.post(
  "/:name/preview",
  requireAdminScope("flags:write"),
  async (req: AdminRequest, res: Response) => {
    const name = String(req.params.name);
    const validation = validateConfigInput(FEATURE_FLAG_UPDATE_SCHEMA, req.body ?? {});
    if (!validation.ok) {
      return res.status(400).json({ valid: false, issues: validation.issues });
    }
    try {
      const flag = await featureFlagService.getFlag(name);
      if (!flag) {
        return res.status(404).json({ error: "Flag not found" });
      }
      const diff = buildConfigDiffPreview(snapshotFlag(flag), validation.value);
      return res.json({ valid: true, applied: false, name: name.toLowerCase(), diff });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

featureFlagRouter.patch(
  "/:name",
  requireAdminScope("flags:write"),
  async (req: AdminRequest, res: Response) => {
    const name = String(req.params.name);
    const { rolloutHealth, ...patch } = req.body ?? {};
    // Invalid configuration is rejected before anything is written (#909).
    const validation = validateConfigInput(FEATURE_FLAG_UPDATE_SCHEMA, patch);
    if (!validation.ok) {
      return res.status(400).json({
        error: "Invalid configuration.",
        issues: validation.issues,
      });
    }
    try {
      // Production rollout guard (#988): any ramp (non-disabled status with a
      // rollout percentage) must carry observed health and pass the guard
      // before the write is attempted. Missing health on a ramp is refused.
      if (validation.value.status !== "disabled" && typeof validation.value.rolloutPercentage === "number") {
        if (!rolloutHealth || typeof rolloutHealth !== "object") {
          return res.status(400).json({
            error: "rolloutHealth (errorRate, p1Incident, invariantViolations) is required to ramp a flag.",
          });
        }
        const scope: RolloutScope = name.includes("settlement") || name.includes("purchase_atomic")
          ? "settlement"
          : name.includes("payout") ? "payouts" : "global";
        const decision = evaluateRolloutGuard(
          { flag: name, scope, environment: "production", rolloutPercentage: validation.value.rolloutPercentage },
          rolloutHealth,
        );
        if (!decision.allow) return res.status(409).json({ error: "Rollout blocked.", ...decision });
      }
      const result = await applyAuditedConfigChange({
        ...auditContext(req),
        configType: "feature_flag",
        configKey: name.toLowerCase(),
        operation: "update",
        load: () => featureFlagService.getFlag(name),
        apply: () =>
          featureFlagService.updateFlag(name, validation.value as UpdateFlagInput),
        restore: (before) =>
          featureFlagService.restoreFlag(name, before ? snapshotFlag(before) : null),
        snapshot: snapshotFlag,
      });
      res.setHeader("X-Config-Change-Id", result.changeId);
      return res.json(result.value);
    } catch (err: any) {
      return sendChangeError(res, err, 400);
    }
  }
);

// Issue #1043: a one-call kill switch. Forces `disabled` globally and in every
// known environment in one request, then runs `verifyRollback`. Domain checks
// this route cannot observe itself (indexer/outbox/ledger drift) must be
// supplied explicitly as `true`; any omitted check is reported as a failure,
// so verification is never reported complete on absent evidence.
// Emergency disablement does not depend on rolloutHealth and remains usable
// when audit storage is down (evidence is best effort, see requireEvidence).
featureFlagRouter.post(
  "/:name/emergency-disable",
  requireAdminScope("flags:write"),
  async (req: AdminRequest, res: Response) => {
    const name = String(req.params.name);
    try {
      const { reason, noPartialWrites, invariantsPass, noLedgerDrift } = req.body ?? {};
      const result = await applyAuditedConfigChange({
        ...auditContext(req),
        configType: "feature_flag",
        configKey: name.toLowerCase(),
        operation: "emergency_disable",
        requireEvidence: false,
        load: () => featureFlagService.getFlag(name),
        apply: () =>
          featureFlagService.updateFlag(name, {
            status: "disabled",
            environments: { development: false, staging: false, production: false },
          }),
        restore: (before) =>
          featureFlagService.restoreFlag(name, before ? snapshotFlag(before) : null),
        snapshot: snapshotFlag,
      });
      const flag = result.value;

      const verification = verifyRollback({
        flagDisabledEverywhere: flag?.status === "disabled" &&
          ((["development", "staging", "production"] as const)).every((env) => flag.environments?.[env] === false),
        noPartialWrites: noPartialWrites === true,
        invariantsPass: invariantsPass === true,
        noLedgerDrift: noLedgerDrift === true,
      });

      res.setHeader("X-Config-Change-Id", result.changeId);
      return res.json({
        flag,
        reason: reason ?? null,
        verification,
        auditRecorded: result.auditRecorded,
      });
    } catch (err: any) {
      return sendChangeError(res, err, 400);
    }
  }
);

featureFlagRouter.delete(
  "/:name",
  requireAdminScope("flags:write"),
  async (req: AdminRequest, res: Response) => {
    const name = String(req.params.name);
    try {
      const result = await applyAuditedConfigChange({
        ...auditContext(req),
        configType: "feature_flag",
        configKey: name.toLowerCase(),
        operation: "delete",
        load: () => featureFlagService.getFlag(name),
        apply: async () => {
          await featureFlagService.deleteFlag(name);
          return null;
        },
        restore: (before) =>
          featureFlagService.restoreFlag(name, before ? snapshotFlag(before) : null),
        snapshot: snapshotFlag,
      });
      res.setHeader("X-Config-Change-Id", result.changeId);
      return res.json({ success: true });
    } catch (err: any) {
      return sendChangeError(res, err, 400);
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
