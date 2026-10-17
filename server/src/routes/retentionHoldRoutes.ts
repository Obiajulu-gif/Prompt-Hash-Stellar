import { Router, Response } from "express";
import { AdminRequest, requireAdminScope } from "../middleware/adminAuth";
import connectDb from "../db/connectDb";
import {
  RetentionHoldError,
  listOverdueHolds,
  placeHold,
  reconcileHoldFlags,
  releaseHold,
  defaultDeps,
} from "../services/retentionHoldService";

/**
 * Retention holds for disputes and investigations. See docs/retention-holds.md.
 *
 * GET  /api/admin/retention-holds?status=active|released&caseRef=
 * GET  /api/admin/retention-holds/overdue
 * POST /api/admin/retention-holds            { caseType, caseRef, reason, links[] | includePromptReportsFor, reviewDays? }
 * POST /api/admin/retention-holds/:id/release { reason }
 * POST /api/admin/retention-holds/reconcile  { dryRun? }   (defaults to dry run)
 */
export const retentionHoldRouter = Router();

function sendError(res: Response, err: unknown): void {
  if (err instanceof RetentionHoldError) {
    const status =
      err.code === "invalid_request" ? 400
      : err.code === "hold_not_found" || err.code === "record_not_found" ? 404
      : err.code === "already_released" ? 409
      : 503;
    res.status(status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }
  console.error("retention hold error:", err);
  res.status(500).json({ error: "Retention hold operation failed." });
}

retentionHoldRouter.get("/", requireAdminScope("retention-holds:read"), async (req: AdminRequest, res: Response) => {
  try {
    await connectDb();
    const status = req.query.status ? String(req.query.status) : undefined;
    if (status && status !== "active" && status !== "released") {
      res.status(400).json({ error: "status must be 'active' or 'released'" });
      return;
    }
    const caseRef = req.query.caseRef ? String(req.query.caseRef) : undefined;
    const items = await defaultDeps().holds.list({ status: status as "active" | "released" | undefined, caseRef });
    res.json({ items });
  } catch (err) {
    sendError(res, err);
  }
});

retentionHoldRouter.get("/overdue", requireAdminScope("retention-holds:read"), async (_req: AdminRequest, res: Response) => {
  try {
    await connectDb();
    res.json({ items: await listOverdueHolds() });
  } catch (err) {
    sendError(res, err);
  }
});

retentionHoldRouter.post("/", requireAdminScope("retention-holds:write"), async (req: AdminRequest, res: Response) => {
  try {
    await connectDb();
    const body = req.body ?? {};
    const result = await placeHold({
      caseType: body.caseType,
      caseRef: body.caseRef,
      reason: body.reason,
      actor: req.admin?.sub ?? "",
      links: Array.isArray(body.links) ? body.links : [],
      includePromptReportsFor: typeof body.includePromptReportsFor === "string" ? body.includePromptReportsFor : undefined,
      reviewDays: body.reviewDays,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    sendError(res, err);
  }
});

retentionHoldRouter.post("/reconcile", requireAdminScope("retention-holds:write"), async (req: AdminRequest, res: Response) => {
  try {
    await connectDb();
    res.json(await reconcileHoldFlags({ dryRun: req.body?.dryRun !== false }));
  } catch (err) {
    sendError(res, err);
  }
});

retentionHoldRouter.post("/:id/release", requireAdminScope("retention-holds:write"), async (req: AdminRequest, res: Response) => {
  try {
    await connectDb();
    const result = await releaseHold(String(req.params.id), {
      actor: req.admin?.sub ?? "",
      reason: req.body?.reason,
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});
