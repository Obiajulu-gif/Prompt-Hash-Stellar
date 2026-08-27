import mongoose, { Document, Schema } from "mongoose";

export interface IQuarantinedEvent extends Document {
  eventId: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topic: string;
  rawTopic?: any;
  rawValue?: any;
  rawXdr?: string;
  reason: "unknown_type" | "unsupported_version" | "malformed_xdr" | "decoder_error" | "processing_error";
  status: "quarantined" | "replayed" | "discarded";
  errorDetails?: string;
  quarantinedAt: Date;
  replayedAt?: Date;
  retryCount: number;
}

const quarantinedEventSchema = new Schema<IQuarantinedEvent>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    ledger: { type: Number, required: true, index: true },
    txHash: { type: String, default: "" },
    contractId: { type: String, required: true },
    topic: { type: String, required: true, index: true },
    rawTopic: { type: Schema.Types.Mixed },
    rawValue: { type: Schema.Types.Mixed },
    rawXdr: { type: String },
    reason: {
      type: String,
      enum: ["unknown_type", "unsupported_version", "malformed_xdr", "decoder_error", "processing_error"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["quarantined", "replayed", "discarded"],
      default: "quarantined",
      index: true,
    },
    errorDetails: { type: String },
    quarantinedAt: { type: Date, default: Date.now },
    replayedAt: { type: Date },
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const QuarantinedEvent =
  mongoose.models.QuarantinedEvent ||
  mongoose.model<IQuarantinedEvent>("QuarantinedEvent", quarantinedEventSchema);

export default QuarantinedEvent;
