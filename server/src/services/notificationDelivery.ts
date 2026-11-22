import Notification from "../models/Notification";
import { deliverNotificationOnce } from "./deduplication";

const DUPLICATE_KEY_CODE = 11000;

/** Channels a notification can be delivered on (#918). */
export type NotificationChannel = "in_app" | "email" | "webhook";

/** Cross-channel identity: the same logical event maps to one dedupe key regardless of channel. */
export type CrossChannelIdentity = {
  eventType: string;
  entityId: string;
  recipientWallet: string;
  versionOrSeq: string | number;
};

export type SuppressedDeliveryRecord = {
  dedupeKey: string;
  channel: NotificationChannel;
  suppressedAt: Date;
  reason: "duplicate" | "policy_muted" | "already_delivered";
};

// In-memory suppression log for maintainer diagnostics. Bounded to prevent
// unbounded growth; production deployments should use a TTL store.
const MAX_SUPPRESSED_RECORDS = 500;
const suppressedLog: SuppressedDeliveryRecord[] = [];

export type PromptUpdatePurchase = {
  buyerWallet: string;
};

export type PromptUpdatePrompt = {
  _id: unknown;
  title: string;
};

export type PromptUpdateNotificationInput = {
  recipientWallet: string;
  promptId: string;
  promptTitle: string;
  versionIndex: number;
  changeNote?: string;
  sourceEventId: string;
};

export type NotificationDeliveryResult = {
  recipientWallet: string;
  dedupeKey: string;
  created: boolean;
  /** Channels this delivery was attempted on (#918). */
  channels: NotificationChannel[];
  /** True when a duplicate was suppressed rather than re-delivered (#918). */
  suppressed: boolean;
};

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === DUPLICATE_KEY_CODE
  );
}

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

/**
 * Build a cross-channel dedupe key from a logical event identity (#918).
 * The same event always maps to the same key regardless of delivery channel,
 * so a duplicate email and a duplicate in-app notification collapse to one.
 */
export function buildCrossChannelDedupeKey(identity: CrossChannelIdentity): string {
  return [
    identity.eventType,
    identity.entityId,
    normalizeWallet(identity.recipientWallet),
    String(identity.versionOrSeq),
  ].join(":");
}

export function buildPromptUpdateDedupeKey(input: PromptUpdateNotificationInput): string {
  return buildCrossChannelDedupeKey({
    eventType: "prompt_update",
    entityId: input.promptId,
    recipientWallet: input.recipientWallet,
    versionOrSeq: input.versionIndex,
  });
}

function recordSuppression(record: SuppressedDeliveryRecord): void {
  suppressedLog.push(record);
  if (suppressedLog.length > MAX_SUPPRESSED_RECORDS) {
    suppressedLog.splice(0, suppressedLog.length - MAX_SUPPRESSED_RECORDS);
  }
}

/**
 * Maintainer diagnostics: returns recent suppressed delivery attempts (#918).
 * Useful for debugging "why didn't I get notified?" reports.
 */
export function getSuppressedDeliveries(
  filter?: { dedupeKey?: string; channel?: NotificationChannel },
): SuppressedDeliveryRecord[] {
  let results = suppressedLog;
  if (filter?.dedupeKey) {
    results = results.filter((r) => r.dedupeKey === filter.dedupeKey);
  }
  if (filter?.channel) {
    results = results.filter((r) => r.channel === filter.channel);
  }
  return [...results];
}

/**
 * Deliver a notification to multiple channels with cross-channel dedup (#918).
 * Returns per-channel results so callers can see which channels were suppressed.
 */
export async function deliverWithChannelDedup(
  input: PromptUpdateNotificationInput & { channels: NotificationChannel[] },
): Promise<NotificationDeliveryResult> {
  const recipientWallet = normalizeWallet(input.recipientWallet);
  const dedupeKey = buildCrossChannelDedupeKey({
    eventType: "prompt_update",
    entityId: input.promptId,
    recipientWallet,
    versionOrSeq: input.versionIndex,
  });

  // Insert first and let the unique index collapse concurrent duplicate
  // projections of the same event (#1180). The previous check-then-create
  // sequence let two racing deliveries both observe "not seen" and attempt
  // the write; the loser's duplicate-key error is now the normal suppress path.
  const result = await deliverNotificationOnce({
    recipientWallet,
    type: "prompt_update",
    message: `"${input.promptTitle}" has been updated by the creator.`,
    versionIndex: input.versionIndex,
    changeNote: input.changeNote ?? "",
    sourceEventId: input.sourceEventId,
    dedupeKey,
    deliveryStatus: "delivered",
    attempts: 1,
    lastError: "",
    deliveredAt: new Date(),
  });

  if (!result.created) {
    for (const channel of input.channels) {
      recordSuppression({
        dedupeKey,
        channel,
        suppressedAt: new Date(),
        reason: "already_delivered",
      });
    }
    return {
      recipientWallet,
      dedupeKey,
      created: false,
      channels: input.channels,
      suppressed: true,
    };
  }

  return {
    recipientWallet,
    dedupeKey,
    created: true,
    channels: input.channels,
    suppressed: false,
  };
}

export async function createNotificationOnce(
  input: PromptUpdateNotificationInput,
): Promise<NotificationDeliveryResult> {
  const recipientWallet = normalizeWallet(input.recipientWallet);
  const dedupeKey = buildPromptUpdateDedupeKey({ ...input, recipientWallet });

  try {
    await Notification.create({
      recipientWallet,
      promptId: input.promptId,
      promptTitle: input.promptTitle,
      type: "prompt_update",
      message: `"${input.promptTitle}" has been updated by the creator.`,
      versionIndex: input.versionIndex,
      changeNote: input.changeNote ?? "",
      sourceEventId: input.sourceEventId,
      dedupeKey,
      deliveryStatus: "delivered",
      attempts: 1,
      lastError: "",
      deliveredAt: new Date(),
      read: false,
    });

    return { recipientWallet, dedupeKey, created: true, channels: ["in_app"], suppressed: false };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      recordSuppression({
        dedupeKey,
        channel: "in_app",
        suppressedAt: new Date(),
        reason: "duplicate",
      });
      return { recipientWallet, dedupeKey, created: false, channels: ["in_app"], suppressed: true };
    }

    throw error;
  }
}

export async function notifyPromptUpdateBuyers(
  purchases: PromptUpdatePurchase[],
  prompt: PromptUpdatePrompt,
  versionIndex: number,
  changeNote = "",
): Promise<NotificationDeliveryResult[]> {
  const promptId = String(prompt._id);
  const sourceEventId = `prompt_update:${promptId}:${versionIndex}`;
  const uniqueWallets = Array.from(
    new Set(
      purchases
        .map((purchase) => purchase.buyerWallet)
        .filter((wallet): wallet is string => typeof wallet === "string" && wallet.trim().length > 0)
        .map(normalizeWallet),
    ),
  );

  return Promise.all(
    uniqueWallets.map((recipientWallet) =>
      createNotificationOnce({
        recipientWallet,
        promptId,
        promptTitle: prompt.title,
        versionIndex,
        changeNote,
        sourceEventId,
      }),
    ),
  );
}
