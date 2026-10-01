import mongoose from "mongoose";

/**
 * Tracks the delivery / unlock state for each prompt purchase (#335) and the
 * disputed-purchase resolution workflow built on top of it (#755).
 *
 * State machine (transitions are applied by services/purchaseDisputes.ts):
 *   pending → delivered  (normal happy path)
 *   pending → failed     (paid, but the unlock failed — an open dispute)
 *   failed  → retrying   (maintainer re-arms the unlock for the buyer)
 *   retrying → delivered (buyer's next unlock succeeds)
 *   retrying → failed    (buyer's next unlock fails again)
 *   failed | retrying → refund_requested (buyer request, or stale escalation)
 *   failed | retrying | refund_requested → refunded (maintainer approves)
 *   refund_requested → rejected (maintainer rejects the refund request)
 *   failed | retrying | refund_requested | rejected → resolved (closed with notes)
 */
export type FulfillmentStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "retrying"
  | "refund_requested"
  | "refunded"
  | "rejected"
  | "resolved";

const fulfillmentSchema = new mongoose.Schema(
  {
    promptId: { type: String, required: true, index: true },
    buyerWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    txHash: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "pending",
        "delivered",
        "failed",
        "retrying",
        "refund_requested",
        "refunded",
        "rejected",
        "resolved",
      ] as FulfillmentStatus[],
      default: "pending",
      index: true,
    },
    failureReason: { type: String, default: "" },
    refundReason: { type: String, default: "" },
    // Timestamp when delivery was attempted (used to determine auto-refund
    // eligibility after a configurable timeout).
    deliveryAttemptedAt: { type: Date, default: null },
    // On-chain dispute transaction hash (filled when the buyer opens a
    // dispute via the smart contract).
    disputeTxHash: { type: String, default: "" },
    // On-chain resolution transaction hash.
    resolutionTxHash: { type: String, default: "" },
    // Dispute bookkeeping (#755).
    unlockAttempts: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    resolutionNotes: { type: String, default: "" },
    resolvedBy: { type: String, default: "" },
    lastTransitionAt: { type: Date, default: null },
    // Keys of transitions already applied, so a redelivered webhook, indexer
    // replay, or double-clicked admin action is a no-op. Bounded on write.
    processedEventKeys: { type: [String], default: [] },
    // Audit trail — every status transition is appended here.
    auditLog: [
      {
        status: String,
        event: String,
        actor: String,
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

fulfillmentSchema.index({ promptId: 1, buyerWallet: 1 }, { unique: true });
// Maintainer queue and stale-dispute sweep (#755).
fulfillmentSchema.index({ status: 1, lastTransitionAt: 1 });

// Auto-refund timeout (default: 10 minutes).
const REFUND_TIMEOUT_MS =
  parseInt(process.env.FULFILLMENT_TIMEOUT_MS ?? "600000", 10);

/**
 * Returns the number of milliseconds since delivery was attempted, or `null`
 * if no attempt has been recorded yet.
 */
fulfillmentSchema.methods.msElapsedSinceDelivery = function (): number | null {
  if (!this.deliveryAttemptedAt) return null;
  return Date.now() - (this.deliveryAttemptedAt as Date).getTime();
};

/**
 * Returns true if the fulfillment is in `pending` or `failed` state AND the
 * delivery attempt was made more than REFUND_TIMEOUT_MS ago. A maintainer-
 * scheduled retry never blocks the buyer from asking for a refund instead.
 */
fulfillmentSchema.methods.isRefundEligible = function (): boolean {
  if (this.status === "retrying") return true;
  if (!["pending", "failed"].includes(this.status)) return false;
  const ms = this.msElapsedSinceDelivery();
  if (ms === null) return true; // No delivery ever attempted → eligible
  return ms > REFUND_TIMEOUT_MS;
};

const FulfillmentRecord =
  mongoose.models.FulfillmentRecord ||
  mongoose.model("FulfillmentRecord", fulfillmentSchema);

export default FulfillmentRecord;
