/**
 * Express middleware enforcing one expiring capability grant (#1171).
 *
 * Contract:
 *   - The caller presents the raw token in `X-Capability-Grant` (or, for
 *     browser flows that cannot set headers, `body.capabilityGrantToken`).
 *   - The route declares the exact action it guards. The grant must name the
 *     same action and the same resource.
 *   - The subject is resolved by the caller. It must come from an
 *     authenticated source (wallet session, verified token). The default
 *     resolver reads `req.walletAddress`/`req.body.walletAddress` and is only
 *     a fallback for routes that already authenticate elsewhere.
 *
 * A successful check consumes the grant before the handler runs, so a handler
 * crash cannot leave a usable token behind for a retry. Denials are 401 when
 * no token was presented and 403 otherwise; every denial includes a stable
 * code and a remedy string.
 */

import type { NextFunction, Request, Response } from "express";
import {
  capabilityGrantRemedy,
  consumeCapabilityGrant,
  type CapabilityAction,
  type CapabilityGrantStore,
  type CapabilityGrantSummary,
  type CapabilityDenialCode,
  capabilityGrantStore,
} from "../services/capabilityGrants";

export interface CapabilityGrantRequest extends Request {
  walletAddress?: string;
  capabilityGrant?: CapabilityGrantSummary;
}

export interface RequireCapabilityGrantOptions {
  /** The single action this route performs. */
  action: CapabilityAction;
  /** Resolve the resource being acted on; a missing value is denied. */
  resource: (req: CapabilityGrantRequest) => string | undefined;
  /** Resolve the authenticated subject. */
  resolveSubject?: (req: CapabilityGrantRequest) => string | undefined;
  store?: CapabilityGrantStore;
  now?: () => number;
}

function tokenFromRequest(req: Request): string | undefined {
  const header = req.headers["x-capability-grant"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const body = req.body as { capabilityGrantToken?: unknown } | undefined;
  return typeof body?.capabilityGrantToken === "string" && body.capabilityGrantToken.trim()
    ? body.capabilityGrantToken.trim()
    : undefined;
}

function defaultSubject(req: CapabilityGrantRequest): string | undefined {
  return req.walletAddress ?? (req.body as { walletAddress?: unknown } | undefined)?.walletAddress?.toString();
}

function deny(
  res: Response,
  status: number,
  code: "CAPABILITY_TOKEN_REQUIRED" | CapabilityDenialCode,
  message: string,
): Response {
  const remedy =
    code === "CAPABILITY_TOKEN_REQUIRED"
      ? "Request a capability grant with POST /api/capabilities/grants and send it in X-Capability-Grant."
      : capabilityGrantRemedy(code);
  return res.status(status).json({ error: message, code, remedy });
}

export function requireCapabilityGrant(options: RequireCapabilityGrantOptions) {
  return function capabilityGrantMiddleware(
    req: CapabilityGrantRequest,
    res: Response,
    next: NextFunction,
  ): void {
    const token = tokenFromRequest(req);
    if (!token) {
      deny(res, 401, "CAPABILITY_TOKEN_REQUIRED", "A capability token is required for this action.");
      return;
    }

    const subject = options.resolveSubject
      ? options.resolveSubject(req)
      : defaultSubject(req);
    if (!subject || !subject.trim()) {
      deny(res, 403, "subject_mismatch", "No authenticated subject is available for this action.");
      return;
    }

    const resource = options.resource(req);
    if (!resource || !resource.trim()) {
      deny(res, 403, "resource_mismatch", "The target resource could not be determined.");
      return;
    }

    const decision = consumeCapabilityGrant(
      token,
      {
        subject,
        action: options.action,
        resource,
        now: options.now ? options.now() : Date.now(),
        requestId: (req as { requestId?: string | null }).requestId ?? null,
      },
      options.store ?? capabilityGrantStore,
    );

    if (!decision.ok) {
      deny(res, 403, decision.code, decision.message);
      return;
    }

    req.capabilityGrant = {
      grantId: decision.grant.grantId,
      subject: decision.grant.subject,
      action: decision.grant.action,
      resource: decision.grant.resource,
      approver: decision.grant.approver,
      reason: decision.grant.reason,
      issuedAt: new Date(decision.grant.issuedAt).toISOString(),
      expiresAt: new Date(decision.grant.expiresAt).toISOString(),
      usedAt: decision.grant.usedAt === null ? null : new Date(decision.grant.usedAt).toISOString(),
      revokedAt: null,
      revokedBy: null,
      status: "used",
    };
    res.locals.capabilityGrant = req.capabilityGrant;
    next();
  };
}
