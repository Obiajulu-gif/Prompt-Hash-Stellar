import express, { Request, Response } from "express";
import { requireAdminScope } from "../middleware/adminAuth";
import {
  policyLimitService,
  ExpensiveOperation,
  POLICIES,
} from "../services/policyLimitService";

export const policyLimitRouter = express.Router();

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
 * Create a scoped override for an expensive operation.
 */
policyLimitRouter.post(
  "/overrides",
  requireAdminScope("ratelimit:write"),
  async (req: Request, res: Response) => {
    const { scopeType, scopeValue, operation, limit, durationSeconds, reason } = req.body;

    if (!scopeType || !scopeValue || !operation || limit === undefined || !durationSeconds || !reason) {
      return res.status(400).json({
        error: "Missing required fields: scopeType, scopeValue, operation, limit, durationSeconds, reason",
      });
    }

    if (!POLICIES[operation as ExpensiveOperation]) {
      return res.status(400).json({
        error: `Unknown expensive operation: ${operation}`,
      });
    }

    const grantedBy = (req as any).adminToken?.sub || "admin";

    try {
      const override = await policyLimitService.addOverride({
        scopeType,
        scopeValue,
        operation: operation as ExpensiveOperation,
        limit: Number(limit),
        durationSeconds: Number(durationSeconds),
        reason: String(reason),
        grantedBy,
      });

      return res.json({
        success: true,
        message: `Override created for ${scopeType}:${scopeValue} on ${operation}`,
        override,
      });
    } catch (err) {
      return res.status(500).json({
        error: (err as Error).message || "Failed to create policy override",
      });
    }
  }
);

/**
 * DELETE /api/admin/policy-limits/overrides/:overrideId
 * Revoke an active override.
 */
policyLimitRouter.delete(
  "/overrides/:overrideId",
  requireAdminScope("ratelimit:write"),
  async (req: Request, res: Response) => {
    const { overrideId } = req.params;
    const { reason } = req.body;
    const revokedBy = (req as any).adminToken?.sub || "admin";

    if (!overrideId) {
      return res.status(400).json({ error: "overrideId is required" });
    }

    const revoked = await policyLimitService.revokeOverride(
      String(overrideId),
      revokedBy,
      reason || "Manual revocation by admin"
    );

    if (!revoked) {
      return res.status(404).json({ error: "Override not found or already revoked" });
    }

    return res.json({
      success: true,
      message: `Override ${overrideId} revoked successfully`,
    });
  }
);
