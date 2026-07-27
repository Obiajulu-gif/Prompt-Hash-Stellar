import express from "express";
import {
  GetNotifications,
  GetUnreadCount,
  MarkAsRead,
  ClearNotifications,
} from "../controllers/notificationControllers";

export const notificationRouter = express.Router();

notificationRouter.get("/:walletAddress", GetNotifications);
notificationRouter.get("/:walletAddress/unread-count", GetUnreadCount);
notificationRouter.post("/:walletAddress/mark-read", MarkAsRead);
notificationRouter.delete("/:walletAddress", ClearNotifications);
