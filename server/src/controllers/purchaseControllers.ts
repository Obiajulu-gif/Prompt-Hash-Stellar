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

/**
 * Generates a creator's payout statement for prompt sales.
 *
 * Includes sale date, prompt, buyer address, gross amount, platform fee, and
 * creator net amount. Supports optional `startDate` and `endDate` query filters
 * and outputs CSV format when requested.
 */
export const GetCreatorPayoutStatement = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    const { startDate, endDate, format } = req.query;

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
      .select("_id onChainId title price")
      .lean()) as unknown as PromptLite[];

    if (prompts.length === 0) {
      if (format === "csv" || req.headers.accept?.includes("text/csv")) {
        const csvHeader = `"Sale Date","Prompt Title","Prompt ID","Buyer Address","Gross Amount (XLM)","Platform Fee (XLM)","Creator Amount (XLM)","Transaction Hash"\n`;
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="payout-statement-${walletAddress.slice(0, 8)}.csv"`,
        );
        return res.status(200).send(csvHeader);
      }
      return res.json({ statement: [] });
    }

    const promptByKey = new Map<string, PromptLite>();
    for (const prompt of prompts) {
      promptByKey.set(String(prompt._id), prompt);
      if (prompt.onChainId) {
        promptByKey.set(String(prompt.onChainId), prompt);
      }
    }

    const promptIds = [...promptByKey.keys()];

    const query: Record<string, unknown> = {
      promptId: { $in: promptIds },
    };

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) {
        const start = new Date(startDate as string);
        if (!isNaN(start.getTime())) {
          dateFilter.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate as string);
        if (!isNaN(end.getTime())) {
          if (typeof endDate === "string" && endDate.length === 10) {
            end.setUTCHours(23, 59, 59, 999);
          }
          dateFilter.$lte = end;
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        query.createdAt = dateFilter;
      }
    }

    const purchases = await Purchase.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const PLATFORM_FEE_RATE = 0.05;

    const statement = purchases.map((purchase) => {
      const prompt = promptByKey.get(String(purchase.promptId));
      const grossAmount = typeof prompt?.price === "number" ? prompt.price : 0;
      const platformFee = Number((grossAmount * PLATFORM_FEE_RATE).toFixed(4));
      const creatorAmount = Number((grossAmount - platformFee).toFixed(4));

      return {
        id: String(purchase._id),
        saleDate: purchase.createdAt
          ? new Date(purchase.createdAt).toISOString()
          : new Date().toISOString(),
        promptTitle: prompt?.title ?? "Prompt",
        promptId: prompt?.onChainId ?? String(purchase.promptId),
        buyerAddress: purchase.buyerWallet,
        grossAmount,
        platformFee,
        creatorAmount,
        txHash: purchase.txHash ?? "",
      };
    });

    if (format === "csv" || req.headers.accept?.includes("text/csv")) {
      const csvHeader = `"Sale Date","Prompt Title","Prompt ID","Buyer Address","Gross Amount (XLM)","Platform Fee (XLM)","Creator Amount (XLM)","Transaction Hash"\n`;
      const csvRows = statement
        .map((row) =>
          [
            `"${row.saleDate}"`,
            `"${row.promptTitle.replace(/"/g, '""')}"`,
            `"${row.promptId}"`,
            `"${row.buyerAddress}"`,
            row.grossAmount,
            row.platformFee,
            row.creatorAmount,
            `"${row.txHash}"`,
          ].join(","),
        )
        .join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="payout-statement-${walletAddress.slice(0, 8)}.csv"`,
      );
      return res.status(200).send(csvHeader + csvRows);
    }

    return res.json({ statement });
  } catch (err) {
    console.error("Get creator payout statement error:", err);
    return res.status(500).json({
      error: (err as Error).message || "Failed to fetch creator payout statement",
    });
  }
};

/**
 * Returns summary metrics of content integrity rechecks across all prompt listings.
 */
export const GetIntegrityReport = async (
  _req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { runContentIntegrityCheckAll } = await import(
      "../services/contentIntegrity"
    );
    const report = await runContentIntegrityCheckAll();
    return res.json(report);
  } catch (err) {
    console.error("Get integrity report error:", err);
    return res.status(500).json({
      error: (err as Error).message || "Failed to generate integrity report",
    });
  }
};

/**
 * Triggers a manual or scheduled content integrity check for a specific prompt
 * or batch audit sweep.
 */
export const TriggerIntegrityCheck = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { verifyPromptIntegrity, runContentIntegrityCheckAll } = await import(
      "../services/contentIntegrity"
    );
    const { promptId } = req.body || {};

    if (promptId) {
      const result = await verifyPromptIntegrity(String(promptId));
      return res.json({ result });
    }

    const report = await runContentIntegrityCheckAll();
    return res.json({ report });
  } catch (err) {
    console.error("Trigger integrity check error:", err);
    return res.status(500).json({
      error: (err as Error).message || "Failed to trigger integrity check",
    });
  }
};

