import express, { Request, Response } from "express";
import { requireAdminScope } from "../middleware/adminAuth";
import {
  getBlockedRateLimitEvents,
  resetRateLimits,
} from "../middleware/rateLimiter";

export const adminRateLimitRouter = express.Router();

/**
 * GET /api/admin/rate-limits/blocked
 * Observability endpoint for blocked rate limit events.
 * Requires admin token with scope "ratelimit:read".
 */
adminRateLimitRouter.get(
  "/blocked",
  requireAdminScope("ratelimit:read"),
  (req: Request, res: Response) => {
    const action = req.query.action as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;

    const data = getBlockedRateLimitEvents({ action, limit, sinceMs });
    return res.json({
      success: true,
      data,
    });
  },
);

/**
 * POST /api/admin/rate-limits/reset
 * Reset rate limit state for specified key/action.
 * Requires admin token with scope "ratelimit:write".
 */
adminRateLimitRouter.post(
  "/reset",
  requireAdminScope("ratelimit:write"),
  (req: Request, res: Response) => {
    const { action, key } = req.body as { action?: string; key?: string };
    resetRateLimits(action, key);
    return res.json({
      success: true,
      message: action
        ? `Rate limits reset for action '${action}'${key ? ` and key '${key}'` : ""}`
        : "All rate limit stores reset",
    });
  },
);
