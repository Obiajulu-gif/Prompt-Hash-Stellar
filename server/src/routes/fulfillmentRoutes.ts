import { Router, Request, Response } from "express";
import FulfillmentRecord, {
  FulfillmentStatus,
} from "../models/FulfillmentRecord";
import { AdminRequest, requireAdminScope } from "../middleware/adminAuth";
import { markPrivate } from "../middleware/etag";
import {
  applyDisputeTransition,
  DisputeTransitionResult,
  listDisputes,
  sweepStaleDisputes,
  toBuyerDisputeView,
  toMaintainerDisputeView,
} from "../services/purchaseDisputes";

export const fulfillmentRouter = Router();

const ALL_STATUSES: FulfillmentStatus[] = [
  "pending",
  "delivered",
  "failed",
  "retrying",
  "refund_requested",
  "refunded",
  "rejected",
  "resolved",
];

function idempotencyKey(req: Request, prefix: string): string | undefined {
  const key = req.get("Idempotency-Key");
  return key ? `${prefix}:${key}` : undefined;
}

/**
 * Maps a dispute transition result onto the HTTP response. Replays of an
 * already-applied action succeed with `idempotent: true` instead of failing.
 */
function sendTransition(
  res: Response,
  result: DisputeTransitionResult,
  view: (record: any) => object,
): void {
  if (result.outcome === "not_found") {
    res.status(404).json({ error: "Fulfillment record not found" });
    return;
  }
  if (result.outcome === "invalid_transition") {
    res.status(409).json({
      error: "This action is not allowed in the purchase's current state",
      status: result.record.status,
    });
    return;
  }
  res.json({ ...view(result.record), idempotent: result.outcome !== "applied" });
}

const maintainerView = (record: any) => toMaintainerDisputeView(record);

/**
 * GET /api/fulfillment/disputes?status=&limit=
 * Maintainer dispute queue (#755). Defaults to open disputes, oldest first,
 * with `stale` flagged on records nobody has acted on within the timeout.
 */
