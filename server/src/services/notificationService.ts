import Notification, { NotificationType } from '../models/Notification';

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
    try {
      if (options.idempotencyKey) {
        const existing = await Notification.findOne({
          recipientWallet: options.recipientWallet,
          idempotencyKey: options.idempotencyKey,
        });

        if (existing) {
          return existing;
        }
      }

      const notification = new Notification({
        recipientWallet: options.recipientWallet,
        type: options.type,
        message: options.message,
        deepLink: options.deepLink,
        promptId: options.promptId,
        promptTitle: options.promptTitle,
        idempotencyKey: options.idempotencyKey,
        versionIndex: options.versionIndex,
        changeNote: options.changeNote,
        read: false,
      });

      return await notification.save();
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  static async markAsRead(notificationId: string) {
    return await Notification.findByIdAndUpdate(
      notificationId,
      { read: true },
      { new: true }
    );
  }

  static async markAsUnread(notificationId: string) {
    return await Notification.findByIdAndUpdate(
      notificationId,
      { read: false },
      { new: true }
    );
  }

  static async markAllAsRead(recipientWallet: string) {
    return await Notification.updateMany(
      { recipientWallet, read: false },
      { read: true }
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
    } = {}
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
    notifications: CreateNotificationOptions[]
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
    limit: number = 10
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
