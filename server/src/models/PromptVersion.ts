import mongoose from "mongoose";

const promptVersionSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    versionIndex: {
      type: Number,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    changeNote: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: String,
      required: true,
      lowercase: true,
    },
  },
  { timestamps: true },
);

promptVersionSchema.index({ promptId: 1, versionIndex: 1 }, { unique: true });

const PromptVersion =
  mongoose.models.PromptVersion ||
  mongoose.model("PromptVersion", promptVersionSchema);

export default PromptVersion;
