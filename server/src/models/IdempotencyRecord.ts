import mongoose, { Document, Schema } from "mongoose";

export type IdempotencyRecordStatus = "processing" | "succeeded" | "failed";

export interface IIdempotencyRecord extends Document {
  scope: string;
  key: string;
  requestHash: string;
  status: IdempotencyRecordStatus;
  statusCode: number | null;
  responseBody: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const idempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
    scope: { type: String, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["processing", "succeeded", "failed"],
      required: true,
      default: "processing",
      index: true,
    },
    statusCode: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    // Records are retained for this window so a delayed retry gets the same
    // outcome instead of accidentally creating a second side effect.
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

idempotencyRecordSchema.index({ scope: 1, key: 1 }, { unique: true });

const IdempotencyRecord =
  mongoose.models.IdempotencyRecord ||
  mongoose.model<IIdempotencyRecord>("IdempotencyRecord", idempotencyRecordSchema);

export default IdempotencyRecord;
