import express, { Request, Response } from "express";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth";
import { rateLimit, isLegitimateWebhook } from "../middleware/rateLimiter";
import {
  evaluatePolicyDryRun,
  verifyPolicyPlanConfirmationToken,
  PolicyEvaluationError,
  type DryRunPolicyDefinition,
  type PolicyEvaluatorActor,
  type PolicyTargetResource,
} from "../services/dryRunPolicyEvaluator";

export const dryRunRouter = express.Router();

export const dryRunLimiter = rateLimit({
  actionName: "dry-run",
  windowMs: 60 * 1000,
  maxRequests: 30,
  skip: (req) => process.env.NODE_ENV === "test" || isLegitimateWebhook(req),
  message: "Too many dry-run preview or confirmation requests.",
});

dryRunRouter.use(dryRunLimiter);

const ALLOWED_TARGET_RESOURCES: readonly PolicyTargetResource[] = [
  "prompts",
  "purchases",
  "users",
  "reviews",
  "disputes",
];

function getDryRunSecret(): string {
  const secret =
    process.env.DRY_RUN_HMAC_SECRET ||
    process.env.ADMIN_TOKEN_SECRET ||
    process.env.ADMIN_JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "test") {
      return "test-dry-run-secret-at-least-32-chars-long";
    }
    throw new Error("Missing DRY_RUN_HMAC_SECRET or ADMIN_TOKEN_SECRET in environment");
  }
  return secret;
}

/**
 * POST /api/admin/dry-run/evaluate
 *
 * Safe, side-effect-free preview evaluation of destructive maintainer actions.
 * Analyzes candidate records, detects irreversible states, estimates financial
 * impact, and issues an HMAC confirmation token.
 *
 * Requires `policy:evaluate` or `admin` scope.
 */
dryRunRouter.post(
  "/evaluate",
  dryRunLimiter,
  requireAdminScope("policy:evaluate"),
  async (req: Request, res: Response) => {
    try {
      const admin = (req as AdminRequest).admin;
      const { policy, records, options } = req.body ?? {};

      if (!policy || typeof policy !== "object") {
        return res.status(400).json({
          error: "A valid policy object is required",
          code: "invalid_policy",
        });
      }

      if (!Array.isArray(records)) {
        return res.status(400).json({
          error: "records array is required",
          code: "invalid_records",
        });
      }

      const actor: PolicyEvaluatorActor = {
        id: admin?.sub ?? "anonymous-admin",
        role: admin?.role ?? "maintainer",
        permissions: new Set(admin?.scopes ?? ["policy:evaluate"]),
      };

      const normalizedOptions = options
        ? {
            maxRecords: options.maxRecords ?? options.maxEvaluatedRecords,
            maxPreview: options.maxPreview ?? options.maxPreviewRecords,
          }
        : undefined;

      const result = await evaluatePolicyDryRun(
        getDryRunSecret(),
        policy as DryRunPolicyDefinition,
        actor,
        records,
        normalizedOptions,
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      if (err instanceof PolicyEvaluationError) {
        const statusCode =
          err.code === "unauthorized"
            ? 403
            : err.code === "selection_too_large" ||
                err.code === "invalid_predicate"
              ? 400
              : 400;
        return res.status(statusCode).json({
          error: err.message,
          code: err.code,
        });
      }
      return res.status(500).json({
        error: (err as Error).message || "Failed to evaluate policy dry run",
      });
    }
  },
);

/**
 * POST /api/admin/dry-run/confirm
 *
 * Confirms and executes an evaluated plan using the issued confirmation token.
 * Validates that affected records and versions have not drifted.
 *
 * Requires `admin` or `policy:evaluate` scope.
 */
dryRunRouter.post(
  "/confirm",
  dryRunLimiter,
  requireAdminScope("policy:evaluate"),
  async (req: Request, res: Response) => {
    try {
      const admin = (req as AdminRequest).admin;
      const {
        confirmationToken,
        policyId,
        targetResource,
        affectedRecordSummaries,
        totalFinancialImpactXlm,
      } = req.body ?? {};

      if (
        typeof confirmationToken !== "string" ||
        !confirmationToken.trim() ||
        typeof policyId !== "string" ||
        !policyId.trim() ||
        typeof targetResource !== "string" ||
        !ALLOWED_TARGET_RESOURCES.includes(targetResource as PolicyTargetResource) ||
        !Array.isArray(affectedRecordSummaries)
      ) {
        return res.status(400).json({
          error:
            "Missing required confirmation parameters: confirmationToken, policyId, targetResource, affectedRecordSummaries",
          code: "missing_parameters",
        });
      }

      const isValidToken = verifyPolicyPlanConfirmationToken(
        getDryRunSecret(),
        String(confirmationToken),
        {
          policyId: String(policyId),
          targetResource: targetResource as PolicyTargetResource,
          actorId: admin?.sub ?? "anonymous-admin",
          affectedRecordSummaries,
          totalFinancialImpactXlm: Number(totalFinancialImpactXlm ?? 0),
        },
      );

      if (!isValidToken) {
        return res.status(409).json({
          error:
            "Confirmation token mismatch: records or policy have drifted since preview was generated",
          code: "confirmation_mismatch",
          remediation:
            "Re-run the dry-run preview to obtain a fresh confirmation token before retrying execution.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Destructive maintainer action successfully confirmed and executed",
        executedRecordsCount: affectedRecordSummaries.length,
        policyId,
        executedAt: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({
        error:
          (err as Error).message ||
          "Failed to confirm maintainer action execution",
      });
    }
  },
);
