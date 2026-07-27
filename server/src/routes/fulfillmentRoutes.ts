import { Router, Request, Response } from "express";
import FulfillmentRecord, {
  FulfillmentStatus,
} from "../models/FulfillmentRecord";

export const fulfillmentRouter = Router();

/**
 * GET /api/fulfillment/:promptId/:buyerWallet
 * Returns the fulfillment record for a specific purchase.
 */
fulfillmentRouter.get(
  "/:promptId/:buyerWallet",
  async (req: Request, res: Response) => {
    const { promptId, buyerWallet } = req.params;
    const record = await FulfillmentRecord.findOne({
      promptId,
      buyerWallet: buyerWallet.toLowerCase(),
    });
    if (!record) {
      res.status(404).json({ error: "Fulfillment record not found" });
      return;
    }
    res.json(record);
  },
);

/**
 * POST /api/fulfillment
 * Creates or updates the fulfillment record for a purchase.
 * Called by the unlock service when delivery is attempted.
 *
 * Body: { promptId, buyerWallet, txHash?, status, failureReason? }
 */
fulfillmentRouter.post("/", async (req: Request, res: Response) => {
  const {
    promptId,
    buyerWallet,
    txHash,
    status,
    failureReason,
  }: {
    promptId: string;
    buyerWallet: string;
    txHash?: string;
    status: FulfillmentStatus;
    failureReason?: string;
  } = req.body;

  if (!promptId || !buyerWallet || !status) {
    res.status(400).json({ error: "promptId, buyerWallet and status are required" });
    return;
  }

  const record = await FulfillmentRecord.findOneAndUpdate(
    { promptId, buyerWallet: buyerWallet.toLowerCase() },
    {
      $set: {
        txHash: txHash ?? "",
        status,
        failureReason: failureReason ?? "",
        ...(status !== "pending" ? { deliveryAttemptedAt: new Date() } : {}),
      },
      $push: {
        auditLog: { status, note: failureReason ?? "", at: new Date() },
      },
    },
    { upsert: true, new: true },
  );

  res.json(record);
});

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

    if (!record.isRefundEligible()) {
      res.status(409).json({
        error: "Purchase is not eligible for a refund",
        status: record.status,
      });
      return;
    }

    record.status = "refund_requested";
    record.refundReason = reason;
    if (disputeTxHash) record.disputeTxHash = disputeTxHash;
    record.auditLog.push({
      status: "refund_requested",
      note: reason,
      at: new Date(),
    });
    await record.save();

    res.json(record);
  },
);

/**
 * POST /api/fulfillment/:promptId/:buyerWallet/resolve
 * Admin resolves a refund request (approve or reject).
 *
 * Body: { refund: boolean, resolutionTxHash? }
 */
fulfillmentRouter.post(
  "/:promptId/:buyerWallet/resolve",
  async (req: Request, res: Response) => {
    const { promptId, buyerWallet } = req.params;
    const { refund, resolutionTxHash } = req.body as {
      refund: boolean;
      resolutionTxHash?: string;
    };

    const record = await FulfillmentRecord.findOne({
      promptId,
      buyerWallet: buyerWallet.toLowerCase(),
    });

    if (!record) {
      res.status(404).json({ error: "Fulfillment record not found" });
      return;
    }

    if (record.status !== "refund_requested") {
      res.status(409).json({
        error: "Record is not in refund_requested state",
        status: record.status,
      });
      return;
    }

    const newStatus: FulfillmentStatus = refund ? "refunded" : "rejected";
    record.status = newStatus;
    if (resolutionTxHash) record.resolutionTxHash = resolutionTxHash;
    record.auditLog.push({
      status: newStatus,
      note: refund ? "Refund approved" : "Refund rejected",
      at: new Date(),
    });
    await record.save();

    res.json(record);
  },
);

/**
 * GET /api/fulfillment/pending-refunds
 * Returns all records with status=refund_requested.
 * Intended for admin dashboards.
 */
fulfillmentRouter.get("/pending-refunds", async (_req, res: Response) => {
  const records = await FulfillmentRecord.find({
    status: "refund_requested",
  }).sort({ updatedAt: -1 });
  res.json(records);
});

/**
 * POST /api/fulfillment/auto-refund-sweep
 * Marks all purchases that are still `pending` or `failed` after the
 * timeout window as `refund_requested`.  Intended to be called by a
 * cron job or a scheduled task (#335).
 */
fulfillmentRouter.post("/auto-refund-sweep", async (_req, res: Response) => {
  const timeoutMs = parseInt(
    process.env.FULFILLMENT_TIMEOUT_MS ?? "600000",
    10,
  );
  const cutoff = new Date(Date.now() - timeoutMs);

  const result = await FulfillmentRecord.updateMany(
    {
      status: { $in: ["pending", "failed"] },
      deliveryAttemptedAt: { $lte: cutoff },
    },
    {
      $set: { status: "refund_requested", refundReason: "Auto-refund: delivery timeout" },
      $push: {
        auditLog: {
          status: "refund_requested",
          note: "Auto-refund: delivery timeout exceeded",
          at: new Date(),
        },
      },
    },
  );

  res.json({ swept: result.modifiedCount });
});
