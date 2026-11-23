import express, { Request, Response } from "express";
import connectDb from "../db/connectDb";
import { requireAdminScope } from "../middleware/adminAuth";
import { requireSupportAccess } from "../middleware/supportAccess";
import {
  SupportAccessError,
  findSupportAccessGrant,
  issueSupportGrant,
  listSupportAccessGrants,
  revokeSupportGrant,
  summarizeSupportGrant,
} from "../services/supportAccess";
import { queryAuditEvents } from "../services/auditTrail";
import { Entitlement } from "../models/Entitlement";

export const supportAccessRouter = express.Router();

/**
 * POST /api/admin/support-access/grants
 * Open a time-bounded, scoped support session for a user wallet.
 * Requires admin token scope: `support:grant`.
 */
supportAccessRouter.post(
  "/grants",
  requireAdminScope("support:grant"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const admin = (req as Request & { admin?: { sub: string } }).admin;
      const { targetWallet, scopes, reason, ttlMs, maxUses } = req.body ?? {};

      if (!targetWallet || !Array.isArray(scopes) || !reason) {
        return res.status(400).json({
          error: "targetWallet, scopes[], and reason are required.",
        });
      }

      const result = await issueSupportGrant(
        {
          actor: admin?.sub ?? "",
          targetWallet,
          scopes,
          reason,
          ttlMs: typeof ttlMs === "number" ? ttlMs : undefined,
          maxUses: typeof maxUses === "number" ? maxUses : undefined,
        },
        { requestId: req.correlationId ?? null },
      );

      return res.status(201).json({
        success: true,
        grant: {
          grantId: result.grantId,
          targetWallet: result.targetWallet,
          scopes: result.scopes,
          issuedAt: result.issuedAt.toISOString(),
          expiresAt: result.expiresAt.toISOString(),
          maxUses: result.maxUses,
          noticeDelivered: Boolean(result.noticeNotificationId),
        },
      });
    } catch (err) {
      if (err instanceof SupportAccessError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      console.error("Support grant issuance error:", err);
      return res.status(500).json({ error: "Failed to issue support grant." });
    }
  },
);

/**
 * GET /api/admin/support-access/grants
 * List support sessions (optionally filtered). Requires `support:read`.
 */
supportAccessRouter.get(
  "/grants",
  requireAdminScope("support:read"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const { actor, targetWallet, active } = req.query as Record<
        string,
        string | undefined
      >;
      const grants = await listSupportAccessGrants({
        actor,
        targetWallet,
        activeOnly: active === "true",
      });
      return res.json({ success: true, grants });
    } catch (err) {
      console.error("Support grant listing error:", err);
      return res.status(500).json({ error: "Failed to list support grants." });
    }
  },
);

/**
 * GET /api/admin/support-access/grants/:grantId
 * Inspect a single session. Requires `support:read`.
 */
supportAccessRouter.get(
  "/grants/:grantId",
  requireAdminScope("support:read"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const grant = await findSupportAccessGrant(String(req.params.grantId));
      if (!grant) {
        return res.status(404).json({ error: "Support grant not found." });
      }
      return res.json({ success: true, grant: summarizeSupportGrant(grant) });
    } catch (err) {
      console.error("Support grant fetch error:", err);
      return res.status(500).json({ error: "Failed to fetch support grant." });
    }
  },
);

/**
 * POST /api/admin/support-access/grants/:grantId/revoke
 * End a session early (idempotent). Requires `support:grant`.
 */
supportAccessRouter.post(
  "/grants/:grantId/revoke",
  requireAdminScope("support:grant"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const admin = (req as Request & { admin?: { sub: string } }).admin;
      const result = await revokeSupportGrant(String(req.params.grantId), {
        actor: admin?.sub ?? "",
        requestId: req.correlationId ?? null,
      });
      if (!result.revoked) {
        return res.status(404).json({
          error: "Support grant not found or already revoked.",
        });
      }
      return res.json({
        success: true,
        revoked: true,
        grantId: result.grantId,
      });
    } catch (err) {
      console.error("Support grant revoke error:", err);
      return res.status(500).json({ error: "Failed to revoke support grant." });
    }
  },
);

/**
 * GET /api/admin/support-access/sessions/:targetWallet/entitlements
 * Read-only view of a user's entitlement states during a support session.
 * Returns only marketplace entitlement fields — never prompt content or keys.
 * Requires admin scope `support:use` PLUS a live grant carrying
 * `support:entitlements:read`. Every call consumes one use and is audited.
 */
supportAccessRouter.get(
  "/sessions/:targetWallet/entitlements",
  requireAdminScope("support:use"),
  requireSupportAccess("support:entitlements:read"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const session = (
        req as Request & {
          supportAccess?: { grantId: string; targetWallet: string };
        }
      ).supportAccess!;
      const entitlements = await Entitlement.find({
        userAddress: session.targetWallet,
      })
        .select("promptId status grantedAt revokedAt")
        .limit(100)
        .lean();

      return res.json({
        success: true,
        grantId: session.grantId,
        entitlements,
      });
    } catch (err) {
      console.error("Support session entitlement read error:", err);
      return res.status(500).json({ error: "Failed to read entitlements." });
    }
  },
);

/**
 * GET /api/admin/support-access/audit?walletAddress=G...
 * Query the tamper-evident audit trail for a wallet (hashed at rest).
 * Requires `support:audit`.
 */
supportAccessRouter.get(
  "/audit",
  requireAdminScope("support:audit"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const { walletAddress, promptId, limit } = req.query as Record<
        string,
        string | undefined
      >;
      const events = await queryAuditEvents({
        walletAddress,
        promptId,
        limit: limit ? Math.min(Number(limit) || 100, 500) : 100,
      });
      return res.json({ success: true, events });
    } catch (err) {
      console.error("Support audit query error:", err);
      return res.status(500).json({ error: "Failed to query audit trail." });
    }
  },
);
