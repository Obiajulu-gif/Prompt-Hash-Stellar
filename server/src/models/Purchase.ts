import mongoose from "mongoose";

const purchaseSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    buyerWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    versionIndex: {
      type: Number,
      required: true,
    },
    txHash: {
      type: String,
      default: "",
    },
    saved: {
      type: Boolean,
      default: false,
      index: true,
    },
    status: {
      type: String,
      // "revoked": access withdrawn after purchase; the buyer library (#784)
      // and purchase receipts surface it as a distinct entitlement state.
      enum: ["purchased", "disputed", "resolved", "revoked"],
      default: "purchased",
      index: true,
    },
    disputeResolution: {
      type: String,
      enum: ["refunded", "rejected"],
    },
    // Versioned licensing (#759) — the prompt-level license version active
    // when this purchase happened. The full frozen terms live in the
    // LicenseSnapshot collection; legacy purchases (pre-#759) have version 1.
    licenseVersionIndex: {
      type: Number,
      default: 1,
      min: 1,
    },
    licenseSnapshotId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

purchaseSchema.index({ promptId: 1, buyerWallet: 1 });
// Buyer library listing, newest purchase first (#784).
purchaseSchema.index({ buyerWallet: 1, createdAt: -1 });

const Purchase = mongoose.models.Purchase || mongoose.model("Purchase", purchaseSchema);
export default Purchase;
