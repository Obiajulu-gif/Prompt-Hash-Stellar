import mongoose from "mongoose";

const indexerStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    lastIndexedLedger: { type: Number, default: 0 },
    lastFinalizedLedger: { type: Number, default: 0 }, // Track finality separately for fork recovery
  },
  { timestamps: true },
);

export const IndexerState = mongoose.model("IndexerState", indexerStateSchema);
