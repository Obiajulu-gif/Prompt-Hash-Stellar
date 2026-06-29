import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import WebhookSubscription from "../../server/src/models/WebhookSubscription";
import { randomBytes } from "crypto";

async function handler(req: any, res: any) {
  await connectDb();

  if (req.method === "GET") {
    const { walletAddress } = req.query ?? {};
    if (!walletAddress) {
      res.status(400).json({ error: "walletAddress query param is required." });
      return;
    }
    const sub = await WebhookSubscription.findOne({
      walletAddress: String(walletAddress).toLowerCase(),
    }).select("-secret");
    if (!sub) {
      res.status(404).json({ error: "No webhook registered for this wallet." });
      return;
    }
    res.status(200).json(sub);
    return;
  }

  if (req.method === "POST") {
    const { walletAddress, url, events } = req.body ?? {};
    if (!walletAddress || !url) {
      res.status(400).json({ error: "walletAddress and url are required." });
      return;
    }
    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: "url must be a valid URL." });
      return;
    }

    const secret = randomBytes(32).toString("hex");
    const allowedEvents = ["PromptPurchased"];
    const resolvedEvents = Array.isArray(events)
      ? events.filter((e: string) => allowedEvents.includes(e))
      : ["PromptPurchased"];

    const existing = await WebhookSubscription.findOne({
      walletAddress: String(walletAddress).toLowerCase(),
    });

    if (existing) {
      existing.url = url;
      existing.events = resolvedEvents;
      existing.active = true;
      existing.failureCount = 0;
      await existing.save();
      res.status(200).json({ message: "Webhook updated.", id: existing._id, secret });
      return;
    }

    const sub = new WebhookSubscription({
      walletAddress: String(walletAddress).toLowerCase(),
      url,
      secret,
      events: resolvedEvents,
    });
    await sub.save();
    res.status(201).json({ message: "Webhook registered.", id: sub._id, secret });
    return;
  }

  if (req.method === "DELETE") {
    const { walletAddress } = req.body ?? {};
    if (!walletAddress) {
      res.status(400).json({ error: "walletAddress is required." });
      return;
    }
    await WebhookSubscription.deleteOne({ walletAddress: String(walletAddress).toLowerCase() });
    res.status(200).json({ message: "Webhook removed." });
    return;
  }

  res.status(405).json({ error: "Method not allowed." });
}

export default withObservability(handler, "webhooks");
