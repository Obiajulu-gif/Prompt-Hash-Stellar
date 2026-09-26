import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      minLength: 3,
      maxLength: 30,
    },
    // Off-chain profile metadata (#333)
    displayName: {
      type: String,
      trim: true,
      maxLength: 60,
      default: "",
    },
    bio: {
      type: String,
      trim: true,
      maxLength: 500,
      default: "",
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: "",
    },
    socialLinks: {
      twitter: { type: String, trim: true, default: "" },
      github: { type: String, trim: true, default: "" },
      website: { type: String, trim: true, default: "" },
    },
    rating: {
      type: Number,
      default: 4,
      min: 1,
      max: 5,
    },
  },
  {
    timestamps: true,
  },
);

// Check if the model exists before creating it
const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
