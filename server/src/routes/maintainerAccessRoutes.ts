import express, { Request, Response } from "express";
import connectDb from "../db/connectDb";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth";
import {
  MaintainerGrantError,
  buildMaintainerGrantReport,
  findMaintainerGrant,
  issueMaintainerGrant,
  listMaintainerGrants,
  revokeMaintainerGrant,
  summarizeMaintainerGrant,
} from "../services/maintainerAccessGrants";

/**
 * Maintainer access grants (#912). Mounted at /api/admin/maintainer-grants.
 *
 * The approver is always the authenticated admin token `sub`. A request body
 * cannot name a different approver, and self-approval is refused by the
 * service layer.
 */
export const maintainerAccessRouter = express.Router();

/**
 * POST /api/admin/maintainer-grants/grants
 * Approve a time-boxed grant for another maintainer. Requires `maintainer:grant`.
 */
maintainerAccessRouter.post(
  "/grants",
  requireAdminScope("maintainer:grant"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const admin = (req as AdminRequest).admin;
      const { grantee, scopes, reason, ttlMs } = req.body ?? {};

      if (!grantee || !Array.isArray(scopes) || !reason) {
        return res.status(400).json({ error: "grantee, scopes[], and reason are required." });
      }

      const result = await issueMaintainerGrant(
        {
          grantee,
          approver: admin?.sub ?? "",
          scopes,
          reason,
          ttlMs: typeof ttlMs === "number" ? ttlMs : undefined,
        },
        { requestId: req.correlationId ?? null },
      );

      return res.status(201).json({
        success: true,
        grant: {
          grantId: result.grantId,
          grantee: result.grantee,
          approver: result.approver,
          scopes: result.scopes,
          issuedAt: result.issuedAt.toISOString(),
          expiresAt: result.expiresAt.toISOString(),
        },
      });
    } catch (err) {
      if (err instanceof MaintainerGrantError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      console.error("Maintainer grant issuance error:", err);
      return res.status(500).json({ error: "Failed to issue maintainer grant." });
    }
  },
);

/**
 * GET /api/admin/maintainer-grants/grants?grantee=...
 * Report of active, expired, and revoked grants. Requires `maintainer:grant:read`.
 */
maintainerAccessRouter.get(
  "/grants",
  requireAdminScope("maintainer:grant:read"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const grantee = typeof req.query.grantee === "string" ? req.query.grantee : undefined;
      const grants = await listMaintainerGrants({ grantee });
      return res.json({ success: true, report: buildMaintainerGrantReport(grants) });
    } catch (err) {
      console.error("Maintainer grant listing error:", err);
      return res.status(500).json({ error: "Failed to list maintainer grants." });
    }
  },
);

/**
 * GET /api/admin/maintainer-grants/grants/:grantId
 * Inspect one grant. Requires `maintainer:grant:read`.
 */
maintainerAccessRouter.get(
  "/grants/:grantId",
  requireAdminScope("maintainer:grant:read"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const grant = await findMaintainerGrant(String(req.params.grantId));
      if (!grant) {
        return res.status(404).json({ error: "Maintainer grant not found." });
      }
      return res.json({ success: true, grant: summarizeMaintainerGrant(grant) });
    } catch (err) {
      console.error("Maintainer grant fetch error:", err);
      return res.status(500).json({ error: "Failed to fetch maintainer grant." });
    }
  },
);

/**
 * POST /api/admin/maintainer-grants/grants/:grantId/revoke
 * End a grant early (idempotent). Requires `maintainer:grant`.
 */
maintainerAccessRouter.post(
  "/grants/:grantId/revoke",
  requireAdminScope("maintainer:grant"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const admin = (req as AdminRequest).admin;
      const result = await revokeMaintainerGrant(String(req.params.grantId), {
        actor: admin?.sub ?? "",
        requestId: req.correlationId ?? null,
      });
      if (!result.revoked) {
        return res.status(404).json({ error: "Maintainer grant not found or already revoked." });
      }
      return res.json({ success: true, revoked: true, grantId: result.grantId });
    } catch (err) {
      console.error("Maintainer grant revoke error:", err);
      return res.status(500).json({ error: "Failed to revoke maintainer grant." });
    }
  },
);
