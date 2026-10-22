import { Request, Response } from "express";
import mongoose from "mongoose";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import User from "../models/User";
import OwnershipTransfer, { type TransferStatus } from "../models/OwnershipTransfer";
import OwnershipTransferDispute from "../models/OwnershipTransferDispute";
import type { AdminRequest } from "../middleware/adminAuth";
import { recordAccessOrOwnershipChange } from "../services/auditTrail";
import { logger } from "../services/structuredLogger";
import {
  MAX_EVIDENCE_ITEMS,
  checkDisputeEligibility,
  checkDisputeTransition,
  toDisputeView,
  validateDisputeReason,
  validateEvidence,
  type DisputeRecordLike,
  type DisputeStatus,
} from "../services/ownershipTransferDisputes";

/**
 * Ownership transfer dispute controllers (#907).
 *
 * Parties to an approved transfer open a dispute and add evidence; a
 * maintainer accepts (listing handed back to the previous owner) or rejects
 * it. Rules are in services/ownershipTransferDisputes.ts. Every transition is
 * audited.
 *
 * Safety invariants:
 *   - The acting wallet is proven by a wallet session on the route, not by an
 *     unverified body field alone.
 *   - One open dispute per transfer (partial unique index), and every state
 *     change is a compare-and-swap on `status: "open"`, so two concurrent
 *     actions cannot both win.
 *   - Accepting reverts `Prompt.owner` with a compare-and-swap on the current
 *     owner. If the reversal cannot be applied, the dispute goes back to open.
 */

function walletOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const wallet = value.trim();
  return /^G[A-Z2-7]{55}$/i.test(wallet) ? wallet.toLowerCase() : null;
}

async function loadDispute(id: string): Promise<any> {
  if (!mongoose.isValidObjectId(id)) return null;
  return OwnershipTransferDispute.findById(id).lean().exec();
}

function partyRole(dispute: { fromWallet: string; toWallet: string; filerWallet: string }, wallet: string) {
  if (wallet === dispute.fromWallet || wallet === dispute.toWallet) {
    return wallet === dispute.filerWallet ? "filer" : "counterparty";
  }
  return null;
}

export const OpenOwnershipDispute = async (req: Request, res: Response): Promise<Response<any>> => {
  await connectDb();
  const wallet = walletOf(req.body?.walletAddress);
  if (!wallet) return res.status(400).json({ error: "A valid walletAddress is required." });

  const transferId = String(req.params.transferId);
  if (!mongoose.isValidObjectId(transferId)) return res.status(404).json({ error: "Transfer not found." });
  const transfer = await OwnershipTransfer.findById(transferId).lean().exec();
  if (!transfer) return res.status(404).json({ error: "Transfer not found." });

  const reason = validateDisputeReason(req.body?.reason);
  if (!reason.ok) return res.status(reason.status).json({ error: reason.error });

  const hasOpenDispute = Boolean(await OwnershipTransferDispute.exists({ transferId, status: "open" }));
  const eligible = checkDisputeEligibility({
    transfer: {
      status: transfer.status as TransferStatus,
      fromWallet: transfer.fromWallet,
      toWallet: transfer.toWallet,
      decidedAt: transfer.decidedAt,
    },
    filerWallet: wallet,
    hasOpenDispute,
    now: Date.now(),
  });
  if (!eligible.ok) return res.status(eligible.status).json({ error: eligible.error });

  let dispute;
  try {
    dispute = await OwnershipTransferDispute.create({
      transferId,
      promptId: transfer.promptId,
      fromWallet: transfer.fromWallet,
      toWallet: transfer.toWallet,
      filerWallet: wallet,
      status: "open",
      reason: reason.value,
    });
  } catch (err) {
    // The partial unique index rejects a second concurrent open dispute.
    if ((err as { code?: number }).code === 11000) {
      return res.status(409).json({ error: "This transfer already has an open dispute." });
    }
    throw err;
  }

  logger.info("Ownership dispute opened", { action: "ownershipDisputeOpened", transferId, promptId: transfer.promptId });
  await recordAccessOrOwnershipChange({
    action: "ownership_dispute_opened",
    actor: wallet,
    target: transferId,
    targetType: "prompt",
    promptId: transfer.promptId,
    walletAddress: wallet,
    afterState: { disputeId: String(dispute._id), status: "open", holdActive: true },
    reason: reason.value,
  });

  return res.status(201).json(toDisputeView(dispute.toObject(), "party"));
};

