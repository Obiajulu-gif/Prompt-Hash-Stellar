/**
 * Expiring capability grant routes (#1171).
 *
 * All management endpoints are admin-scoped. Consumption is not an HTTP
 * endpoint of its own: a sensitive route mounts `requireCapabilityGrant(...)`
 * ahead of its handler, so the capability is bound to that handler's action.
 */

import express from "express";
import {
  DescribeCapabilityAction,
  GetCapabilityGrant,
  IssueCapabilityGrant,
  RevokeCapabilityGrant,
} from "../controllers/capabilityGrantControllers";
import { requireAdminScope } from "../middleware/adminAuth";

export const capabilityGrantRouter = express.Router();

capabilityGrantRouter.post(
  "/grants",
  requireAdminScope("capability:write"),
  IssueCapabilityGrant,
);
capabilityGrantRouter.get(
  "/grants/:grantId",
  requireAdminScope("capability:read"),
  GetCapabilityGrant,
);
capabilityGrantRouter.post(
  "/grants/:grantId/revoke",
  requireAdminScope("capability:write"),
  RevokeCapabilityGrant,
);
capabilityGrantRouter.get(
  "/actions/:action",
  requireAdminScope("capability:read"),
  DescribeCapabilityAction,
);
