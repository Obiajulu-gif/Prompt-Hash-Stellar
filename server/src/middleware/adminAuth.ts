/**
 * Admin authentication and authorization middleware (#542).
 *
 * Replaces the "any bearer token present == admin" placeholder that used
 * to guard integrity, report, and moderation endpoints. Every route that
 * needs privileged access should mount `requireAdminScope("<scope>")`
 * ahead of its handler — the handler itself no longer needs to know
 * anything about authentication.
 *
 * A request is admitted only if its `Authorization: Bearer <token>` token:
 *   - has a valid HMAC signature under a currently-active admin secret,
 *   - carries `role: "admin"`,
 *   - was issued for this environment's audience,
 *   - has not expired,
 *   - has not been revoked, and
 *   - carries the scope the route requires.
 *
 * Every allow/deny decision is recorded through the existing audit trail
 * so privileged access leaves tamper-evident evidence (#224/#542).
 */

import { Request, Response, NextFunction } from "express";
import {
  AdminTokenError,
  AdminTokenPayload,
  verifyAdminToken,
} from "../services/adminToken";
import { recordAuditEvent } from "../services/auditTrail";

export interface AdminRequest extends Request {
  admin?: AdminTokenPayload;
  requestId?: string | null;
}

function isConfiguredSecret(value: string | undefined): value is string {
  return Boolean(value) && value!.length >= 16;
}

function getActiveAdminSecrets(): string[] {
  return [process.env.ADMIN_TOKEN_SECRET, process.env.ADMIN_TOKEN_SECRET_PREVIOUS].filter(
    isConfiguredSecret,
  );
}

function getAdminAudience(): string {
  return process.env.ADMIN_TOKEN_AUDIENCE || "prompt-hash-admin";
}

function clientIpOf(req: Request): string {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown");
}

/**
 * Express middleware factory. `requiredScope` should be the narrowest
 * permission the route actually needs (e.g. `"integrity:read"` for a
 * read-only report, `"integrity:write"` for a mutating action) so a leaked
 * read-only token can't be used to trigger writes.
 */
export function requireAdminScope(requiredScope: string) {
  return async function adminAuthMiddleware(
    req: AdminRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const route = `${req.method} ${req.baseUrl}${req.path}`;
    const secrets = getActiveAdminSecrets();

    if (secrets.length === 0) {
      // Fail closed: an unconfigured secret must never fall back to "any
      // token accepted", which is exactly the bug this middleware exists
      // to fix.
      console.error("ADMIN_TOKEN_SECRET is not configured; denying admin request.");
      res.status(503).json({ error: "Admin authentication is not configured." });
      return;
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

    if (!token) {
      res.status(401).json({ error: "Unauthorized: admin bearer token required." });
      return;
    }

    try {
      const payload = verifyAdminToken(secrets, token, {
        audience: getAdminAudience(),
        requiredScope,
      });
      req.admin = payload;
      void recordAuditEvent({
        action: "admin_auth_success",
        result: "success",
        promptId: null,
        walletAddress: null,
        requestId: req.requestId ?? null,
        clientIp: clientIpOf(req),
        reason: `sub=${payload.sub} scope=${requiredScope} route=${route}`,
      });
      next();
    } catch (err) {
      const code = err instanceof AdminTokenError ? err.code : "unknown_error";
      void recordAuditEvent({
        action: "admin_auth_denied",
        result: "blocked",
        promptId: null,
        walletAddress: null,
        requestId: req.requestId ?? null,
        clientIp: clientIpOf(req),
        reason: `scope=${requiredScope} route=${route} error=${code}`,
      });
      res.status(401).json({ error: "Unauthorized: invalid or insufficient admin token." });
    }
  };
}
