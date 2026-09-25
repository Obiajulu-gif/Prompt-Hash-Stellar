import express, { Request, Response } from "express";
import connectDb from "../db/connectDb";
import { requireAdminScope } from "../middleware/adminAuth";
import {
  getEntitlementState,
  revokeEntitlement,
  repairEntitlementState,
} from "../services/entitlementService";

export const entitlementRouter = express.Router();

/**
 * GET /api/entitlements/check
 * Fast entitlement check for prompt unlocks.
 */
entitlementRouter.get("/check", async (req: Request, res: Response) => {
  try {
    await connectDb();
    const { userAddress, promptId } = req.query as { userAddress?: string; promptId?: string };

    if (!userAddress || !promptId) {
      return res.status(400).json({ error: "userAddress and promptId are required" });
    }

    const result = await getEntitlementState(userAddress, promptId);
    return res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error("Entitlement check error:", err);
    return res.status(500).json({ error: err.message || "Failed to check entitlement" });
  }
});

/**
 * POST /api/entitlements/revoke
 * Admin/Moderator action to revoke access to a prompt.
 */
entitlementRouter.post(
  "/revoke",
  requireAdminScope("entitlements:write"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const { userAddress, promptId, reason } = req.body as {
        userAddress?: string;
        promptId?: string;
        reason?: string;
      };

      if (!userAddress || !promptId) {
        return res.status(400).json({ error: "userAddress and promptId are required" });
      }

      const entitlement = await revokeEntitlement(
        userAddress,
        promptId,
        reason || "Moderator revocation",
        "revoked",
      );

      return res.json({
        success: true,
        message: `Entitlement revoked for user ${userAddress} on prompt ${promptId}`,
        entitlement,
      });
    } catch (err: any) {
      console.error("Entitlement revoke error:", err);
      return res.status(500).json({ error: err.message || "Failed to revoke entitlement" });
    }
  },
);

/**
 * POST /api/entitlements/repair
 * Idempotent consistency repair job.
 */
entitlementRouter.post(
  "/repair",
  requireAdminScope("entitlements:write"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const report = await repairEntitlementState();
      return res.json({
        success: true,
        report,
      });
    } catch (err: any) {
      console.error("Entitlement repair error:", err);
      return res.status(500).json({ error: err.message || "Failed to run entitlement repair job" });
    }
  },
);
