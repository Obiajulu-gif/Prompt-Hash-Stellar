import express from "express";
import { enqueueJob, listJobs, getDeadLetterJobs, requeueDeadLetter, getJobById } from "../jobs/jobQueue";
import { requireAdminScope } from "../middleware/adminAuth";

/**
 * Job observability and admin routes.
 *
 * POST /api/jobs/enqueue — enqueue a job (admin)
 * GET  /api/jobs          — list recent jobs
 * GET  /api/jobs/dead-letter — list DLQ
 * POST /api/jobs/:id/requeue — requeue a dead-letter job
 */

export const jobRouter = express.Router();

// Enqueue — admin-only to prevent abuse (workers are internal). For demo, allow any authenticated.
jobRouter.post("/enqueue", requireAdminScope("jobs:write"), async (req, res) => {
  const { type, payload, options } = req.body;
  if (!type || !payload) return res.status(400).json({ error: "type and payload are required" });
  try {
    const job = await enqueueJob(type, payload, options);
    res.status(201).json(job);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

jobRouter.get("/", requireAdminScope("jobs:read"), async (req, res) => {
  const { status, type, limit } = req.query;
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
  const job = await getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

jobRouter.post("/:id/requeue", requireAdminScope("jobs:write"), async (req, res) => {
  try {
    const job = await requeueDeadLetter(req.params.id);
    res.json(job);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
