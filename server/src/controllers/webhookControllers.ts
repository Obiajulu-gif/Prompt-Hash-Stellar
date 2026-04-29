import { Request, Response } from "express";
import { randomBytes } from "crypto";
import connectDb from "../db/connectDb";
import WebhookSubscription from "../models/WebhookSubscription";

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
