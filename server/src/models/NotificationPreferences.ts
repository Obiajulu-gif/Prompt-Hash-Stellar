/**
 * Per-user notification preferences (#notification-center).
 *
 * Stored separately from the Notification document so preferences can be
 * read and updated without touching the notification collection, and so they
 * survive a `clearAll` action on the notification list.
 *
 * `mutedTypes` lists the NotificationType values the user does not want to
 * receive. An empty array means all types are active (the default).
 */

import mongoose from "mongoose";
import { NOTIFICATION_TYPES } from "./Notification";

const notificationPreferencesSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    mutedTypes: {
      type: [String],
      enum: NOTIFICATION_TYPES,
      default: [],
    },
    emailEnabled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

const NotificationPreferences =
  mongoose.models.NotificationPreferences ||
  mongoose.model("NotificationPreferences", notificationPreferencesSchema);

export default NotificationPreferences;
