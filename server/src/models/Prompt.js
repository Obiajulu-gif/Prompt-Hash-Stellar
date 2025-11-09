import mongoose from "mongoose";

const promptSchema = new mongoose.Schema(
  {
    image: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minLength: 3,
      maxLength: 100,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minLength: 10,
    },
    rating: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Marketing",
        "Creative Writing",
        "Programming",
        "Music",
        "Gaming",
        "Other",
      ],
      default: "Other",
    },
  },
  {
    timestamps: true,
  }
);
promptSchema.index({ title: 1 });

// Check if the model exists before creating it
const Prompt = mongoose.models.Prompt || mongoose.model("Prompt", promptSchema);

export default Prompt;