export const AddOwnershipDisputeEvidence = async (req: Request, res: Response): Promise<Response<any>> => {
  await connectDb();
  const wallet = walletOf(req.body?.walletAddress);
  if (!wallet) return res.status(400).json({ error: "A valid walletAddress is required." });

  const dispute = await loadDispute(String(req.params.disputeId));
  if (!dispute) return res.status(404).json({ error: "Dispute not found." });
  const role = partyRole(dispute, wallet);
  if (!role) return res.status(403).json({ error: "Only a party to this transfer can add evidence." });
  if (dispute.status !== "open") return res.status(409).json({ error: `Dispute is already ${dispute.status}.` });

  const evidence = validateEvidence(
    { note: req.body?.note, evidenceUrl: req.body?.evidenceUrl },
    dispute.evidence.length,
  );
  if (!evidence.ok) return res.status(evidence.status).json({ error: evidence.error });

  // The filter re-checks the state and the item cap, so evidence cannot land
  // after a resolution or past the limit.
  const written = await OwnershipTransferDispute.updateOne(
    { _id: dispute._id, status: "open", [`evidence.${MAX_EVIDENCE_ITEMS - 1}`]: { $exists: false } },
    {
      $push: {
        evidence: {
          wallet,
          role,
          note: evidence.note,
          evidenceUrl: evidence.evidenceUrl,
          submittedAt: new Date(),
        },
      },
    },
  );
  if (written.modifiedCount === 0) {
    return res.status(409).json({ error: "The dispute was resolved or has reached its evidence limit." });
  }

  await recordAccessOrOwnershipChange({
    action: "ownership_dispute_evidence_added",
    actor: wallet,
    target: String(dispute.transferId),
    targetType: "prompt",
    promptId: dispute.promptId,
    walletAddress: wallet,
    afterState: { disputeId: String(dispute._id), evidenceCount: dispute.evidence.length + 1 },
  });

  const updated = await loadDispute(String(dispute._id));
  return res.status(201).json(toDisputeView(updated as DisputeRecordLike, "party"));
};

export const WithdrawOwnershipDispute = async (req: Request, res: Response): Promise<Response<any>> => {
  await connectDb();
  const wallet = walletOf(req.body?.walletAddress);
  if (!wallet) return res.status(400).json({ error: "A valid walletAddress is required." });

  const dispute = await loadDispute(String(req.params.disputeId));
  if (!dispute) return res.status(404).json({ error: "Dispute not found." });
  if (wallet !== dispute.filerWallet) {
    return res.status(403).json({ error: "Only the dispute filer can withdraw a dispute." });
  }
  const transition = checkDisputeTransition(dispute.status as DisputeStatus, "withdraw", "filer");
  if (!transition.ok) return res.status(transition.status).json({ error: transition.error });

  const claimed = await OwnershipTransferDispute.updateOne(
    { _id: dispute._id, status: "open" },
    { $set: { status: "withdrawn", resolvedBy: wallet, resolvedAt: new Date() } },
  );
  if (claimed.modifiedCount === 0) return res.status(409).json({ error: "Dispute is already resolved." });

  await recordAccessOrOwnershipChange({
    action: "ownership_dispute_withdrawn",
    actor: wallet,
    target: String(dispute.transferId),
    targetType: "prompt",
    promptId: dispute.promptId,
    walletAddress: wallet,
    beforeState: { status: "open" },
    afterState: { disputeId: String(dispute._id), status: "withdrawn" },
  });

  const updated = await loadDispute(String(dispute._id));
  return res.json(toDisputeView(updated as DisputeRecordLike, "party"));
};

