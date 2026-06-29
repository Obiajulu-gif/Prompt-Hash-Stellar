import mongoose from "mongoose";

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
  },
  {
    timestamps: true,
  }
);

// Index for finding reports by prompt
reportSchema.index({ promptId: 1, createdAt: -1 });

const Report = mongoose.models.Report || mongoose.model("Report", reportSchema);

export default Report;
