import Notification, { NotificationType } from "../models/Notification";
import NotificationPreferences from "../models/NotificationPreferences";
import { logger } from "./structuredLogger";

export interface CreateNotificationOptions {
  recipientWallet: string;
  type: NotificationType;
  message: string;
  deepLink?: string;
  promptId?: string;
  promptTitle?: string;
  idempotencyKey?: string;
  versionIndex?: number;
  changeNote?: string;
}

export class NotificationService {
  static async createNotification(options: CreateNotificationOptions) {
    const recipientWallet = options.recipientWallet.trim().toLowerCase();
    const key = options.idempotencyKey?.trim();
    if (!recipientWallet || (options.idempotencyKey !== undefined && !key)) {
      throw new Error("Recipient and non-empty idempotency key required");
    }
    const filter = { recipientWallet, type: options.type, idempotencyKey: key };
    try {
      return await Notification.create({
        ...options,
        recipientWallet,
        ...(key ? { idempotencyKey: key } : {}),
        read: false,
      });
    } catch (error) {
      if (key && (error as { code?: number }).code === 11000) {
        const existing = await Notification.findOne(filter);
        if (existing) return existing;
      }
      throw error;
    }
  }

  static async markAsRead(notificationId: string) {
    return await Notification.findByIdAndUpdate(
      notificationId,
      { read: true },
      { new: true },
    );
  }

  static async markAsUnread(notificationId: string) {
    return await Notification.findByIdAndUpdate(
      notificationId,
      { read: false },
      { new: true },
    );
  }

  static async markAllAsRead(recipientWallet: string) {
    return await Notification.updateMany(
      { recipientWallet, read: false },
      { read: true },
    );
  }

  static async getUnreadCount(recipientWallet: string) {
    return await Notification.countDocuments({
      recipientWallet,
      read: false,
    });
  }

  static async getNotifications(
    recipientWallet: string,
    options: {
      limit?: number;
      skip?: number;
      type?: NotificationType;
      unreadOnly?: boolean;
    } = {},
  ) {
    const { limit = 20, skip = 0, type, unreadOnly = false } = options;

    const query: any = { recipientWallet };

    if (type) {
      query.type = type;
    }

    if (unreadOnly) {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();

    const total = await Notification.countDocuments(query);

    return {
      notifications,
      total,
      hasMore: skip + limit < total,
    };
  }

  static async deleteNotification(notificationId: string) {
    return await Notification.findByIdAndDelete(notificationId);
  }

  static async deleteOldNotifications(daysOld: number = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Notification.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    return result.deletedCount;
  }

  static async sendBulkNotifications(
    notifications: CreateNotificationOptions[],
  ) {
    const results = [];

    for (const notifOptions of notifications) {
      try {
        const notif = await this.createNotification(notifOptions);
        results.push({ success: true, notification: notif });
      } catch (error) {
        results.push({ success: false, error, options: notifOptions });
      }
    }

    return results;
  }

  static async getNotificationsByType(
    recipientWallet: string,
    type: NotificationType,
    limit: number = 10,
  ) {
    return await Notification.find({
      recipientWallet,
      type,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  static async getNotificationsWithDeepLinks(recipientWallet: string) {
    return await Notification.find({
      recipientWallet,
      deepLink: { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .exec();
  }
}

/**
 * Create one in-app notification, honouring the recipient's muted types and
 * treating a duplicate idempotency key as an already-delivered no-op.
 */
export async function createNotification(options: CreateNotificationOptions) {
  const recipientWallet = options.recipientWallet.trim().toLowerCase();

  try {
    const preferenceQuery = await NotificationPreferences.findOne({
      walletAddress: recipientWallet,
    });
    const preferences = preferenceQuery?.lean
      ? await preferenceQuery.lean()
      : preferenceQuery;
    if (preferences?.mutedTypes?.includes(options.type)) {
      return null;
    }
  } catch (error) {
    // Preference lookup is advisory: never drop a notification because the
    // preference store is unavailable.
    logger.warn("Notification preference lookup failed", {
      action: "createNotification",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    return await Notification.create({
      ...options,
      recipientWallet,
      read: false,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return null;
    }
    throw error;
  }
}

type FanOutOptions = Omit<CreateNotificationOptions, "recipientWallet">;

/**
 * Fan one logical event out to several wallets. Each wallet gets a distinct
 * idempotency key suffix, and one recipient's failure never blocks the rest.
 */
export async function fanOutNotification(
  wallets: Array<string | null | undefined>,
  options: FanOutOptions,
): Promise<void> {
  const recipients = Array.from(
    new Set(
      wallets
        .filter((wallet): wallet is string => typeof wallet === "string")
        .map((wallet) => wallet.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  await Promise.all(
    recipients.map(async (recipientWallet) => {
      try {
        await createNotification({
          ...options,
          recipientWallet,
          idempotencyKey: options.idempotencyKey
            ? `${options.idempotencyKey}:${recipientWallet}`
            : undefined,
        });
      } catch (error) {
        logger.warn("Notification fan-out failed for recipient", {
          action: "fanOutNotification",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

/** Delete old read notifications in bounded batches. */
export async function pruneOldNotifications(
  daysOld = 90,
  batchSize = 500,
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  let total = 0;
  for (;;) {
    const batch = await Notification.find({
      read: true,
      createdAt: { $lt: cutoffDate },
    })
      .limit(batchSize)
      .lean();

    if (batch.length === 0) break;

    await Notification.deleteMany({
      _id: { $in: batch.map((notification) => notification._id) },
    });
    total += batch.length;

    if (batch.length < batchSize) break;
  }

  return total;
}
