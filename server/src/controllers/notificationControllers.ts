/**
 * Notification controllers — in-app notification center (#notification-center).
 *
 * Endpoints:
 *   GET    /:walletAddress                  – paginated list (type filter, unread-only option)
 *   GET    /:walletAddress/unread-count     – lightweight badge count
 *   POST   /:walletAddress/mark-read        – mark all OR a single notification read
 *   DELETE /:walletAddress                  – clear all (does not touch AuditLog)
 *   GET    /:walletAddress/preferences      – read notification preferences
 *   PUT    /:walletAddress/preferences      – update muted types / emailEnabled
 *
 * Marking read is non-destructive: it only flips `read: true` on Notification
 * documents. Audit events in AuditLog are append-only and unaffected.
 *
 * Sensitive data is never stored in Notification; controllers do not add any.
 */

import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Notification, {
  NOTIFICATION_TYPES,
  NotificationType,
} from "../models/Notification";
import NotificationPreferences from "../models/NotificationPreferences";

const PAGE_LIMIT_MAX = 50;
const PAGE_LIMIT_DEFAULT = 20;

// ── List ──────────────────────────────────────────────────────────────────────

export const GetNotifications = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress)
      return res.status(400).json({ error: "walletAddress is required." });

    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(
      PAGE_LIMIT_MAX,
      Math.max(
        1,
        parseInt(String(req.query.limit ?? String(PAGE_LIMIT_DEFAULT)), 10),
      ),
    );
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      recipientWallet: walletAddress.toLowerCase(),
    };

    // Optional: filter to unread only
    if (req.query.unread === "true") filter.read = false;

    // Optional: filter by notification type
    const typeParam = req.query.type as string | undefined;
    if (
      typeParam &&
      NOTIFICATION_TYPES.includes(typeParam as NotificationType)
    ) {
      filter.type = typeParam;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    return res.json({
      notifications,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ── Unread count ──────────────────────────────────────────────────────────────

export const GetUnreadCount = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress)
      return res.status(400).json({ error: "walletAddress is required." });

    const count = await Notification.countDocuments({
      recipientWallet: walletAddress.toLowerCase(),
      read: false,
    });

    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ── Mark read ─────────────────────────────────────────────────────────────────

/**
 * POST /:walletAddress/mark-read
 * Body (optional): { notificationId: string } — marks a single notification.
 * Without a body, marks all unread notifications for the wallet.
 *
 * This does NOT affect AuditLog entries — audit records are immutable.
 */
export const MarkAsRead = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress)
      return res.status(400).json({ error: "walletAddress is required." });

    const wallet = walletAddress.toLowerCase();
    const { notificationId } = req.body as { notificationId?: string };

    if (notificationId) {
      // Single-notification mark-read — scoped to wallet to prevent cross-user writes.
      const result = await Notification.findOneAndUpdate(
        { _id: notificationId, recipientWallet: wallet },
        { $set: { read: true } },
        { new: true },
      );
      if (!result) {
        return res
          .status(404)
          .json({ error: "Notification not found for this wallet." });
      }
      return res.json({ message: "Notification marked as read.", updated: 1 });
    }

    // Bulk: mark all unread for wallet.
    const result = await Notification.updateMany(
      { recipientWallet: wallet, read: false },
      { $set: { read: true } },
    );
    return res.json({
      message: "Notifications marked as read.",
      updated: result.modifiedCount,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ── Clear all ─────────────────────────────────────────────────────────────────

/**
 * DELETE /:walletAddress
 * Hard-deletes all notification documents for the wallet. Does not affect
 * AuditLog (append-only) or any other collection.
 */
export const ClearNotifications = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress)
      return res.status(400).json({ error: "walletAddress is required." });

    const result = await Notification.deleteMany({
      recipientWallet: walletAddress.toLowerCase(),
    });

    return res.json({
      message: "Notifications cleared.",
      deleted: result.deletedCount,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ── Preferences ───────────────────────────────────────────────────────────────

export const GetNotificationPreferences = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress)
      return res.status(400).json({ error: "walletAddress is required." });

    const prefs = await NotificationPreferences.findOne({
      walletAddress: walletAddress.toLowerCase(),
    }).lean();

    // Return defaults when no preferences document exists yet.
    return res.json(
      prefs ?? {
        walletAddress: walletAddress.toLowerCase(),
        mutedTypes: [],
        emailEnabled: false,
      },
    );
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

/**
 * PUT /:walletAddress/preferences
 * Body: { mutedTypes?: NotificationType[], emailEnabled?: boolean }
 *
 * Upserts the preferences document; only recognised fields are applied.
 * Unknown types in mutedTypes are silently filtered out.
 */
export const UpdateNotificationPreferences = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress)
      return res.status(400).json({ error: "walletAddress is required." });

    const body = req.body as { mutedTypes?: unknown; emailEnabled?: unknown };

    const update: Record<string, unknown> = {};

    if (Array.isArray(body.mutedTypes)) {
      const valid = body.mutedTypes.filter(
        (t): t is NotificationType =>
          typeof t === "string" &&
          NOTIFICATION_TYPES.includes(t as NotificationType),
      );
      update.mutedTypes = valid;
    }

    if (typeof body.emailEnabled === "boolean") {
      update.emailEnabled = body.emailEnabled;
    }

    if (Object.keys(update).length === 0) {
      return res
        .status(400)
        .json({ error: "No valid preference fields provided." });
    }

    const prefs = await NotificationPreferences.findOneAndUpdate(
      { walletAddress: walletAddress.toLowerCase() },
      { $set: update },
      { upsert: true, new: true },
    );

    return res.json(prefs);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
