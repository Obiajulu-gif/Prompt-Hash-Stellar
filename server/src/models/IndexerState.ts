import mongoose from "mongoose";

const indexerStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    lastIndexedLedger: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const IndexerState = mongoose.model("IndexerState", indexerStateSchema);
