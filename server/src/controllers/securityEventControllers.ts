/**
 * Security-event session invalidation HTTP controllers.
 *
 * Administrative endpoints for recording security events that invalidate
 * sessions, reinstating falsely revoked subjects, querying revocation status,
 * and retrieving the security audit trail. All endpoints require admin
 * authentication with the `security:revoke` or `security:read` scope.
 *
 * The controllers delegate to `invalidateSessionsForSecurityEvent` and
 * the `SessionRevocationRegistry` from `sessionRevocationService.ts`,
 * preserving the existing service contracts.
 */

import type { Response } from "express";
import type { AdminRequest } from "../middleware/adminAuth";
import {
  globalSessionRevocationRegistry,
  invalidateSessionsForSecurityEvent,
  SessionRevocationError,
  normalizeSubject,
  SECURITY_EVENT_POLICY,
  type SecurityEventType,
  type RevocationActor,
} from "../services/sessionRevocationService";

/** Build a RevocationActor from the authenticated admin request. */
function actorFromAdmin(req: AdminRequest): RevocationActor | null {
  const sub = req.admin?.sub?.trim();
  if (!sub) return null;
  return {
    id: sub,
    role: req.admin?.role,
    permissions: new Set(req.admin?.scope ?? []),
  };
}

/**
 * POST /api/admin/security-events/invalidate
 *
 * Body: { type, subject, reason, metadata? }
 *
 * Records a security event that invalidates sessions per the event policy.
 * Returns the full event record for operator reference.
 */
export const InvalidateSessions = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  const actor = actorFromAdmin(req);
  if (!actor) {
    return res.status(403).json({
      error: "An authenticated admin identity is required.",
      code: "ACTOR_REQUIRED",
    });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const type = String(body.type ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const reason = String(body.reason ?? "").trim();

  if (!type || !(type in SECURITY_EVENT_POLICY)) {
    return res.status(400).json({
      error: `Invalid event type. Valid types: ${Object.keys(SECURITY_EVENT_POLICY).join(", ")}`,
      code: "INVALID_EVENT_TYPE",
    });
  }
  if (!subject) {
    return res.status(400).json({
      error: "subject is required (a Stellar address, operator ID, or \"*\" for global).",
      code: "MISSING_SUBJECT",
    });
  }
  if (!reason) {
    return res.status(400).json({
      error: "reason is required for audit trail purposes.",
      code: "MISSING_REASON",
    });
  }

  try {
    const event = invalidateSessionsForSecurityEvent(
      globalSessionRevocationRegistry,
      {
        type: type as SecurityEventType,
        subject,
        reason,
        actor,
        metadata: body.metadata as Record<string, unknown> | undefined,
      },
    );

    return res.status(201).json({
      success: true,
      event: {
        eventId: event.eventId,
        type: event.type,
        targetSubject: event.targetSubject,
        revokedBefore: event.revokedBefore,
        createdAt: event.createdAt,
        actorId: event.actorId,
      },
    });
  } catch (err) {
    if (err instanceof SessionRevocationError) {
      const statusMap: Record<string, number> = {
        unauthorized: 403,
        invalid_subject: 400,
        invalid_timestamp: 400,
      };
      return res.status(statusMap[err.code] ?? 400).json({
        error: err.message,
        code: err.code,
      });
    }
    return res.status(500).json({
      error: "Internal error recording security event.",
    });
  }
};

/**
 * POST /api/admin/security-events/reinstate
 *
 * Body: { subject, reason }
 *
 * Reinstates a subject whose sessions were revoked in error (false alarm
 * recovery). Removes the subject's cutoff so valid sessions work again.
 */
export const ReinstateSubject = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  const actor = actorFromAdmin(req);
  if (!actor) {
    return res.status(403).json({
      error: "An authenticated admin identity is required.",
      code: "ACTOR_REQUIRED",
    });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const subject = String(body.subject ?? "").trim();
  const reason = String(body.reason ?? "").trim();

  if (!subject) {
    return res.status(400).json({
      error: "subject is required.",
      code: "MISSING_SUBJECT",
    });
  }
  if (!reason) {
    return res.status(400).json({
      error: "reason is required for audit trail purposes.",
      code: "MISSING_REASON",
    });
  }

  try {
    const reinstated = globalSessionRevocationRegistry.reinstateSubject(
      subject,
      actor,
      reason,
    );

    if (!reinstated) {
      return res.status(404).json({
        error: "No active revocation found for this subject.",
        code: "NOT_FOUND",
      });
    }

    return res.json({
      success: true,
      subject: normalizeSubject(subject),
      reinstated: true,
    });
  } catch (err) {
    if (err instanceof SessionRevocationError) {
      return res.status(err.code === "unauthorized" ? 403 : 400).json({
        error: err.message,
        code: err.code,
      });
    }
    return res.status(500).json({
      error: "Internal error reinstating subject.",
    });
  }
};

/**
 * GET /api/admin/security-events/status/:subject
 *
 * Returns the current revocation status for a subject. Operators can inspect
 * whether a wallet or admin identity is currently blocked and why.
 */
export const GetRevocationStatus = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  const rawSubject = req.params.subject?.trim();
  if (!rawSubject) {
    return res.status(400).json({
      error: "subject parameter is required.",
      code: "MISSING_SUBJECT",
    });
  }

  // Check revocation at current time for a hypothetical old token (issuedAt = 0)
  // to see if there's any active cutoff for this subject.
  const status = globalSessionRevocationRegistry.isRevoked(
    rawSubject,
    0, // check if any cutoff exists
  );

  return res.json({
    subject: normalizeSubject(rawSubject),
    ...status,
  });
};

/**
 * GET /api/admin/security-events/audit
 *
 * Returns the security event audit trail. Supports optional query parameters:
 *   - `type`: filter by event type
 *   - `subject`: filter by target subject
 *   - `limit`: max records (default 100)
 */
export const GetSecurityAuditTrail = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  const trail = globalSessionRevocationRegistry.getAuditTrail();

  const typeFilter = req.query.type as string | undefined;
  const subjectFilter = req.query.subject as string | undefined;
  const limit = Math.min(
    Math.max(1, Number(req.query.limit) || 100),
    1000,
  );

  let filtered = [...trail];

  if (typeFilter) {
    filtered = filtered.filter((e) => e.type === typeFilter);
  }
  if (subjectFilter) {
    const norm = normalizeSubject(subjectFilter);
    filtered = filtered.filter((e) => e.targetSubject === norm);
  }

  // Most recent first, bounded by limit
  const result = filtered.reverse().slice(0, limit);

  return res.json({
    total: filtered.length,
    limit,
    events: result.map((e) => ({
      eventId: e.eventId,
      type: e.type,
      targetSubject: e.targetSubject,
      reason: e.reason,
      revokedBefore: e.revokedBefore,
      createdAt: e.createdAt,
      actorId: e.actorId,
    })),
  });
};
