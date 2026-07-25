import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Purchase from "../models/Purchase";
import Prompt from "../models/Prompt";
import User from "../models/User";

interface PromptLite {
  _id: unknown;
  onChainId?: string | null;
  title?: string;
  image?: string;
  price?: number;
}

interface CreatorPromptLite extends PromptLite {
  salesCount?: number;
}

/**
 * Returns the licensing/purchase transaction history for a buyer wallet.
 *
 * Each entry pairs an on-chain purchase record (amount, transaction hash and
 * timestamp) with the prompt it unlocked, so the profile page can render a
 * verifiable history that links back to a Stellar block explorer.
 */
export const GetPurchaseTransactions = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required." });
    }

    const purchases = await Purchase.find({
      buyerWallet: walletAddress.toLowerCase(),
    })
      .sort({ createdAt: -1 })
      .lean();

    if (purchases.length === 0) {
      return res.json({ transactions: [] });
    }

    // Resolve the related prompts in a single query. Purchase records reference
    // a prompt by its on-chain id, but older rows may carry the Mongo _id, so we
    // index by both to remain backward compatible.
    const promptIds = [...new Set(purchases.map((p) => String(p.promptId)))];
    const prompts = (await Prompt.find({
      $or: [{ onChainId: { $in: promptIds } }, { _id: { $in: promptIds } }],
    })
      .select("onChainId title image price")
      .lean()) as unknown as PromptLite[];

    const promptByKey = new Map<string, PromptLite>();
    for (const prompt of prompts) {
      if (prompt.onChainId) promptByKey.set(String(prompt.onChainId), prompt);
      promptByKey.set(String(prompt._id), prompt);
    }

    const transactions = purchases.map((purchase) => {
      const prompt = promptByKey.get(String(purchase.promptId));
      return {
        id: String(purchase._id),
        promptId: String(purchase.promptId),
        promptTitle: prompt?.title ?? "Prompt",
        promptImage: prompt?.image ?? "",
        amountXlm: prompt?.price ?? null,
        versionIndex: purchase.versionIndex,
        txHash: purchase.txHash ?? "",
        createdAt: purchase.createdAt,
      };
    });

    return res.json({ transactions });
  } catch (err) {
    console.error("Get purchase transactions error:", err);
    return res.status(500).json({
      error: (err as Error).message || "Failed to fetch purchase transactions",
    });
  }
};

/**
 * Returns creator sales analytics for the trailing 30-day window.
 *
 * The dashboard uses this to render a real sales/revenue trend instead of
 * synthetic placeholder data. Prompt ownership is resolved from the connected
 * wallet through the indexed User/Prompt collections, while purchases are
 * grouped by day from the off-chain Purchase mirror.
 */
export const GetCreatorSalesAnalytics = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required." });
    }

    const user = await User.findOne({
      walletAddress: walletAddress.toLowerCase(),
    }).select("_id");

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const prompts = (await Prompt.find({ owner: user._id })
      .select("_id onChainId title price salesCount")
      .lean()) as unknown as CreatorPromptLite[];

    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 29);

    const dailyEntries = new Map<
      string,
      { date: string; unitsSold: number; revenueXlm: number }
    >();

    for (let index = 0; index < 30; index += 1) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + index);
      const date = day.toISOString().slice(0, 10);
      dailyEntries.set(date, {
        date,
        unitsSold: 0,
        revenueXlm: 0,
      });
    }

    if (prompts.length === 0) {
      return res.json({
        dailySales: [...dailyEntries.values()],
      });
    }

    const promptByKey = new Map<string, CreatorPromptLite>();
    for (const prompt of prompts) {
      promptByKey.set(String(prompt._id), prompt);
      if (prompt.onChainId) {
        promptByKey.set(String(prompt.onChainId), prompt);
      }
    }

    const promptIds = [...promptByKey.keys()];
    const purchases = await Purchase.find({
      promptId: { $in: promptIds },
      createdAt: { $gte: start },
    })
      .select("promptId createdAt")
      .lean();

    for (const purchase of purchases) {
      const prompt = promptByKey.get(String(purchase.promptId));
      const createdAt = new Date(purchase.createdAt);
      const date = createdAt.toISOString().slice(0, 10);
      const bucket = dailyEntries.get(date);

      if (!prompt || !bucket) continue;

      bucket.unitsSold += 1;
      bucket.revenueXlm += typeof prompt.price === "number" ? prompt.price : 0;
    }

    return res.json({
      dailySales: [...dailyEntries.values()],
    });
  } catch (err) {
    console.error("Get creator sales analytics error:", err);
    return res.status(500).json({
      error: (err as Error).message || "Failed to fetch creator sales analytics",
    });
  }
};
