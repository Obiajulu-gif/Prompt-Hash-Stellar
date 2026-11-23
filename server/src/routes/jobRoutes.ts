import express from "express";
import {
  QueueBackpressureError,
  enqueueJob,
  getDeadLetterJobs,
  getJobById,
  getQueuePressure,
  listJobs,
  maxPendingForType,
  requeueDeadLetter,
} from "../jobs/jobQueue";
import { requireAdminScope } from "../middleware/adminAuth";
import type { JobType } from "../jobs/types";

/**
 * Job observability and admin routes.
 *
 * POST /api/jobs/enqueue — enqueue a job (admin)
 * GET  /api/jobs          — list recent jobs
 * GET  /api/jobs/pressure — pending+processing depth per type (#1009)
 * GET  /api/jobs/dead-letter — list DLQ
 * POST /api/jobs/:id/requeue — requeue a dead-letter job
 *
 * Enqueue returns 429 + Retry-After when a type is at its admission ceiling.
 */

export const jobRouter = express.Router();

const JOB_TYPES: JobType[] = [
  "settlement_poll",
  "entitlement_repair",
  "analytics_aggregate",
  "export_csv",
  "stale_dispute_cleanup",
  "retention_cleanup",
  "stale_cache_repair",
];

// Enqueue — admin-only to prevent abuse (workers are internal). For demo, allow any authenticated.
jobRouter.post("/enqueue", requireAdminScope("jobs:write"), async (req, res) => {
  const { type, payload, options } = req.body;
  if (!type || !payload) return res.status(400).json({ error: "type and payload are required" });
  if (!JOB_TYPES.includes(type)) return res.status(400).json({ error: `Unknown job type: ${type}` });
  try {
    const job = await enqueueJob(type, payload, options);
    res.status(201).json(job);
  } catch (err: any) {
    if (err instanceof QueueBackpressureError) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))));
      return res.status(429).json({
        error: err.code,
        message: err.message,
        type: err.type,
        pending: err.pending,
        processing: err.processing,
        limit: err.limit,
        retryAfterMs: err.retryAfterMs,
      });
    }
    res.status(400).json({ error: err.message });
  }
});

jobRouter.get("/pressure", requireAdminScope("jobs:read"), async (_req, res) => {
  const pressure = await Promise.all(
    JOB_TYPES.map((type) => getQueuePressure(type, maxPendingForType(type))),
  );
  res.json(pressure);
});

jobRouter.get("/", requireAdminScope("jobs:read"), async (req, res) => {
  const { status, type, limit } = req.query as {
    status?: string;
    type?: string;
    limit?: string;
  };
  const jobs = await listJobs({
    status: status ? String(status) : undefined,
    type: type ? (String(type) as any) : undefined,
    limit: limit ? parseInt(String(limit)) : 50,
  });
  res.json(jobs);
});

jobRouter.get("/dead-letter", requireAdminScope("jobs:read"), async (_req, res) => {
  const jobs = await getDeadLetterJobs();
  res.json(jobs);
});

jobRouter.get("/:id", requireAdminScope("jobs:read"), async (req, res) => {
  const job = await getJobById(String(req.params.id));
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

jobRouter.post("/:id/requeue", requireAdminScope("jobs:write"), async (req, res) => {
  try {
    const job = await requeueDeadLetter(String(req.params.id));
    res.json(job);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
