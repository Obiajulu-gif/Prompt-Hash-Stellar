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

export interface CreateNotificationParams {
  recipientWallet: string;
  type: NotificationType;
  message: string;
  deepLink?: string | null;
  promptId?: string | null;
  promptTitle?: string;
  versionIndex?: number | null;
  changeNote?: string;
  /** Stable idempotency key — typically the on-chain event id. */
  idempotencyKey?: string | null;
}

/**
 * Persists a notification for `recipientWallet`, skipping the write when the
 * recipient has muted the type. Duplicate idempotency keys are treated as a
 * successful no-op so retried indexer ticks never double-notify.
 */
export async function createNotification(
  params: CreateNotificationParams,
): Promise<InstanceType<typeof Notification> | null> {
  const wallet = params.recipientWallet.toLowerCase();

  try {
    const prefs = await NotificationPreferences.findOne({ walletAddress: wallet }).lean();
    const mutedTypes: string[] = (prefs as { mutedTypes?: string[] } | null)?.mutedTypes ?? [];
    if (mutedTypes.includes(params.type)) {
      logger.debug("Notification suppressed by user preference", {
        action: "createNotification",
        type: params.type,
        wallet,
      });
      return null;
    }
  } catch (prefErr) {
    // Preference lookup failure must never block notification delivery.
    logger.warn("Failed to load notification preferences; proceeding without preference check", {
      action: "createNotification",
      wallet,
      error: prefErr,
    });
  }

  const doc: Record<string, unknown> = {
    recipientWallet: wallet,
    type: params.type,
    message: params.message,
    deepLink: params.deepLink ?? null,
    promptId: params.promptId ?? null,
    promptTitle: params.promptTitle ?? "",
    versionIndex: params.versionIndex ?? null,
    changeNote: params.changeNote ?? "",
  };

  if (params.idempotencyKey) {
    doc.idempotencyKey = params.idempotencyKey;
  }

  try {
    return await Notification.create(doc);
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) {
      logger.debug("Notification already exists for idempotency key", {
        action: "createNotification",
        idempotencyKey: params.idempotencyKey,
        wallet,
      });
      return null;
    }
    throw err;
  }
}

/**
 * Sends the same event to every wallet in `recipientWallets`. Idempotency keys
 * are suffixed per wallet so each recipient has a unique document.
 */
export async function fanOutNotification(
  recipientWallets: (string | undefined | null)[],
  params: Omit<CreateNotificationParams, "recipientWallet">,
): Promise<void> {
  const wallets = recipientWallets.filter((w): w is string => Boolean(w));
  await Promise.allSettled(
    wallets.map((wallet) =>
      createNotification({
        ...params,
        recipientWallet: wallet,
        idempotencyKey: params.idempotencyKey
          ? `${params.idempotencyKey}:${wallet.toLowerCase()}`
          : undefined,
      }).catch((err) => {
        logger.error("fanOutNotification failed for one recipient", {
          action: "fanOutNotification",
          wallet,
          error: err,
        });
      }),
    ),
  );
}

/**
 * Deletes read notifications older than `retentionDays` in batches. The TTL
 * index is the primary retention mechanism; this is the manual fallback.
 */
export async function pruneOldNotifications(
  retentionDays = 90,
  batchSize = 500,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;

  for (;;) {
    const docs = await Notification.find(
      { read: true, createdAt: { $lt: cutoff } },
      { _id: 1 },
    )
      .limit(batchSize)
      .lean();

    if (docs.length === 0) break;

    const ids = docs.map((d: { _id: unknown }) => d._id);
    const result = await Notification.deleteMany({ _id: { $in: ids } });
    totalDeleted += result.deletedCount ?? 0;

    logger.info("Pruned old notifications batch", {
      action: "pruneOldNotifications",
      deleted: result.deletedCount,
      total: totalDeleted,
    });

    if (docs.length < batchSize) break;
  }

  return totalDeleted;
}
