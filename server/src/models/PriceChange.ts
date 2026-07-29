import mongoose from "mongoose";

const priceChangeSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    previousPrice: {
      type: Number,
      default: null,
    },
    newPrice: {
      type: Number,
      required: true,
    },
    asset: {
      type: String,
      default: "XLM",
    },
    ledgerSeq: {
      type: Number,
      default: null,
    },
    txHash: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

priceChangeSchema.index({ promptId: 1, createdAt: -1 });

const PriceChange = mongoose.models.PriceChange || mongoose.model("PriceChange", priceChangeSchema);
export default PriceChange;