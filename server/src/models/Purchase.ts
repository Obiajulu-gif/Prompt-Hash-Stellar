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
      enum: ["purchased", "disputed", "resolved", "refunded"],
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

const Purchase = mongoose.models.Purchase || mongoose.model("Purchase", purchaseSchema);
export default Purchase;
