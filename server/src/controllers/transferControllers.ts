import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import User from "../models/User";
import OwnershipTransfer, {
  TRANSFER_TTL_MS,
} from "../models/OwnershipTransfer";
import { logger } from "../services/structuredLogger";

/**
 * Ownership transfer controllers (#708).
 *
 * Two-phase, wallet-signature-gated transfer of OFF-CHAIN listing ownership.
 * See prompts route section and docs/architecture.md for the boundary notes:
 * the on-chain `Prompt.creator` is immutable; this only re-points the indexed
 * `Prompt.owner` used for analytics and payout attribution.
 */

function isValidStellarAddress(address: string): boolean {
  return /^[A-Z0-9]{56}$/.test(address);
}

async function ownerWalletForPrompt(promptId: string): Promise<string | null> {
  const prompt = await Prompt.findOne({ onChainId: promptId })
    .populate("owner", "walletAddress")
    .lean()
    .exec();
  if (!prompt || !prompt.owner) return null;
  return String((prompt.owner as { walletAddress?: string }).walletAddress ?? "");
}

async function userIdForWallet(walletAddress: string) {
  let user = await User.findOne({ walletAddress: walletAddress.toLowerCase() });
  if (!user) {
    const username = `user${Math.floor(100000 + Math.random() * 900000)}`;
    user = await User.create({ walletAddress: walletAddress.toLowerCase(), username });
  }
  return user._id;
}

function toDto(transfer: any) {
  return {
    _id: transfer._id,
    id: transfer._id.toString(),
    promptId: transfer.promptId,
    promptTitle: transfer.promptTitle,
    fromWallet: transfer.fromWallet,
    toWallet: transfer.toWallet,
    status: transfer.status,
    expiresAt: transfer.expiresAt,
    createdAt: transfer.createdAt,
    decidedAt: transfer.decidedAt ?? null,
    decidedBy: transfer.decidedBy ?? null,
  };
}

export const RequestOwnershipTransfer = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  await connectDb();
  const { promptId, fromWallet, toWallet, signature } = req.body;

  if (!promptId || !fromWallet || !toWallet) {
    return res
      .status(400)
      .json({ error: "promptId, fromWallet, and toWallet are required." });
  }

  if (!signature) {
    return res
      .status(401)
      .json({ error: "Wallet signature required for ownership transfers." });
  }

  if (!isValidStellarAddress(fromWallet) || !isValidStellarAddress(toWallet)) {
    return res
      .status(400)
      .json({ error: "fromWallet and toWallet must be valid Stellar addresses." });
  }

  if (fromWallet.toLowerCase() === toWallet.toLowerCase()) {
    return res
      .status(400)
      .json({ error: "The transfer target must differ from the current owner." });
  }

  const currentOwner = await ownerWalletForPrompt(promptId);
  if (currentOwner === null) {
    return res.status(404).json({ error: "Prompt not found." });
  }
  if (currentOwner !== fromWallet.toLowerCase()) {
    return res
      .status(403)
      .json({ error: "Only the current listing owner may request a transfer." });
  }

  const active = await OwnershipTransfer.findOne({
    promptId,
    toWallet: toWallet.toLowerCase(),
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
  if (active) {
    return res
      .status(409)
      .json({ error: "A pending transfer request already exists for this target." });
  }

  const prompt = await Prompt.findOne({ onChainId: promptId })
    .select("title")
    .lean()
    .exec();

  const transfer = await OwnershipTransfer.create({
    promptId,
    promptTitle: prompt?.title ?? "Prompt",
    fromWallet: fromWallet.toLowerCase(),
    toWallet: toWallet.toLowerCase(),
    status: "pending",
    expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
  });

  logger.info("Ownership transfer requested", {
    action: "ownershipTransferRequested",
    promptId,
    fromWallet: fromWallet.toLowerCase(),
    toWallet: toWallet.toLowerCase(),
  });

  return res.status(201).json(toDto(transfer));
};

export const GetOwnershipTransfers = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  await connectDb();
  const { walletAddress } = req.params;

  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required." });
  }

  const address = walletAddress.toLowerCase();

  const expireOverdue = await OwnershipTransfer.updateMany(
    {
      status: "pending",
      expiresAt: { $lte: new Date() },
    },
    { $set: { status: "expired" } },
  );
  if (expireOverdue.modifiedCount > 0) {
    logger.info("Expired stale ownership transfers", {
      action: "ownershipTransfersExpired",
      count: expireOverdue.modifiedCount,
    });
  }

  const [inbound, outbound] = await Promise.all([
    OwnershipTransfer.find({ toWallet: address, status: "pending" })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec(),
    OwnershipTransfer.find({ fromWallet: address })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec(),
  ]);

  return res.json({
    inbound: inbound.map(toDto),
    outbound: outbound.map(toDto),
  });
};

