import { Request, Response } from "express";
import { randomBytes } from "crypto";
import connectDb from "../db/connectDb";
import WebhookSubscription from "../models/WebhookSubscription";
import WebhookOutboxEvent from "../models/WebhookOutboxEvent";

export const RegisterWebhook = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress, url, events } = req.body;

    if (!walletAddress || !url) {
      return res.status(400).json({ error: "walletAddress and url are required." });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "url must be a valid URL." });
    }

    const secret = randomBytes(32).toString("hex");
    const allowedEvents = ["PromptPurchased"];
    const resolvedEvents = Array.isArray(events)
      ? events.filter((e: string) => allowedEvents.includes(e))
      : ["PromptPurchased"];

    const existing = await WebhookSubscription.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });

    if (existing) {
      existing.url = url;
      existing.events = resolvedEvents;
      existing.active = true;
      existing.failureCount = 0;
      await existing.save();
      return res.status(200).json({ message: "Webhook updated.", id: existing._id, secret });
    }

    const sub = new WebhookSubscription({
      walletAddress: walletAddress.toLowerCase(),
      url,
      secret,
      events: resolvedEvents,
    });
    await sub.save();

    return res.status(201).json({ message: "Webhook registered.", id: sub._id, secret });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const GetWebhook = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress query param is required." });
    }

    const sub = await WebhookSubscription.findOne({
      walletAddress: String(walletAddress).toLowerCase(),
    }).select("-secret");

    if (!sub) return res.status(404).json({ error: "No webhook registered for this wallet." });

    return res.json(sub);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const DeleteWebhook = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required." });
    }

    await WebhookSubscription.deleteOne({ walletAddress: walletAddress.toLowerCase() });
    return res.status(200).json({ message: "Webhook removed." });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ---------------------------------------------------------------------------
// Dead-letter / outbox admin endpoints (#606)
// ---------------------------------------------------------------------------

/** GET /api/webhooks/dead-letter?walletAddress=...&page=1&limit=20 */
export const GetDeadLetterEvents = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress, page: pageStr, limit: limitStr } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress query param is required." });
    }

    const page = Math.max(1, parseInt(String(pageStr), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(limitStr), 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {
      walletAddress: String(walletAddress).toLowerCase(),
      status: "failed",
    };

    const [events, total] = await Promise.all([
      WebhookOutboxEvent.find(filter)
        .sort({ failedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-secret -payload")
        .lean(),
      WebhookOutboxEvent.countDocuments(filter),
    ]);

    return res.json({
      events,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

/** POST /api/webhooks/dead-letter/:eventId/retry – re-enqueue a dead-lettered event */
export const RetryDeadLetterEvent = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { eventId } = req.params;

    const event = await WebhookOutboxEvent.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Dead-lettered event not found." });
    }
    if (event.status !== "failed") {
      return res.status(400).json({ error: "Event is not in failed status." });
    }

    // Reset for re-delivery.
    event.status = "pending";
    event.attemptCount = 0;
    event.lastError = null;
    event.lastStatusCode = null;
    event.nextRetryAt = new Date();
    event.failedAt = null;
    await event.save();

    return res.json({ message: "Event re-enqueued for delivery." });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

/** GET /api/webhooks/dead-letter/stats?walletAddress=... */
export const GetDeadLetterStats = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress query param is required." });
    }

    const addr = String(walletAddress).toLowerCase();

    const [pending, processing, delivered, failed] = await Promise.all([
      WebhookOutboxEvent.countDocuments({ walletAddress: addr, status: "pending" }),
      WebhookOutboxEvent.countDocuments({ walletAddress: addr, status: "processing" }),
      WebhookOutboxEvent.countDocuments({ walletAddress: addr, status: "delivered" }),
      WebhookOutboxEvent.countDocuments({ walletAddress: addr, status: "failed" }),
    ]);

    return res.json({ walletAddress: addr, pending, processing, delivered, failed });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
