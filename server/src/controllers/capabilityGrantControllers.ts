/**
 * Capability grant HTTP controllers (#1171).
 *
 * Administrative endpoints only. Issuance and revocation take the approver
 * identity from the verified admin token (`req.admin.sub`) — never from the
 * request body — and every action is additionally gated by
 * `requireAdminScope` in the router. The raw capability token appears in the
 * issuance response exactly once and is never persisted or logged.
 */

import type { Response } from "express";
import type { AdminRequest } from "../middleware/adminAuth";
import {
  CAPABILITY_ACTIONS,
  CapabilityGrantError,
  issueCapabilityGrant,
  inspectCapabilityGrant,
  revokeCapabilityGrant,
  type CapabilityAction,
} from "../services/capabilityGrants";

function adminActor(req: AdminRequest): string | null {
  return req.admin?.sub?.trim() || null;
}

/**
 * POST /api/capabilities/grants
 * Body: { subject, action, resource, reason, ttlMs? }
 */
export const IssueCapabilityGrant = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  const approver = adminActor(req);
  if (!approver) {
    return res.status(403).json({
      error: "An authenticated approver is required to issue a capability grant.",
      code: "APPROVER_REQUIRED",
    });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const issued = issueCapabilityGrant(
      {
        subject: String(body.subject ?? ""),
        action: String(body.action ?? ""),
        resource: String(body.resource ?? ""),
        reason: String(body.reason ?? ""),
        approver,
        ttlMs: body.ttlMs === undefined ? undefined : Number(body.ttlMs),
      },
      { requestId: req.requestId ?? null },
    );

    return res.status(201).json({
      grantId: issued.grantId,
      token: issued.token,
      subject: issued.subject,
      action: issued.action,
      resource: issued.resource,
      approver: issued.approver,
      issuedAt: new Date(issued.issuedAt).toISOString(),
      expiresAt: new Date(issued.expiresAt).toISOString(),
      note: "The token is shown once. It authorizes this action and resource exactly once until it expires.",
    });
  } catch (err) {
    if (err instanceof CapabilityGrantError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({ error: "Failed to issue capability grant." });
  }
};

/**
 * GET /api/capabilities/grants/:grantId
 * Returns a token-free summary, including its active/used/revoked/expired state.
 */
export const GetCapabilityGrant = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  const grant = inspectCapabilityGrant(String(req.params.grantId ?? ""));
  if (!grant) {
    return res.status(404).json({ error: "Capability grant not found." });
  }
  return res.status(200).json({ grant });
};

/**
 * POST /api/capabilities/grants/:grantId/revoke
 * Idempotent: revoking an unknown or already-revoked grant returns 200 with
 * `revoked: false` and leaves the original revocation intact.
 */
export const RevokeCapabilityGrant = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  const actor = adminActor(req);
  if (!actor) {
    return res.status(403).json({
      error: "An authenticated actor is required to revoke a capability grant.",
      code: "ACTOR_REQUIRED",
    });
  }

  const result = revokeCapabilityGrant(String(req.params.grantId ?? ""), {
    actor,
    requestId: req.requestId ?? null,
  });
  return res.status(200).json(result);
};

/**
 * POST /api/capabilities/actions/:action/preview
 * Non-consuming check of the supported actions and their requirements. Useful
 * for clients that need to request the narrowest grant.
 */
export const DescribeCapabilityAction = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  const action = String(req.params.action ?? "") as CapabilityAction;
  if (!(CAPABILITY_ACTIONS as readonly string[]).includes(action)) {
    return res.status(404).json({ error: "Unknown capability action." });
  }
  return res.status(200).json({
    action,
    requires: ["subject", "resource", "reason"],
    tokenHeader: "X-Capability-Grant",
    singleUse: true,
  });
};
