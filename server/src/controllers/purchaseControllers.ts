import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Purchase from "../models/Purchase";
import Prompt from "../models/Prompt";

interface PromptLite {
  _id: unknown;
  onChainId?: string | null;
  title?: string;
  image?: string;
  price?: number;
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
