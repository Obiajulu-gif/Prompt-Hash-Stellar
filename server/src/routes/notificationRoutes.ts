/**
 * Notification routes — in-app notification center (#notification-center).
 *
 * All routes are wallet-scoped. The walletAddress path parameter identifies
 * the recipient; no additional auth middleware is applied here because the
 * server is a read-through cache and notifications contain no sensitive data.
 * Production deployments may add wallet-signature verification ahead of these
 * routes via requireWalletAuth if needed.
 */

import express from "express";
import {
  GetNotifications,
  GetUnreadCount,
  MarkAsRead,
  ClearNotifications,
  GetNotificationPreferences,
  UpdateNotificationPreferences,
} from "../controllers/notificationControllers";

export const notificationRouter = express.Router();

// List notifications (paginated; supports ?unread=true and ?type=<type>)
notificationRouter.get("/:walletAddress", GetNotifications);

// Unread badge count
notificationRouter.get("/:walletAddress/unread-count", GetUnreadCount);

// Mark all (or a single notification via body.notificationId) as read
notificationRouter.post("/:walletAddress/mark-read", MarkAsRead);

// Hard-delete all notifications for the wallet (does not touch AuditLog)
notificationRouter.delete("/:walletAddress", ClearNotifications);

// Preferences CRUD
notificationRouter.get(
  "/:walletAddress/preferences",
  GetNotificationPreferences,
);
notificationRouter.put(
  "/:walletAddress/preferences",
  UpdateNotificationPreferences,
);
