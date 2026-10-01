import mongoose, { Schema, Document } from "mongoose";

export type EntitlementStatus = "active" | "refunded" | "revoked" | "expired";

export interface IEntitlement extends Document {
  userAddress: string;
  promptId: string;
  status: EntitlementStatus;
  grantedAt: Date;
  revokedAt?: Date;
  revocationReason?: string;
  sourceOfTruthRef: string;
  createdAt: Date;
  updatedAt: Date;
}

const EntitlementSchema: Schema = new Schema(
  {
    userAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["active", "refunded", "revoked", "expired"],
      default: "active",
      index: true,
    },
    grantedAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
    },
    revocationReason: {
      type: String,
    },
    sourceOfTruthRef: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index to quickly look up access entitlement for a buyer and prompt
EntitlementSchema.index({ userAddress: 1, promptId: 1 }, { unique: true });

export const Entitlement = mongoose.model<IEntitlement>("Entitlement", EntitlementSchema);
