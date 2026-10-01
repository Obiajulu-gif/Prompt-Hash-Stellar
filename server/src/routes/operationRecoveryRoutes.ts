import express, { Request, Response } from "express";
import { requireAdminScope } from "../middleware/adminAuth";
import { requireIdempotency } from "../middleware/idempotency";
import {
  OperationRecoveryService,
  DEFAULT_STUCK_THRESHOLD_MINUTES,
} from "../services/operationRecoveryService";

export const operationRecoveryRouter = express.Router();

/**
 * GET /api/recovery/stuck
 * Diagnostic query for stuck pending operations exceeding a configured threshold.
 * Requires maintainer/admin scope.
 */
operationRecoveryRouter.get(
  "/stuck",
  requireAdminScope("support:read"),
  async (req: Request, res: Response) => {
    const thresholdMinutes = req.query.thresholdMinutes
      ? Number(req.query.thresholdMinutes)
      : DEFAULT_STUCK_THRESHOLD_MINUTES;

    try {
      const diagnostics = await OperationRecoveryService.getStuckOperationsDiagnostics(thresholdMinutes);
      return res.json({
        success: true,
        data: diagnostics,
      });
    } catch (err) {
      return res.status(500).json({
        error: (err as Error).message || "Failed to retrieve stuck operation diagnostics",
      });
    }
  }
);

/**
 * GET /api/recovery/:operationId
 * Retrieve recovery status and deterministic plan for an operation.
 */
operationRecoveryRouter.get("/:operationId", async (req: Request, res: Response) => {
  const { operationId } = req.params;

  if (!operationId) {
    return res.status(400).json({ error: "operationId is required" });
  }

  try {
    const plan = await OperationRecoveryService.evaluateRecovery(String(operationId));
    return res.json({
      success: true,
      data: plan,
    });
  } catch (err) {
    return res.status(404).json({
      error: (err as Error).message || "Operation not found",
    });
  }
});

/**
 * POST /api/recovery/:operationId/retry
 * User-initiated retry for a stuck or recoverable operation.
 */
operationRecoveryRouter.post("/:operationId/retry", requireIdempotency, async (req: Request, res: Response) => {
  const { operationId } = req.params;
  const userWallet =
    (req.headers["x-wallet-address"] as string) ||
    req.body?.userWallet ||
    req.body?.walletAddress;

  if (!userWallet) {
    return res.status(400).json({
      error: "User wallet address is required via x-wallet-address header or body",
    });
  }

  try {
    const checkpoint = await OperationRecoveryService.userRetry(String(operationId), userWallet);
    return res.json({
      success: true,
      message: `Operation retry scheduled for step: ${checkpoint.currentStep}`,
      checkpoint,
    });
  } catch (err) {
    const msg = (err as Error).message || "Failed to retry operation";
    const status = msg.includes("Unauthorized") ? 403 : 409;
    return res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/recovery/:operationId/resolve
 * Maintainer forced resolution or manual review action.
 * Requires maintainer/admin scope.
 */
operationRecoveryRouter.post(
  "/:operationId/resolve",
  requireAdminScope("support:write"),
  requireIdempotency,
  async (req: Request, res: Response) => {
    const { operationId } = req.params;
    const { action, reason } = req.body;

    if (!operationId) {
      return res.status(400).json({ error: "operationId is required" });
    }

    if (!action || !["RESOLVE", "FAIL", "RETRY", "MANUAL_REVIEW"].includes(action)) {
      return res.status(400).json({
        error: "Valid action required: RESOLVE | FAIL | RETRY | MANUAL_REVIEW",
      });
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({
        error: "A justification reason is required for maintainer recovery actions",
      });
    }

    const maintainerId = (req as any).adminToken?.sub || "maintainer";

    try {
      const checkpoint = await OperationRecoveryService.maintainerResolve(
        String(operationId),
        action,
        maintainerId,
        reason
      );

      return res.json({
        success: true,
        message: `Operation ${operationId} updated to state ${checkpoint.overallState}`,
        checkpoint,
      });
    } catch (err) {
      return res.status(500).json({
        error: (err as Error).message || "Failed to resolve operation",
      });
    }
  }
);