fulfillmentRouter.get(
  "/disputes",
  requireAdminScope("fulfillment:read"),
  async (req: Request, res: Response) => {
    markPrivate(res);
    let statuses: FulfillmentStatus[] | undefined;
    if (req.query.status) {
      statuses = String(req.query.status).split(",") as FulfillmentStatus[];
      if (statuses.some((status) => !ALL_STATUSES.includes(status))) {
        res.status(400).json({ error: "Unknown status filter" });
        return;
      }
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json({ disputes: await listDisputes({ statuses, limit }) });
  },
);

/**
 * GET /api/fulfillment/:promptId/:buyerWallet
 * Returns the buyer-facing delivery/dispute status for a specific purchase.
 * Wallet, transaction, and maintainer metadata are not included.
 */
fulfillmentRouter.get(
  "/:promptId/:buyerWallet",
  async (req: Request, res: Response) => {
    markPrivate(res);
    const { promptId, buyerWallet } = req.params;
    const record = await FulfillmentRecord.findOne({
      promptId,
      buyerWallet: buyerWallet.toLowerCase(),
    });
    if (!record) {
      res.status(404).json({ error: "Fulfillment record not found" });
      return;
    }
    res.json(toBuyerDisputeView(record, record.isRefundEligible()));
  },
);

/**
 * POST /api/fulfillment
 * Reports a delivery outcome for a purchase. Called by the unlock service,
 * so it needs a service/admin token (#755). Only delivery outcomes can be
 * reported here — refunds and resolutions go through the dispute actions.
 *
 * Body: { promptId, buyerWallet, txHash?, status, failureReason?, eventId? }
 */
fulfillmentRouter.post(
  "/",
  requireAdminScope("fulfillment:write"),
  async (req: AdminRequest, res: Response) => {
    const {
      promptId,
      buyerWallet,
      txHash,
      status,
      failureReason,
      eventId,
    }: {
      promptId: string;
      buyerWallet: string;
      txHash?: string;
      status: FulfillmentStatus;
      failureReason?: string;
      eventId?: string;
    } = req.body;

    if (!promptId || !buyerWallet || !status) {
      res.status(400).json({ error: "promptId, buyerWallet and status are required" });
      return;
    }
    if (!["pending", "delivered", "failed"].includes(status)) {
      res.status(400).json({
        error: "Only pending, delivered, or failed can be reported; use the dispute actions for other states",
      });
      return;
    }

    const key = { promptId: String(promptId), buyerWallet: buyerWallet.toLowerCase() };
    const eventKey = eventId ? `service:${eventId}` : idempotencyKey(req, "service");

    if (status === "failed") {
      const result = await applyDisputeTransition({
        ...key,
        event: "unlock_failed",
        actor: req.admin?.sub,
        note: failureReason ?? "",
        eventKey,
        requestId: req.correlationId,
        set: { failureReason: failureReason ?? "", ...(txHash ? { txHash } : {}) },
      });
      sendTransition(res, result, maintainerView);
      return;
    }

    // First report for a purchase just records it; it never regresses a
    // record that already moved on.
    await FulfillmentRecord.updateOne(
      key,
      { $setOnInsert: { status, txHash: txHash ?? "" } },
      { upsert: true },
    );

    if (status === "delivered") {
      const result = await applyDisputeTransition({
        ...key,
        event: "unlock_succeeded",
        actor: req.admin?.sub,
        eventKey,
        requestId: req.correlationId,
      });
      if (result.outcome !== "invalid_transition") {
        sendTransition(res, result, maintainerView);
        return;
      }
    }

    res.json(toMaintainerDisputeView(await FulfillmentRecord.findOne(key).lean()));
  },
);

/**
 * POST /api/fulfillment/:promptId/:buyerWallet/request-refund
 * The buyer requests a refund for a failed or timed-out delivery.
 *
 * Body: { reason, disputeTxHash? }
 */
fulfillmentRouter.post(
  "/:promptId/:buyerWallet/request-refund",
  async (req: Request, res: Response) => {
    const { promptId, buyerWallet } = req.params;
    const { reason, disputeTxHash } = req.body as {
      reason: string;
      disputeTxHash?: string;
    };

    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const record = await FulfillmentRecord.findOne({
      promptId,
      buyerWallet: buyerWallet.toLowerCase(),
    });

    if (!record) {
      res.status(404).json({ error: "Fulfillment record not found" });
      return;
    }

    if (record.status !== "refund_requested" && !record.isRefundEligible()) {
      res.status(409).json({
        error: "Purchase is not eligible for a refund",
        status: record.status,
      });
      return;
    }

    const result = await applyDisputeTransition({
      promptId,
      buyerWallet,
      event: "refund_requested",
      actor: "buyer",
      note: reason,
      eventKey: idempotencyKey(req, "buyer"),
      requestId: req.correlationId,
      set: { refundReason: reason, ...(disputeTxHash ? { disputeTxHash } : {}) },
    });
    sendTransition(res, result, (updated) => toBuyerDisputeView(updated, false));
  },
);

/**
 * POST /api/fulfillment/:promptId/:buyerWallet/retry
 * Maintainer re-arms the unlock so the buyer can try again (#755).
 *
 * Body: { notes? }
 */
fulfillmentRouter.post(
  "/:promptId/:buyerWallet/retry",
  requireAdminScope("fulfillment:resolve"),
  async (req: AdminRequest, res: Response) => {
    const { promptId, buyerWallet } = req.params as Record<string, string>;
    const { notes } = (req.body ?? {}) as { notes?: string };

    const result = await applyDisputeTransition({
      promptId,
      buyerWallet,
      event: "retry_scheduled",
      actor: req.admin?.sub,
      note: notes || "Unlock retry scheduled",
      eventKey: idempotencyKey(req, "admin"),
      requestId: req.correlationId,
    });
    sendTransition(res, result, maintainerView);
  },
);

/**
 * POST /api/fulfillment/:promptId/:buyerWallet/resolve
 * Admin approves or rejects a refund. Approval is also allowed straight from
 * a failed or retrying unlock; the refund itself settles on-chain.
 *
 * Body: { refund: boolean, resolutionTxHash?, notes? }
 */
fulfillmentRouter.post(
  "/:promptId/:buyerWallet/resolve",
  requireAdminScope("fulfillment:resolve"),
  async (req: AdminRequest, res: Response) => {
    const { promptId, buyerWallet } = req.params as Record<string, string>;
    const { refund, resolutionTxHash, notes } = req.body as {
      refund: boolean;
      resolutionTxHash?: string;
      notes?: string;
    };

    const result = await applyDisputeTransition({
      promptId,
      buyerWallet,
      event: refund ? "refund_approved" : "refund_rejected",
      actor: req.admin?.sub,
      note: notes || (refund ? "Refund approved" : "Refund rejected"),
      eventKey: idempotencyKey(req, "admin"),
      requestId: req.correlationId,
      set: {
        resolvedBy: req.admin?.sub ?? "",
        ...(notes ? { resolutionNotes: notes } : {}),
        ...(resolutionTxHash ? { resolutionTxHash } : {}),
      },
    });
    sendTransition(res, result, maintainerView);
  },
);

/**
 * POST /api/fulfillment/:promptId/:buyerWallet/close
 * Maintainer closes a dispute as resolved, with notes the buyer can read.
 *
 * Body: { notes }
 */
fulfillmentRouter.post(
  "/:promptId/:buyerWallet/close",
  requireAdminScope("fulfillment:resolve"),
  async (req: AdminRequest, res: Response) => {
    const { promptId, buyerWallet } = req.params as Record<string, string>;
    const notes = String((req.body ?? {}).notes ?? "").trim();

    if (notes.length < 3) {
      res.status(400).json({ error: "notes are required to close a dispute" });
      return;
    }

    const result = await applyDisputeTransition({
      promptId,
      buyerWallet,
      event: "resolved",
      actor: req.admin?.sub,
      note: notes,
      eventKey: idempotencyKey(req, "admin"),
      requestId: req.correlationId,
      set: { resolutionNotes: notes, resolvedBy: req.admin?.sub ?? "" },
    });
    sendTransition(res, result, maintainerView);
  },
);

/**
 * GET /api/fulfillment/pending-refunds
 * Returns all records with status=refund_requested.
 * Intended for admin dashboards.
 */
fulfillmentRouter.get(
  "/pending-refunds",
  requireAdminScope("fulfillment:read"),
  async (_req, res: Response) => {
    const records = await FulfillmentRecord.find({
      status: "refund_requested",
    }).sort({ updatedAt: -1 });
    res.json(records);
  },
);

/**
 * POST /api/fulfillment/auto-refund-sweep
 * Escalates purchases that are still `pending`, `failed`, or `retrying`
 * after the timeout window to `refund_requested`, one audited transition per
 * record. Intended to be called by a cron job or a scheduled task (#335).
 * Bulk-mutates many records, so it requires the same admin/service scope as
 * other recovery actions (#542).
 */
fulfillmentRouter.post(
  "/auto-refund-sweep",
  requireAdminScope("fulfillment:sweep"),
  async (_req, res: Response) => {
    res.json({ swept: await sweepStaleDisputes() });
  },
);
