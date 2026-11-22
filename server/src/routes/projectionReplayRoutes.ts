import { Router, type Response } from "express";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth";
import { ProjectionPointer } from "../models/ProjectionRun";
import { ReplayRun } from "../models/ProjectionRun";
import {
  ReplayError,
  activateRun,
  getRun,
  listProjections,
  rollbackProjection,
  retryRun,
  runReplay,
  startReplay,
} from "../services/projectionReplay";

/**
 * Admin surface for the versioned event replay tool (#1024).
 *
 * GET  /api/admin/projections                         projections:read
 * GET  /api/admin/projections/runs/:runId             projections:read
 * POST /api/admin/projections/:name/replays           projections:write
 * POST /api/admin/projections/runs/:runId/resume      projections:write
 * POST /api/admin/projections/runs/:runId/retry       projections:write
 * POST /api/admin/projections/runs/:runId/activate    projections:write
 * POST /api/admin/projections/:name/rollback          projections:write
 *
 * Replays run in the background; poll the run for status. See
 * docs/operations/event-replay.md.
 */
export const projectionReplayRouter = Router();

const STATUS_FOR: Record<ReplayError["code"], number> = {
  unknown_projection: 404,
  run_not_found: 404,
  run_not_claimable: 409,
  run_not_activatable: 409,
  nothing_to_roll_back: 409,
  run_not_retryable: 409,
};

function sendError(res: Response, err: unknown) {
  if (err instanceof ReplayError) {
    return res.status(STATUS_FOR[err.code]).json({ error: err.code, message: err.message });
  }
  return res.status(500).json({ error: (err as Error).message || "Replay operation failed" });
}

function actorOf(req: AdminRequest): string {
  return req.admin?.sub ?? "unknown-admin";
}

function parseBatchSize(raw: unknown): number | undefined | null {
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || (raw as number) < 1 || (raw as number) > 5_000) return null;
  return raw as number;
}

function runInBackground(runId: string, batchSize?: number) {
  // runReplay records its own failures on the run; never crash the process.
  void runReplay(runId, { batchSize }).catch(() => undefined);
}

projectionReplayRouter.get("/", requireAdminScope("projections:read"), async (_req, res) => {
  try {
    const pointers = await ProjectionPointer.find({}).lean();
    // Pointer is the currently active version; null means no replay has been activated yet.
    const byName = new Map(pointers.map((p: any) => [p.projection, p]));
    res.json({
      projections: listProjections().map((p) => ({ ...p, pointer: byName.get(p.name) ?? null })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

projectionReplayRouter.get("/runs", requireAdminScope("projections:read"), async (req, res) => {
  try {
    const projection = req.query.projection ? String(req.query.projection) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const filter: Record<string, unknown> = {};
    if (projection) filter.projection = projection;
    if (status) filter.status = status;
    const runs = await ReplayRun.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ runs });
  } catch (err) {
    sendError(res, err);
  }
});

projectionReplayRouter.get("/runs/:runId", requireAdminScope("projections:read"), async (req, res) => {
  try {
    res.json(await getRun(String(req.params.runId)));
  } catch (err) {
    sendError(res, err);
  }
});

projectionReplayRouter.post(
  "/:name/replays",
  requireAdminScope("projections:write"),
  async (req: AdminRequest, res: Response) => {
    const { mode = "build", strict = true, batchSize } = req.body ?? {};
    if (mode !== "build" && mode !== "dry_run") {
      return res.status(400).json({ error: "mode must be build or dry_run" });
    }
    if (typeof strict !== "boolean") return res.status(400).json({ error: "strict must be a boolean" });
    const parsedBatch = parseBatchSize(batchSize);
    if (parsedBatch === null) {
      return res.status(400).json({ error: "batchSize must be an integer between 1 and 5000" });
    }
    try {
      const run = await startReplay({ projection: String(req.params.name), mode, strict, startedBy: actorOf(req) });
      runInBackground(run.runId, parsedBatch);
      return res.status(202).json(run);
    } catch (err) {
      return sendError(res, err);
    }
  },
);

projectionReplayRouter.post(
  "/runs/:runId/resume",
  requireAdminScope("projections:write"),
  async (req: AdminRequest, res: Response) => {
    try {
      const run: any = await getRun(String(req.params.runId));
      if (run.status === "completed") {
        return res.status(409).json({ error: "run_not_claimable", message: "Run already completed." });
      }
      const parsedBatch = parseBatchSize(req.body?.batchSize);
      if (parsedBatch === null) {
        return res.status(400).json({ error: "batchSize must be an integer between 1 and 5000" });
      }
      runInBackground(run.runId, parsedBatch);
      return res.status(202).json({ runId: run.runId, resumedFrom: run.checkpoint });
    } catch (err) {
      return sendError(res, err);
    }
  },
);

projectionReplayRouter.post(
  "/runs/:runId/retry",
  requireAdminScope("projections:write"),
  async (req: AdminRequest, res: Response) => {
    try {
      const parsedBatch = parseBatchSize(req.body?.batchSize);
      if (parsedBatch === null) {
        return res.status(400).json({ error: "batchSize must be an integer between 1 and 5000" });
      }
      const run = await retryRun(String(req.params.runId), actorOf(req));
      runInBackground(run.runId, parsedBatch);
      return res.status(202).json(run);
    } catch (err) {
      return sendError(res, err);
    }
  },
);

projectionReplayRouter.post(
  "/runs/:runId/activate",
  requireAdminScope("projections:write"),
  async (req: AdminRequest, res: Response) => {
    try {
      return res.json(await activateRun(String(req.params.runId), actorOf(req)));
    } catch (err) {
      return sendError(res, err);
    }
  },
);

projectionReplayRouter.post(
  "/:name/rollback",
  requireAdminScope("projections:write"),
  async (req: AdminRequest, res: Response) => {
    try {
      return res.json(await rollbackProjection(String(req.params.name), actorOf(req)));
    } catch (err) {
      return sendError(res, err);
    }
  },
);

// Edge cases:
// - Retry is only allowed for failed/aborted runs; retryRun enforces this and
//   returns run_not_retryable otherwise (409).
// - Rollback restores the previous active pointer; if none exists, nothing_to_roll_back (409).
// - Resume on a completed run is rejected (409) to avoid double-applying events.
// - All write endpoints require projections:write; reads require projections:read.
