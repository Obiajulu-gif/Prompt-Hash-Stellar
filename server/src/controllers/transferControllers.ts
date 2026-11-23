import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import User from "../models/User";
import OwnershipTransfer, {
  TRANSFER_TTL_MS,
} from "../models/OwnershipTransfer";
import OwnershipTransferDispute from "../models/OwnershipTransferDispute";
import { ApprovalService } from "../services/approvalService";
import { logger } from "../services/structuredLogger";
import { recordAccessOrOwnershipChange } from "../services/auditTrail";
import { DomainInvariantsService } from "../services/domainInvariants";

/**
 * Ownership transfer controllers (#708, hardened in #1034).
 *
 * Two-phase transfer of OFF-CHAIN listing ownership. See prompts route
 * section and docs/architecture.md for the boundary notes: the on-chain
 * `Prompt.creator` is immutable; this only re-points the indexed
 * `Prompt.owner` used for analytics and payout attribution.
 *
 * Safety invariants (#1034):
 *   - The acting wallet is proven by a wallet session (`requireWalletSession`
 *     on the route), not by an unverified body field.
 *   - A listing has at most one live pending transfer.
 *   - Acceptance is a compare-and-swap on `Prompt.owner`: it only succeeds if
 *     the requester still owns the listing, so a stale request can never move
 *     ownership away from a later owner.
 *   - A transient failure while applying an acceptance returns the request to
 *     `pending` so the recipient can retry until it expires.
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
  const { promptId, fromWallet, toWallet } = req.body;

  if (!promptId || !fromWallet || !toWallet) {
    return res
      .status(400)
      .json({ error: "promptId, fromWallet, and toWallet are required." });
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
  const ownershipInvariant = DomainInvariantsService.assertOwnershipTransition(
    fromWallet,
    currentOwner,
    toWallet,
  );
  if (!ownershipInvariant.passed) {
    return res.status(409).json({ error: ownershipInvariant.message });
  }

  // Settle this listing's lapsed requests first so an expired one never
  // blocks a new request; the promptId index keeps this O(k) for the listing.
  const now = new Date();
  await OwnershipTransfer.updateMany(
    { promptId, status: "pending", expiresAt: { $lte: now } },
    { $set: { status: "expired" } },
  );
  const active = await OwnershipTransfer.findOne({
    promptId,
    status: "pending",
    expiresAt: { $gt: now },
  });
  if (active) {
    return res.status(409).json({
      error: "A pending transfer already exists for this listing. Cancel it before requesting another.",
    });
  }

  // An open ownership dispute holds the listing (#907): no new handoff until a
  // maintainer accepts or rejects it.
  const heldByDispute = await OwnershipTransferDispute.exists({ promptId, status: "open" });
  if (heldByDispute) {
    return res.status(423).json({
      error: "This listing is on hold while an ownership dispute is open.",
    });
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

  await recordAccessOrOwnershipChange({
    action: "ownership_transfer_requested",
    actor: fromWallet.toLowerCase(),
    target: promptId,
    targetType: "prompt",
    promptId,
    walletAddress: fromWallet,
    beforeState: { currentOwner: fromWallet.toLowerCase() },
    afterState: { pendingRecipient: toWallet.toLowerCase(), transferId: transfer._id.toString() },
    reason: "Transfer requested by owner",
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

  const address = String(walletAddress).toLowerCase();

  // Only this wallet's rows: the read path must not sweep the whole collection.
  const expireOverdue = await OwnershipTransfer.updateMany(
    {
      status: "pending",
      expiresAt: { $lte: new Date() },
      $or: [{ toWallet: address }, { fromWallet: address }],
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
  const { walletAddress, decision } = req.body;

  if (!walletAddress || !decision) {
    return res
      .status(400)
      .json({ error: "walletAddress and decision are required." });
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

  // Check for valid maintainer approval before allowing transfer approval
  const approvalCheck = await ApprovalService.checkProtectedActionApproval({
    actionId: transfer._id.toString(),
    actionType: "ownershipTransfer",
    scope: "TRANSFER",
    actor: walletAddress.toLowerCase(),
    actionPath: "/api/prompts/transfers/respond",
  });

  if (approvalCheck.requiresApproval && !approvalCheck.approved) {
    const rejectionReason = approvalCheck.reason || "No valid approval";
    return res.status(403).json({ error: `${rejectionReason}. Maintainer approval required.` });
  }

  if (decision === "approved") {
    // The expiry bound closes the window between the check above and the claim.
    const claimed = await OwnershipTransfer.updateOne(
      { _id: transfer._id, status: "pending", expiresAt: { $gt: new Date() } },
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

    let ownerMoved: boolean;
    try {
      const previousOwner = await User.findOne({ walletAddress: transfer.fromWallet });
      const recipientId = await userIdForWallet(walletAddress);
      // Compare-and-swap: only re-point the listing if the requester still owns it.
      const updatedPrompt = previousOwner
        ? await Prompt.findOneAndUpdate(
            { onChainId: transfer.promptId, owner: previousOwner._id },
            { $set: { owner: recipientId } },
            { new: true },
          )
            .lean()
            .exec()
        : null;
      ownerMoved = Boolean(updatedPrompt);
    } catch (err) {
      // Transient failure: return the request to pending so the recipient can
      // retry before it expires. Nothing was applied to the listing.
      await OwnershipTransfer.updateOne(
        { _id: transfer._id, status: "approved" },
        { $set: { status: "pending", decidedAt: null, decidedBy: null } },
      );
      logger.error("Ownership transfer approval failed", {
        action: "ownershipTransferApprovalFailed",
        promptId: transfer.promptId,
        error: err,
      });
      return res
        .status(500)
        .json({ error: "Failed to apply ownership transfer. Please retry." });
    }

    if (!ownerMoved) {
      // The listing changed hands (or was removed) after the request was made.
      await OwnershipTransfer.updateOne(
        { _id: transfer._id, status: "approved" },
        { $set: { status: "cancelled", rejectionReason: "owner_changed" } },
      );
      logger.warn("Stale ownership transfer cancelled at acceptance", {
        action: "ownershipTransferStale",
        transferId: transfer._id.toString(),
        promptId: transfer.promptId,
      });
      return res.status(409).json({
        error: "The listing owner changed since this transfer was requested. Ask the current owner for a new transfer.",
      });
    }

    await recordAccessOrOwnershipChange({
      action: "ownership_transfer_accepted",
      actor: walletAddress.toLowerCase(),
      target: transfer.promptId,
      targetType: "prompt",
      promptId: transfer.promptId,
      walletAddress,
      beforeState: { previousOwner: transfer.fromWallet },
      afterState: { newOwner: walletAddress.toLowerCase(), transferId: transfer._id.toString() },
      reason: "Ownership transfer accepted by recipient",
    });
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

    await recordAccessOrOwnershipChange({
      action: "ownership_transfer_rejected",
      actor: walletAddress.toLowerCase(),
      target: transfer.promptId,
      targetType: "prompt",
      promptId: transfer.promptId,
      walletAddress,
      beforeState: { pendingRecipient: transfer.toWallet },
      afterState: { status: "rejected" },
      reason: "Ownership transfer rejected by recipient",
    });
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
  const { walletAddress } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required." });
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

  await recordAccessOrOwnershipChange({
    action: "ownership_transfer_cancelled",
    actor: walletAddress.toLowerCase(),
    target: updated?.promptId || transferId,
    targetType: "prompt",
    promptId: updated?.promptId,
    walletAddress,
    beforeState: { pendingRecipient: updated?.toWallet },
    afterState: { status: "cancelled" },
    reason: "Ownership transfer cancelled by sender",
  });

  return res.json(toDto(updated));
};