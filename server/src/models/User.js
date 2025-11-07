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
      //   required: true,
      unique: true,
      trim: true,
      minLength: 3,
      maxLength: 30,
    },
    rating: {
      type: Number,
      default: 4,
      min: 1,
      max: 5,
    }
  },
  {
    timestamps: true,
  }
);

// Check if the model exists before creating it
const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
