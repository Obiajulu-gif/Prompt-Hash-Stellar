import mongoose from "mongoose";

const processedEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    ledger: { type: Number, required: true },
    txHash: { type: String, required: true },
    contractId: { type: String, required: true },
    topic: { type: String, required: true },
  },
  { timestamps: true }
);

const ProcessedEvent =
  mongoose.models.ProcessedEvent ||
  mongoose.model("ProcessedEvent", processedEventSchema);

export default ProcessedEvent;
