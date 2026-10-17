import { Router, Request, Response } from "express";
import connectDb from "../db/connectDb";
import { AdminRequest, requireAdminScope } from "../middleware/adminAuth";
import { rateLimit } from "../middleware/rateLimiter";
import LifecycleEvent from "../models/LifecycleEvent";
import {
  MIN_SALT_LENGTH,
  analyzeLifecycle,
  normalizeLifecycleEvent,
  type LifecycleEvent as NormalizedEvent,
} from "../../../src/lib/analytics/lifecycleAnalytics";

/**
 * Lifecycle analytics. See docs/lifecycle-analytics.md.
 *
 * POST /api/analytics/lifecycle        — public, rate limited, fire-and-forget capture
 * GET  /api/admin/lifecycle-analytics  — aggregate, privacy-safe report (admin)
 */
export const lifecycleCaptureRouter = Router();
export const lifecycleReportRouter = Router();

function salt(): string | null {
  const value = process.env.LIFECYCLE_ANALYTICS_SALT;
  return value && value.length >= MIN_SALT_LENGTH ? value : null;
}

const captureLimiter = rateLimit({
  actionName: "lifecycle_capture",
  windowMs: 60 * 1000,
  maxRequests: 120,
  message: "Too many analytics events.",
});

lifecycleCaptureRouter.post("/", captureLimiter, async (req: Request, res: Response) => {
  // Analytics is never allowed to surface errors to the product flow: every
  // outcome below is a 2xx/4xx with an empty body the client ignores.
  const secret = salt();
  if (!secret || process.env.LIFECYCLE_ANALYTICS === "off") {
    res.status(204).end();
    return;
  }
  const body = req.body ?? {};
  const result = normalizeLifecycleEvent(
    {
      subject: typeof body.sessionId === "string" ? body.sessionId : "",
      workflow: body.workflow,
      stage: body.stage,
      kind: body.kind,
      reason: body.reason,
      at: Date.now(), // server clock, never the client's
    },
    secret,
  );
  if (!result.ok) {
    res.status(400).json({ error: "invalid lifecycle event", reason: result.rejection });
    return;
  }
  try {
    await connectDb();
    const { event } = result;
    await LifecycleEvent.create({ ...event, at: new Date(event.at) });
    res.status(204).end();
  } catch {
    res.status(204).end(); // best effort
  }
});

lifecycleReportRouter.get(
  "/",
  requireAdminScope("analytics:read"),
  async (req: AdminRequest, res: Response) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
      const asOf = Date.now();
      const since = asOf - days * 24 * 60 * 60 * 1000;
      await connectDb();
      const docs = await LifecycleEvent.find({ at: { $gte: new Date(since) } })
        .sort({ at: 1, _id: 1 })
        .limit(500_000)
        .lean();
      const events: NormalizedEvent[] = docs.map((d: any) => ({
        subjectHash: d.subjectHash,
        workflow: d.workflow,
        stage: d.stage,
        kind: d.kind,
        at: new Date(d.at).getTime(),
        reason: d.reason,
      }));
      res.json(
        analyzeLifecycle(events, {
          asOf,
          since,
          minCohort: Math.max(5, Number(req.query.minCohort) || 5),
          roundTo: Math.max(1, Number(req.query.roundTo) || 1),
        }),
      );
    } catch (err) {
      console.error("lifecycle report failed:", err);
      res.status(500).json({ error: "Failed to build lifecycle report." });
    }
  },
);
