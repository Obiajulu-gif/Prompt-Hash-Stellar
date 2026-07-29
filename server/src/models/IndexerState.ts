import mongoose from "mongoose";

const indexerStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    lastIndexedLedger: { type: Number, default: 0 },
    lastFinalizedLedger: { type: Number, default: 0 }, // Track finality separately for fork recovery
    // Distributed lease fields (#547)
    leaseHolder: { type: String, default: null },   // replica/process identity holding the lease
    leaseExpiresAt: { type: Date, default: null },  // wall-clock expiry; null = no active lease
    fencingToken: { type: Number, default: 0 },     // monotonically increasing; old holders are rejected
  },
  { timestamps: true },
);

export const IndexerState = mongoose.model("IndexerState", indexerStateSchema);
