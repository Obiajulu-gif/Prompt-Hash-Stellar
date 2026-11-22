/**
 * Notification service — in-app notification center (#notification-center).
 *
 * `createNotification` is idempotent: if an `idempotencyKey` is supplied and
 * a notification with that key already exists for the recipient, the call is
 * a no-op and returns `null`. Callers should always pass the on-chain event id
 * so a retried indexer tick never creates duplicate notifications.
 *
 * `pruneOldNotifications` is a manual fallback for environments where the
 * MongoDB TTL index background thread is slow or disabled. It deletes read
 * notifications older than the retention window in configurable page batches
 * to avoid large delete operations.
 *
 * Sensitive payload details (wallet keys, amounts, raw addresses) must never
 * be passed in `message` or `promptTitle`. Use stable IDs and safe labels.
 */

import Notification, { NotificationType } from "../models/Notification";
import NotificationPreferences from "../models/NotificationPreferences";
import { logger } from "./structuredLogger";

const RETENTION_DAYS = 90;

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
 * Persists a new notification for `recipientWallet`, respecting:
 *  1. Idempotency — skips creation when `idempotencyKey` already exists.
 *  2. User preferences — skips creation when the recipient has muted this type.
 *
 * Returns the created document, or `null` when skipped.
 */
export async function createNotification(
  params: CreateNotificationParams,
): Promise<InstanceType<typeof Notification> | null> {
  const wallet = params.recipientWallet.toLowerCase();

  // Check user preferences before writing — respect muted types.
  try {
    const prefs = await NotificationPreferences.findOne({ walletAddress: wallet }).lean();
    const mutedTypes: string[] = prefs?.mutedTypes ?? [];
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
    const notification = await Notification.create(doc);
    return notification;
  } catch (err: unknown) {
    // Duplicate key = idempotency hit. This is expected on retry paths.
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
 * Sends a notification to every wallet in `recipientWallets` for the same
 * event. Each wallet gets its own document; idempotency keys are suffixed
 * with the wallet address to keep them unique per recipient.
 *
 * Errors for individual recipients are logged and swallowed so a single bad
 * wallet never blocks delivery to others.
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
 * Deletes read notifications older than `retentionDays` in batches.
 * Called by the server startup or a maintenance endpoint. The MongoDB TTL
 * index is the primary retention mechanism; this is a manual fallback.
 *
 * Returns the total number of documents deleted.
 */
export async function pruneOldNotifications(
  retentionDays = RETENTION_DAYS,
  batchSize = 500,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;

  for (;;) {
    // Fetch IDs first to avoid large deletes on the primary; delete by _id is
    // index-driven and avoids collection scans.
    const docs = await Notification.find(
      { read: true, createdAt: { $lt: cutoff } },
      { _id: 1 },
    )
      .limit(batchSize)
      .lean();

    if (docs.length === 0) break;

    const ids = docs.map((d) => d._id);
    const result = await Notification.deleteMany({ _id: { $in: ids } });
    totalDeleted += result.deletedCount;

    logger.info("Pruned old notifications batch", {
      action: "pruneOldNotifications",
      deleted: result.deletedCount,
      total: totalDeleted,
    });

    if (docs.length < batchSize) break;
  }

  return totalDeleted;
}
