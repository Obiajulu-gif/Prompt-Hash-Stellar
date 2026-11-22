/**
 * Security-event session invalidation routes.
 *
 * Admin-scoped endpoints for recording security events, reinstating
 * subjects, querying revocation status, and viewing the audit trail.
 *
 * All mutation endpoints require `security:revoke` scope.
 * Read endpoints require `security:read` scope.
 */

import express from "express";
import { requireAdminScope } from "../middleware/adminAuth";
import {
  GetRevocationStatus,
  GetSecurityAuditTrail,
  InvalidateSessions,
  ReinstateSubject,
} from "../controllers/securityEventControllers";

export const securityEventRouter = express.Router();

/** POST /api/admin/security-events/invalidate — record a security event and invalidate sessions. */
securityEventRouter.post(
  "/invalidate",
  requireAdminScope("security:revoke"),
  InvalidateSessions,
);

/** POST /api/admin/security-events/reinstate — recover from a false-alarm revocation. */
securityEventRouter.post(
  "/reinstate",
  requireAdminScope("security:revoke"),
  ReinstateSubject,
);

/** GET /api/admin/security-events/status/:subject — query revocation status for a subject. */
securityEventRouter.get(
  "/status/:subject",
  requireAdminScope("security:read"),
  GetRevocationStatus,
);

/** GET /api/admin/security-events/audit — view the security event audit trail. */
securityEventRouter.get(
  "/audit",
  requireAdminScope("security:read"),
  GetSecurityAuditTrail,
);
