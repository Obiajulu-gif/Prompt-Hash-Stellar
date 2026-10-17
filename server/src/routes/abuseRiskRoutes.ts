import { Router, Response } from "express";
import { AdminRequest, requireAdminScope } from "../middleware/adminAuth";
import {
  abuseActivityLedger,
  abuseReviewQueue,
  ReviewStatus,
} from "../services/abuseRiskScoring";
import { recordAuditEvent } from "../services/auditTrail";

/**
 * Admin review surface for risk-scored abuse detection.
 *
 * GET  /api/admin/abuse-risk/reviews?status=pending
 * POST /api/admin/abuse-risk/reviews/:id/resolve { decision: "approved"|"rejected", note? }
 * POST /api/admin/abuse-risk/subjects/reset { wallet }   — clear a false positive's counters
 */
export const abuseRiskRouter = Router();

const STATUSES: ReviewStatus[] = ["pending", "approved", "rejected", "consumed"];

abuseRiskRouter.get(
  "/reviews",
  requireAdminScope("abuse-risk:read"),
  (req: AdminRequest, res: Response) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    if (status && !STATUSES.includes(status as ReviewStatus)) {
      res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
      return;
    }
    res.json({ items: abuseReviewQueue.list(status as ReviewStatus | undefined) });
  },
);

abuseRiskRouter.post(
  "/reviews/:id/resolve",
  requireAdminScope("abuse-risk:write"),
  (req: AdminRequest, res: Response) => {
    const decision = req.body?.decision;
    if (decision !== "approved" && decision !== "rejected") {
      res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
      return;
    }
    const actor = req.admin?.sub ?? "unknown";
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : undefined;
    const item = abuseReviewQueue.resolve(String(req.params.id), decision, actor, note);
    if (!item) {
      res.status(404).json({ error: "No pending review with that id." });
      return;
    }
    void recordAuditEvent({
      action: "abuse_risk_review_resolved",
      result: "success",
      promptId: null,
      walletAddress: null,
      actor,
      requestId: req.requestId ?? null,
      reason: `abuse-risk review ${item.id} ${decision} operation=${item.operation} score=${item.score}`,
    });
    res.json({ item });
  },
);

abuseRiskRouter.post(
  "/subjects/reset",
  requireAdminScope("abuse-risk:write"),
  (req: AdminRequest, res: Response) => {
    const wallet = typeof req.body?.wallet === "string" ? req.body.wallet : "";
    if (!wallet) {
      res.status(400).json({ error: "wallet is required" });
      return;
    }
    abuseActivityLedger.reset(wallet);
    void recordAuditEvent({
      action: "abuse_risk_subject_reset",
      result: "success",
      promptId: null,
      walletAddress: null,
      actor: req.admin?.sub ?? "unknown",
      requestId: req.requestId ?? null,
      reason: "abuse-risk subject counters reset",
    });
    res.json({ reset: true });
  },
);
