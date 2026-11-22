/**
 * Maintainer access grant guard (#912).
 *
 * Mount after `requireAdminScope(...)` on any route that a maintainer should
 * reach only through a live grant:
 *
 *   router.post("/payouts/:id/release",
 *     requireAdminScope("payouts:write"),
 *     requireMaintainerGrant("payouts:write"),
 *     handler);
 *
 * Guarantees:
 *   - fails closed (503) when mounted without admin authentication;
 *   - the grant id arrives in `x-maintainer-grant-id` and must belong to the
 *     caller's admin `sub` (the grantee);
 *   - expiry, revocation, grantee, and scope are re-evaluated on every request;
 *   - the use is counted atomically, so an expiry that passes mid-request still
 *     denies;
 *   - every allow and deny is written to the audit trail before the handler runs.
 */

import { Request, Response, NextFunction } from "express";
import type { AdminRequest } from "./adminAuth";
import { recordAuditEvent } from "../services/auditTrail";
import {
  evaluateMaintainerGrant,
  findMaintainerGrant,
  markMaintainerGrantUsed,
  type MaintainerDenialCode,
} from "../services/maintainerAccessGrants";

export const MAINTAINER_GRANT_HEADER = "x-maintainer-grant-id";

export interface MaintainerGrantRequest extends AdminRequest {
  maintainerGrant?: {
    grantId: string;
    scopes: string[];
    expiresAt: Date;
  };
}

type DenyCode = MaintainerDenialCode | "missing_grant" | "storage_error" | "use_conflict" | "admin_context_required";

function clientIpOf(req: Request): string {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown");
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function deny(
  req: MaintainerGrantRequest,
  res: Response,
  reason: string,
  status: number,
  code: DenyCode,
): Promise<void> {
  await recordAuditEvent({
    action: "maintainer_grant_denied",
    result: "blocked",
    promptId: null,
    actor: req.admin?.sub ?? null,
    requestId: req.correlationId ?? null,
    clientIp: clientIpOf(req),
    reason,
  });
  res.status(status).json({ error: "Maintainer access denied.", code });
}

export interface MaintainerGrantGuardOptions {
  /** Clock override so the guard can be evaluated deterministically in tests. */
  now?: () => Date;
}

export function requireMaintainerGrant(
  requiredScope: string,
  options: MaintainerGrantGuardOptions = {},
) {
  return async function maintainerGrantMiddleware(
    req: MaintainerGrantRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const route = `${req.method} ${req.baseUrl}${req.path}`;
    const admin = req.admin;

    if (!admin?.sub) {
      // Fail closed: this guard is never a bypass when used without admin auth.
      await deny(req, res, `scope=${requiredScope} route=${route} error=no_admin_context`, 503, "admin_context_required");
      return;
    }

    const grantId = headerValue(req, MAINTAINER_GRANT_HEADER);
    if (!grantId) {
      await deny(req, res, `scope=${requiredScope} route=${route} error=missing_grant_header`, 400, "missing_grant");
      return;
    }

    let grant;
    try {
      grant = await findMaintainerGrant(grantId);
    } catch {
      await deny(req, res, `scope=${requiredScope} route=${route} grant=${grantId} error=storage_error`, 503, "storage_error");
      return;
    }

    const now = options.now ? options.now() : new Date();
    const decision = evaluateMaintainerGrant(grant, {
      grantee: admin.sub,
      scope: requiredScope,
      now,
    });
    if (!decision.ok) {
      await deny(
        req,
        res,
        `scope=${requiredScope} route=${route} grant=${grantId} error=${decision.code}`,
        decision.code === "not_found" ? 404 : 403,
        decision.code,
      );
      return;
    }

    let consumed;
    try {
      consumed = await markMaintainerGrantUsed(grantId, now);
    } catch {
      await deny(req, res, `scope=${requiredScope} route=${route} grant=${grantId} error=storage_error`, 503, "storage_error");
      return;
    }
    if (!consumed) {
      // Revoked or expired between evaluation and the atomic update.
      await deny(req, res, `scope=${requiredScope} route=${route} grant=${grantId} error=use_conflict`, 403, "use_conflict");
      return;
    }

    try {
      await recordAuditEvent(
        {
          action: "maintainer_grant_used",
          result: "success",
          promptId: null,
          actor: admin.sub,
          target: grantId,
          targetType: "maintainer_grant",
          requestId: req.correlationId ?? null,
          clientIp: clientIpOf(req),
          reason: `grantId=${grantId} actor=${admin.sub} scope=${requiredScope} route=${route} uses=${consumed.useCount}`,
        },
        { throwOnError: true },
      );
    } catch {
      // The use must be evidenced before the privileged handler runs.
      res.status(503).json({ error: "Maintainer access unavailable: audit evidence could not be recorded.", code: "storage_error" });
      return;
    }

    req.maintainerGrant = {
      grantId,
      scopes: consumed.scopes,
      expiresAt: consumed.expiresAt,
    };
    next();
  };
}
