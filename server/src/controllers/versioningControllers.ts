import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import PromptVersion from "../models/PromptVersion";
import Purchase from "../models/Purchase";
import User from "../models/User";

export const PostPromptUpdate = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId, walletAddress, content, changeNote } = req.body;

    if (!promptId || !walletAddress || !content) {
      return res.status(400).json({ error: "promptId, walletAddress, and content are required." });
    }

    const user = await User.findOne({ walletAddress: walletAddress.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found." });

    const prompt = await Prompt.findOne({ _id: promptId, owner: user._id });
    if (!prompt) return res.status(403).json({ error: "Prompt not found or not owned by this wallet." });

    const nextVersion = (prompt.currentVersionIndex ?? 1) + 1;

    await PromptVersion.create({
      promptId: String(prompt._id),
      versionIndex: nextVersion,
      content,
      changeNote: changeNote ?? "",
      createdBy: walletAddress.toLowerCase(),
    });

    await Prompt.findByIdAndUpdate(prompt._id, { currentVersionIndex: nextVersion });

    return res.status(201).json({ message: "Version posted.", versionIndex: nextVersion });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const GetPromptVersions = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId } = req.params;
    if (!promptId) return res.status(400).json({ error: "promptId is required." });

    const versions = await PromptVersion.find({ promptId })
      .sort({ versionIndex: -1 })
      .select("-content");

    return res.json(versions);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const RecordPurchase = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId, buyerWallet, txHash } = req.body;

    if (!promptId || !buyerWallet) {
      return res.status(400).json({ error: "promptId and buyerWallet are required." });
    }

    const prompt = await Prompt.findById(promptId);
    if (!prompt) return res.status(404).json({ error: "Prompt not found." });

    const existing = await Purchase.findOne({
      promptId,
      buyerWallet: buyerWallet.toLowerCase(),
    });

    if (existing) {
      return res.status(200).json({ message: "Already purchased.", versionIndex: existing.versionIndex });
    }

    const purchase = await Purchase.create({
      promptId,
      buyerWallet: buyerWallet.toLowerCase(),
      versionIndex: prompt.currentVersionIndex ?? 1,
      txHash: txHash ?? "",
    });

    return res.status(201).json({ message: "Purchase recorded.", versionIndex: purchase.versionIndex });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const GetBuyerVersion = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId, buyerWallet } = req.query;

    if (!promptId || !buyerWallet) {
      return res.status(400).json({ error: "promptId and buyerWallet query params are required." });
    }

    const purchase = await Purchase.findOne({
      promptId: String(promptId),
      buyerWallet: String(buyerWallet).toLowerCase(),
    });

    if (!purchase) {
      return res.status(404).json({ error: "No purchase record found." });
    }

    const version = await PromptVersion.findOne({
      promptId: String(promptId),
      versionIndex: purchase.versionIndex,
    });

    const prompt = await Prompt.findById(promptId).lean();

    return res.json({
      versionIndex: purchase.versionIndex,
      changeNote: version?.changeNote ?? "",
      content: version?.content ?? (prompt as any)?.content ?? null,
      purchasedAt: purchase.createdAt,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