export const GetOwnershipDispute = async (req: Request, res: Response): Promise<Response<any>> => {
  await connectDb();
  const wallet = walletOf(req.query?.walletAddress);
  if (!wallet) return res.status(400).json({ error: "A valid walletAddress is required." });

  const dispute = await loadDispute(String(req.params.disputeId));
  if (!dispute) return res.status(404).json({ error: "Dispute not found." });
  if (!partyRole(dispute, wallet)) {
    return res.status(403).json({ error: "Only a party to this transfer can view the dispute." });
  }
  return res.json(toDisputeView(dispute as DisputeRecordLike, "party"));
};

/**
 * Hands the listing back to the transfer's original owner. Succeeds only if * the recipient still owns it, so a later owner is never moved.
 */
async function revertListingOwnership(dispute: { promptId: string; fromWallet: string; toWallet: string }) {
  const [fromUser, toUser] = await Promise.all([
    User.findOne({ walletAddress: dispute.fromWallet }).select("_id").lean().exec(),
    User.findOne({ walletAddress: dispute.toWallet }).select("_id").lean().exec(),
  ]);
  if (!fromUser || !toUser) {
    throw new Error("Both wallets need an account before ownership can be reverted.");
  }
  const result = await Prompt.updateOne(
    { onChainId: dispute.promptId, owner: toUser._id },
    { $set: { owner: fromUser._id } },
  );
  if (result.modifiedCount === 0) {
    throw new Error("The listing is no longer owned by the transfer recipient, so the reversal was not applied.");
  }
}

export const ResolveOwnershipDispute = async (req: AdminRequest, res: Response): Promise<Response<any>> => {
  await connectDb();
  const action = req.body?.action;
  if (action !== "accept" && action !== "reject") {
    return res.status(400).json({ error: "action must be accept or reject." });
  }
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
  if (!notes) return res.status(400).json({ error: "Resolution notes are required." });

  const dispute = await loadDispute(String(req.params.disputeId));
  if (!dispute) return res.status(404).json({ error: "Dispute not found." });

  const actor = req.admin!.sub;
  const decision = checkDisputeTransition(dispute.status as DisputeStatus, action, "maintainer");
  if (!decision.ok) return res.status(decision.status).json({ error: decision.error });

  // Claim the decision first: a concurrent resolver loses this compare-and-swap
  // before any ownership change is attempted.
  const claimed = await OwnershipTransferDispute.updateOne(
    { _id: dispute._id, status: "open" },
    {
      $set: {
        status: action === "accept" ? "accepted" : "rejected",
        resolvedBy: actor,
        resolvedAt: new Date(),
        resolutionNotes: notes,
      },
    },
  );
  if (claimed.modifiedCount === 0) return res.status(409).json({ error: "Dispute is already resolved." });

  if (action === "accept") {
    try {
      await revertListingOwnership(dispute);
    } catch (err) {
      // Put the dispute back on hold so the listing is not left half-reverted.
      await OwnershipTransferDispute.updateOne(
        { _id: dispute._id, status: "accepted" },
        { $set: { status: "open", resolvedBy: null, resolvedAt: null, resolutionNotes: null } },
      );
      const message = err instanceof Error ? err.message : String(err);
      return res.status(409).json({ error: message });
    }
  }

  await recordAccessOrOwnershipChange({
    action: action === "accept" ? "ownership_dispute_accepted" : "ownership_dispute_rejected",
    actor: actor,
    target: String(dispute.transferId),
    targetType: "prompt",
    promptId: dispute.promptId,
    beforeState: { status: "open", currentOwner: action === "accept" ? dispute.toWallet : null },
    afterState: {
      disputeId: String(dispute._id),
      status: action === "accept" ? "accepted" : "rejected",
      currentOwner: action === "accept" ? dispute.fromWallet : null,
    },
    reason: notes,
  });

  const updated = await loadDispute(String(dispute._id));
  return res.json(toDisputeView(updated as DisputeRecordLike, "maintainer"));
};