export const RespondOwnershipTransfer = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  await connectDb();
  const { transferId } = req.params;
  const { walletAddress, decision, signature } = req.body;

  if (!walletAddress || !decision || !signature) {
    return res
      .status(400)
      .json({ error: "walletAddress, decision, and signature are required." });
  }

  if (decision !== "approved" && decision !== "rejected") {
    return res
      .status(400)
      .json({ error: "decision must be either approved or rejected." });
  }

  const transfer = await OwnershipTransfer.findById(transferId);
  if (!transfer) {
    return res.status(404).json({ error: "Transfer not found." });
  }
  if (transfer.toWallet !== walletAddress.toLowerCase()) {
    return res
      .status(403)
      .json({ error: "Only the transfer recipient may respond." });
  }
  if (transfer.status !== "pending") {
    return res.status(409).json({ error: "Transfer is no longer pending." });
  }
  if (transfer.expiresAt.getTime() <= Date.now()) {
    await OwnershipTransfer.updateOne(
      { _id: transfer._id },
      { $set: { status: "expired" } },
    );
    return res.status(410).json({ error: "Transfer request has expired." });
  }

  if (decision === "approved") {
    const claimed = await OwnershipTransfer.updateOne(
      { _id: transfer._id, status: "pending" },
      {
        $set: {
          status: "approved",
          decidedAt: new Date(),
          decidedBy: walletAddress.toLowerCase(),
        },
      },
    );
    if (claimed.modifiedCount !== 1) {
      return res.status(409).json({ error: "Transfer was already decided." });
    }

    try {
      const recipientId = await userIdForWallet(walletAddress);
      const updatedPrompt = await Prompt.findOneAndUpdate(
        { onChainId: transfer.promptId },
        { $set: { owner: recipientId } },
        { new: true },
      ).lean()
        .exec();
      if (!updatedPrompt) {
        logger.error("Ownership transfer approved but prompt missing", {
          action: "ownershipTransferApprovedMissingPrompt",
          promptId: transfer.promptId,
        });
        return res.status(404).json({ error: "Prompt not found." });
      }
    } catch (err) {
      // Roll the approval back so the recipient can retry cleanly.
      await OwnershipTransfer.updateOne(
        { _id: transfer._id, status: "approved" },
        { $set: { status: "rejected", decidedAt: new Date(), rejectionReason: "approval failed" } },
      );
      logger.error("Ownership transfer approval failed", {
        action: "ownershipTransferApprovalFailed",
        promptId: transfer.promptId,
        error: err,
      });
      return res.status(500).json({ error: "Failed to apply ownership transfer." });
    }
  } else {
    const claimed = await OwnershipTransfer.updateOne(
      { _id: transfer._id, status: "pending" },
      {
        $set: {
          status: "rejected",
          decidedAt: new Date(),
          decidedBy: walletAddress.toLowerCase(),
        },
      },
    );
    if (claimed.modifiedCount !== 1) {
      return res.status(409).json({ error: "Transfer was already decided." });
    }
  }

  const updated = await OwnershipTransfer.findById(transferId).lean().exec();
  logger.info("Ownership transfer responded", {
    action: "ownershipTransferResponded",
    transferId,
    promptId: transfer.promptId,
    decision,
    byWallet: walletAddress.toLowerCase(),
  });

  return res.json(toDto(updated));
};

export const CancelOwnershipTransfer = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  await connectDb();
  const { transferId } = req.params;
  const { walletAddress, signature } = req.body;

  if (!walletAddress || !signature) {
    return res
      .status(400)
      .json({ error: "walletAddress and signature are required." });
  }

  const claimed = await OwnershipTransfer.updateOne(
    {
      _id: transferId,
      fromWallet: walletAddress.toLowerCase(),
      status: "pending",
    },
    { $set: { status: "cancelled", decidedAt: new Date(), decidedBy: walletAddress.toLowerCase() } },
  );

  if (claimed.modifiedCount !== 1) {
    return res
      .status(409)
      .json({ error: "Transfer could not be cancelled. It may already be decided." });
  }

  const updated = await OwnershipTransfer.findById(transferId).lean().exec();
  logger.info("Ownership transfer cancelled", {
    action: "ownershipTransferCancelled",
    transferId,
  });

  return res.json(toDto(updated));
};