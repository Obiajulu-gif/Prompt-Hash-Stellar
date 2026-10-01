import mongoose from "mongoose";

/**
 * Ownership transfer request (#708).
 *
 * The Soroban contract stores an immutable `Prompt.creator`. There is no
 * on-chain "change creator" operation, so handing a listing to a new
 * operator is a two-phase OFF-CHAIN coordination flow:
 *
 *   phase 1  current owner requests a transfer to a target wallet
 *   phase 2  the target wallet approves (or rejects) the request
 *
 * Approval re-points the off-chain `Prompt.owner` used for listing
 * management, analytics, and payout statements. The on-chain creator of
 * record (and therefore the direct contract license-fee recipient) remains
 * unchanged — see docs/architecture.md and docs/creator-profiles.md.
 */
export const TRANSFER_STATUS = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
] as const;

export type TransferStatus = (typeof TRANSFER_STATUS)[number];

/** Requests auto-expire after this long unless the recipient responds. */
export const TRANSFER_TTL_MS = 72 * 60 * 60 * 1000;

const ownershipTransferSchema = new mongoose.Schema(
  {
    promptId: { type: String, required: true, index: true },
    promptTitle: { type: String, default: "Prompt" },
    fromWallet: { type: String, required: true, lowercase: true, index: true },
    toWallet: { type: String, required: true, lowercase: true, index: true },
    status: { type: String, enum: TRANSFER_STATUS, default: "pending", index: true },
    expiresAt: { type: Date, required: true },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: String, default: null },
    rejectionReason: { type: String, default: "" },
  },
  { timestamps: true },
);

ownershipTransferSchema.index({ toWallet: 1, status: 1, createdAt: -1 });
ownershipTransferSchema.index({ fromWallet: 1, status: 1, createdAt: -1 });

const OwnershipTransfer =
  mongoose.models.OwnershipTransfer ||
  mongoose.model("OwnershipTransfer", ownershipTransferSchema);

export default OwnershipTransfer;