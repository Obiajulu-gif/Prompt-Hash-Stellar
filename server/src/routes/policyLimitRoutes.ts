import express, { Request, Response } from "express";
import { requireAdminScope } from "../middleware/adminAuth";
import {
  policyLimitService,
  ExpensiveOperation,
  POLICIES,
  OverrideScopeType,
  PolicyOverrideChange,
  PolicyOverrideDiffReport,
  snapshotPolicyOverride,
} from "../services/policyLimitService";
import { assertReviewedDiff, PermissionDiffError } from "../services/permissionDiff";
import {
  applyAuditedConfigChange,
  AuditEvidenceUnavailableError,
} from "../services/adminConfigAudit";

export const policyLimitRouter = express.Router();

const SCOPE_TYPES: readonly OverrideScopeType[] = ["wallet", "apiKey", "ip", "global"];

type CreateChange = Extract<PolicyOverrideChange, { action: "create" }>;

/** Validates a create request into the change shape shared by diff and apply. */
function parseCreateChange(
  body: Record<string, unknown> | undefined,
): { change: CreateChange } | { error: string } {
  const { scopeType, scopeValue, operation, limit, durationSeconds, reason } = body ?? {};
  if (!scopeType || !scopeValue || !operation || limit === undefined || !durationSeconds || !reason) {
    return {
      error: "Missing required fields: scopeType, scopeValue, operation, limit, durationSeconds, reason",
    };
  }
  if (!POLICIES[operation as ExpensiveOperation]) {
    return { error: `Unknown expensive operation: ${operation}` };
  }
  if (!SCOPE_TYPES.includes(scopeType as OverrideScopeType)) {
    return { error: `scopeType must be one of: ${SCOPE_TYPES.join(", ")}` };
  }
  // resolveLimit only consults `global:*`, so any other global value would never apply.
  if (scopeType === "global" && scopeValue !== "*") {
    return { error: 'Global overrides must use scopeValue "*".' };
  }
  const numericLimit = Number(limit);
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(numericLimit) || numericLimit < 0 || !Number.isFinite(seconds) || seconds <= 0) {
    return { error: "limit must be a non-negative number and durationSeconds a positive number." };
  }
  return {
    change: {
      action: "create",
      scopeType: scopeType as OverrideScopeType,
      scopeValue: String(scopeValue),
      operation: operation as ExpensiveOperation,
      limit: numericLimit,
      durationSeconds: seconds,
    },
  };
}

/**
 * Enforces that the caller reviewed the current diff (#1036). Must run in the
 * same synchronous turn as the mutation so no other change can interleave.
 */
function rejectUnreviewed(
  res: Response,
  diffDigest: unknown,
  report: PolicyOverrideDiffReport,
): boolean {
  try {
    assertReviewedDiff(diffDigest, report.digest);
    return false;
  } catch (err) {
    const { code, message } = err as PermissionDiffError;
    res.status(code === "diff_required" ? 428 : 409).json({ error: message, code, report });
    return true;
  }
}

/**
 * POST /api/admin/policy-limits/overrides/diff
 * Permission-diff report for a create (`action: "create"`, same fields as
 * POST /overrides) or revoke (`action: "revoke"`, `overrideId`) without
 * applying it. Pass the returned `digest` as `diffDigest` to apply.
 */
policyLimitRouter.post(
  "/overrides/diff",
  requireAdminScope("ratelimit:read"),
  (req: Request, res: Response) => {
    if (req.body?.action === "revoke") {
      const report = policyLimitService.previewOverrideChange({
        action: "revoke",
        overrideId: String(req.body.overrideId ?? ""),
      });
      if (!report) {
        return res.status(404).json({ error: "Override not found or already revoked" });
      }
      return res.json({ success: true, report });
    }
    if (req.body?.action !== "create") {
      return res.status(400).json({ error: 'action must be "create" or "revoke"' });
    }
    const parsed = parseCreateChange(req.body);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    return res.json({ success: true, report: policyLimitService.previewOverrideChange(parsed.change) });
  }
);

/**
 * GET /api/admin/policy-limits
 * List all operation policies and active overrides.
 */
policyLimitRouter.get(
  "/",
  requireAdminScope("ratelimit:read"),
  (_req: Request, res: Response) => {
    const data = policyLimitService.getStatus();
    return res.json({
      success: true,
      data,
    });
  }
);

/**
 * POST /api/admin/policy-limits/overrides
 * Create a scoped override for an expensive operation. Requires the
 * `diffDigest` of a report from POST /overrides/diff (#1036).
 */
