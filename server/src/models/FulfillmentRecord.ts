import mongoose from "mongoose";

/**
 * Tracks the delivery / unlock state for each prompt purchase (#335).
 *
 * State machine:
 *   pending → delivered  (normal happy path)
 *   pending → failed     (unlock service error or timeout)
 *   failed  → refund_requested  (buyer requests refund)
 *   refund_requested → refunded (admin/automation resolves dispute on-chain)
 *   refund_requested → rejected (admin rejects the refund request)
 */
export type FulfillmentStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "refund_requested"
  | "refunded"
  | "rejected";

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
        "refund_requested",
        "refunded",
        "rejected",
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
    // Audit trail — every status transition is appended here.
    auditLog: [
      {
        status: String,
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

fulfillmentSchema.index({ promptId: 1, buyerWallet: 1 }, { unique: true });

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
 * delivery attempt was made more than REFUND_TIMEOUT_MS ago.
 */
fulfillmentSchema.methods.isRefundEligible = function (): boolean {
  if (!["pending", "failed"].includes(this.status)) return false;
  const ms = this.msElapsedSinceDelivery();
  if (ms === null) return true; // No delivery ever attempted → eligible
  return ms > REFUND_TIMEOUT_MS;
};

const FulfillmentRecord =
  mongoose.models.FulfillmentRecord ||
  mongoose.model("FulfillmentRecord", fulfillmentSchema);

export default FulfillmentRecord;
