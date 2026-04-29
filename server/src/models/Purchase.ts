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
  },
  { timestamps: true },
);

purchaseSchema.index({ promptId: 1, buyerWallet: 1 });

const Purchase = mongoose.models.Purchase || mongoose.model("Purchase", purchaseSchema);
export default Purchase;
