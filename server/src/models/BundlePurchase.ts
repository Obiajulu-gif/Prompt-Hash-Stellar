import mongoose, { Schema, Document } from "mongoose";

export interface IBundleItemEntitlement {
  promptId: string;
  entitlementId?: string;
  status: "granted" | "failed";
  errorReason?: string;
}

export interface IBundlePurchase extends Document {
  buyerAddress: string;
  bundleId: string;
  bundlePricePaid: number;
  txHash: string;
  promptSnapshot: Array<{ promptId: string; title: string; price: number }>;
  entitlements: IBundleItemEntitlement[];
  recoveryStatus: "complete" | "partial_failure" | "recovered";
  createdAt: Date;
  updatedAt: Date;
}

const BundleItemEntitlementSchema = new Schema(
  {
    promptId: { type: String, required: true },
    entitlementId: { type: String },
    status: { type: String, enum: ["granted", "failed"], required: true },
    errorReason: { type: String },
  },
  { _id: false },
);

const BundlePurchaseSchema: Schema = new Schema(
  {
    buyerAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    bundleId: { type: String, required: true, index: true },
    bundlePricePaid: { type: Number, required: true },
    txHash: { type: String, required: true, unique: true },
    promptSnapshot: [
      {
        promptId: { type: String, required: true },
        title: { type: String, required: true },
        price: { type: Number, required: true },
      },
    ],
    entitlements: [BundleItemEntitlementSchema],
    recoveryStatus: {
      type: String,
      enum: ["complete", "partial_failure", "recovered"],
      default: "complete",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const BundlePurchase = mongoose.model<IBundlePurchase>("BundlePurchase", BundlePurchaseSchema);
