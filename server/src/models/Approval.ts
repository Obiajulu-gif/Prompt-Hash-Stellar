import mongoose, { Document, Schema } from "mongoose";

export type ApprovalScope = "MAINTENANCE" | "TRANSFER" | "MODERATION" | "ADMIN";

export interface IApproval extends Document {
  actionId: string;
  actionType: string;
  scope: ApprovalScope;
  reason: string;
  actor: string;
  approvedAt: Date;
  expiresAt: Date;
  status: "pending" | "approved" | "rejected";
  rejectedAt?: Date;
  rejectionReason?: string;
  auditTrail?: {
    action: string;
    path: string;
    method: string;
    status: "ALLOWED" | "BLOCKED" | "ELEVATED_CONFIRMED";
    timestamp: Date;
    details?: Record<string, unknown>;
  }[];
}

const approvalSchema = new Schema(
  {
    actionId: { type: String, required: true, index: true },
    actionType: { type: String, required: true, index: true },
    scope: {
      type: String,
      enum: ["MAINTENANCE", "TRANSFER", "MODERATION", "ADMIN"],
      required: true,
    },
    reason: { type: String, required: true },
    actor: { type: String, required: true },
    approvedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectedAt: { type: Date },
    rejectionReason: { type: String },
    auditTrail: [
      {
        action: { type: String, required: true },
        path: { type: String, required: true },
        method: { type: String, required: true },
        status: {
          type: String,
          enum: ["ALLOWED", "BLOCKED", "ELEVATED_CONFIRMED"],
          required: true,
        },
        timestamp: { type: Date, default: Date.now },
        details: { type: Schema.Types.Mixed },
      },
    ],
  },
  { timestamps: true }
);

export const Approval =
  mongoose.models.Approval || mongoose.model<IApproval>("Approval", approvalSchema);