import mongoose from "mongoose";

export interface IUserPreferences extends mongoose.Document {
  userWallet: string;
  hiddenPrompts: string[];
  hiddenCreators: string[];
  preferenceResetAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userPreferencesSchema = new mongoose.Schema<IUserPreferences>(
  {
    userWallet: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    hiddenPrompts: {
      type: [String],
      default: [],
      index: true,
    },
    hiddenCreators: {
      type: [String],
      default: [],
      index: true,
    },
    preferenceResetAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

const UserPreferences =
  mongoose.models.UserPreferences ||
  mongoose.model<IUserPreferences>("UserPreferences", userPreferencesSchema);

export default UserPreferences;
