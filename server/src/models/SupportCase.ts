import mongoose from "mongoose";

export type SupportCaseType = "purchase_failure" | "content_dispute" | "access_denied" | "report";
export type SupportCaseStatus = "open" | "in_progress" | "resolved" | "closed";
export type CaseResolution = "refunded" | "restored_access" | "dismissed" | "escalated";

export interface CaseNote {
  author: string;
  isPrivate: boolean;
  text: string;
  createdAt: Date;
}

export interface ISupportCase extends mongoose.Document {
  type: SupportCaseType;
  status: SupportCaseStatus;
  purchaseId?: string;
  promptId: string;
  buyerWallet: string;
  creatorWallet?: string;
  title: string;
  description: string;
  notes: CaseNote[];
  evidenceUrls: string[];
  assignedTo?: string;
  resolution?: CaseResolution;
  resolutionNote?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const caseNoteSchema = new mongoose.Schema(
  {
    author: {
      type: String,
      required: true,
      lowercase: true,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    text: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const supportCaseSchema = new mongoose.Schema<ISupportCase>(
  {
    type: {
      type: String,
      enum: ["purchase_failure", "content_dispute", "access_denied", "report"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
      index: true,
    },
    purchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchase",
      index: true,
    },
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    buyerWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    creatorWallet: {
      type: String,
      lowercase: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    notes: {
      type: [caseNoteSchema],
      default: [],
    },
    evidenceUrls: {
      type: [String],
      default: [],
    },
    assignedTo: {
      type: String,
      index: true,
    },
    resolution: {
      type: String,
      enum: ["refunded", "restored_access", "dismissed", "escalated"],
    },
    resolutionNote: {
      type: String,
      maxlength: 500,
    },
    resolvedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

supportCaseSchema.index({ buyerWallet: 1, createdAt: -1 });
supportCaseSchema.index({ promptId: 1, status: 1 });
supportCaseSchema.index({ status: 1, createdAt: -1 });

const SupportCase =
  mongoose.models.SupportCase ||
  mongoose.model<ISupportCase>("SupportCase", supportCaseSchema);

export default SupportCase;
