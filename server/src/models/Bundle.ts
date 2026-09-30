import mongoose, { Schema, Document } from "mongoose";

export interface IPromptSnapshot {
  promptId: string;
  title: string;
  price: number;
  contentHash: string;
  activeAtSnapshot: boolean;
}

export interface IBundle extends Document {
  title: string;
  description: string;
  creatorAddress: string;
  promptIds: string[];
  bundlePrice: number;
  status: "active" | "draft" | "archived";
  snapshots: IPromptSnapshot[];
  createdAt: Date;
  updatedAt: Date;
}

const PromptSnapshotSchema = new Schema(
  {
    promptId: { type: String, required: true },
    title: { type: String, required: true },
    price: { type: Number, required: true },
    contentHash: { type: String, required: true },
    activeAtSnapshot: { type: Boolean, default: true },
  },
  { _id: false },
);

const BundleSchema: Schema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    creatorAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    promptIds: [{ type: String, required: true }],
    bundlePrice: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["active", "draft", "archived"],
      default: "active",
      index: true,
    },
    snapshots: [PromptSnapshotSchema],
  },
  {
    timestamps: true,
  },
);

export const Bundle = mongoose.model<IBundle>("Bundle", BundleSchema);