policyLimitRouter.post(
  "/overrides",
  requireAdminScope("ratelimit:write"),
  async (req: Request, res: Response) => {
    const parsed = parseCreateChange(req.body);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const { change } = parsed;
    const report = policyLimitService.previewOverrideChange(change)!;
    if (rejectUnreviewed(res, req.body.diffDigest, report)) return;

    const grantedBy = (req as any).adminToken?.sub || (req as any).admin?.sub || "admin";
    const idempotencyKey = req.headers["idempotency-key"];
    const changeId = typeof idempotencyKey === "string" && idempotencyKey ? idempotencyKey : null;
    const clientIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "") || null;
    const mapKey = `${change.scopeType}:${change.scopeType === "wallet" ? change.scopeValue.toLowerCase() : change.scopeValue}:${change.operation}`;

    try {
      const result = await applyAuditedConfigChange({
        actor: grantedBy,
        configType: "policy_limit",
        configKey: mapKey,
        operation: "create",
        reason: String(req.body.reason || ""),
        changeId,
        clientIp,
        requestId: (req as any).correlationId ?? (req as any).requestId ?? null,
        load: async () => policyLimitService.getOverrideByKey(mapKey) ?? null,
        apply: async () => {
          return await policyLimitService.addOverride({
            scopeType: change.scopeType,
            scopeValue: change.scopeValue,
            operation: change.operation,
            limit: change.limit,
            durationSeconds: change.durationSeconds,
            reason: String(req.body.reason),
            grantedBy,
          });
        },
        restore: async (before) => {
          policyLimitService.setOverrideDirect(mapKey, before);
        },
        snapshot: (item) => snapshotPolicyOverride(item),
      });

      res.setHeader("X-Config-Change-Id", result.changeId);
      return res.json({
        success: true,
        message: `Override created for ${change.scopeType}:${change.scopeValue} on ${change.operation}`,
        override: result.value,
      });
    } catch (err: any) {
      if (err instanceof AuditEvidenceUnavailableError) {
        res.setHeader("Retry-After", "30");
        return res.status(503).json({
          error: err.code,
          message: err.message,
          rolledBack: err.rolledBack,
        });
      }
      return res.status(500).json({
        error: (err as Error).message || "Failed to create policy override",
      });
    }
  }
);

/**
 * DELETE /api/admin/policy-limits/overrides/:overrideId
 * Revoke an active override. Requires the `diffDigest` of a revoke report
 * from POST /overrides/diff (#1036).
 */
policyLimitRouter.delete(
  "/overrides/:overrideId",
  requireAdminScope("ratelimit:write"),
  async (req: Request, res: Response) => {
    const { overrideId } = req.params;
    const { reason, diffDigest } = req.body ?? {};
    const revokedBy = (req as any).adminToken?.sub || (req as any).admin?.sub || "admin";

    if (!overrideId) {
      return res.status(400).json({ error: "overrideId is required" });
    }

    const report = policyLimitService.previewOverrideChange({
      action: "revoke",
      overrideId: String(overrideId),
    });
    if (!report) {
      return res.status(404).json({ error: "Override not found or already revoked" });
    }
    if (rejectUnreviewed(res, diffDigest, report)) return;

    const entry = policyLimitService.getOverrideById(String(overrideId));
    if (!entry || entry.override.revokedAt) {
      return res.status(404).json({ error: "Override not found or already revoked" });
    }
    const { key: mapKey, override: beforeOverride } = entry;
    const idempotencyKey = req.headers["idempotency-key"];
    const changeId = typeof idempotencyKey === "string" && idempotencyKey ? idempotencyKey : null;
    const clientIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "") || null;

    try {
      const result = await applyAuditedConfigChange({
        actor: revokedBy,
        configType: "policy_limit",
        configKey: mapKey,
        operation: "revoke",
        reason: reason || "Manual revocation by admin",
        changeId,
        clientIp,
        requestId: (req as any).correlationId ?? (req as any).requestId ?? null,
        load: async () => policyLimitService.getOverrideByKey(mapKey) ?? null,
        apply: async () => {
          const success = await policyLimitService.revokeOverride(
            String(overrideId),
            revokedBy,
            reason || "Manual revocation by admin",
          );
          if (!success) return null;
          return { ...beforeOverride, revokedAt: Date.now() };
        },
        restore: async (before) => {
          policyLimitService.setOverrideDirect(mapKey, before);
        },
        snapshot: (item) => snapshotPolicyOverride(item),
      });

      res.setHeader("X-Config-Change-Id", result.changeId);
      return res.json({
        success: true,
        message: `Override ${overrideId} revoked successfully`,
      });
    } catch (err: any) {
      if (err instanceof AuditEvidenceUnavailableError) {
        res.setHeader("Retry-After", "30");
        return res.status(503).json({
          error: err.code,
          message: err.message,
          rolledBack: err.rolledBack,
        });
      }
      return res.status(500).json({
        error: (err as Error).message || "Failed to revoke policy override",
      });
    }
  }
);
