import mongoose from "mongoose";

const reportEvidenceSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    kind: { type: String, enum: ["image", "pdf", "link", "text"], required: true },
    addedBy: { type: String, default: "reporter" },
  },
  { _id: false },
);

const reportSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    reporterAddress: {
      type: String,
      required: true,
      lowercase: true,
    },
    reason: {
      type: String,
      enum: ["quality-issue", "misleading-content", "plagiarism", "harmful-content", "copyright", "other"],
      required: true,
    },
    description: {
      type: String,
      maxlength: 500,
    },
    evidence: {
      type: [reportEvidenceSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "investigating", "resolved", "dismissed"],
      default: "pending",
      index: true,
    },
    adminNotes: {
      type: String,
      default: "",
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
      index: true,
    },
    retentionHold: {
      type: Boolean,
      default: false,
      index: true,
    },
    retentionHoldReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for finding reports by prompt
reportSchema.index({ promptId: 1, createdAt: -1 });
reportSchema.index({
  status: 1,
  resolvedAt: 1,
  updatedAt: 1,
  archivedAt: 1,
  retentionHold: 1,
});

const Report = mongoose.models.Report || mongoose.model("Report", reportSchema);

export default Report;
