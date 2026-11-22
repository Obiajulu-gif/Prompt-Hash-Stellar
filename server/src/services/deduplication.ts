/**
 * Notification and webhook deduplication (#1180).
 *
 * Webhooks use a scoped, durable reservation ledger. Notifications use the
 * Notification collection's unique (wallet, type, dedupeKey) index. Both
 * insert first and treat a duplicate-key error as the duplicate path.
 */
import Notification, { type NotificationType } from "../models/Notification";
import ProcessedWebhookEvent, {
  type ProcessedWebhookEventStatus,
} from "../models/ProcessedWebhookEvent";

export const WEBHOOK_DEDUPE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const WEBHOOK_DEDUPE_LEASE_MS = 5 * 60 * 1000;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const DUPLICATE_KEY_CODE = 11000;
const MAX_RESERVATION_READ_ATTEMPTS = 2;

export type WebhookReservationState = "acquired" | "in_flight" | "duplicate";

export interface WebhookReservationInput {
  source: string;
  eventId: string;
  eventType?: string;
  leaseMs?: number;
}

export interface WebhookReservation {
  state: WebhookReservationState;
  dedupeKey: string;
  source: string;
  externalEventId: string;
  attempts: number;
  recordId?: string;
}

export class DeduplicationInputError extends Error {}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === DUPLICATE_KEY_CODE
  );
}

function normalizeSource(source: string): string {
  return source.trim().toLowerCase() || "default";
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

/** Build the scoped key webhook:<source>:<eventId>. */
export function buildWebhookDedupeKey(input: {
  source: string;
  eventId: string;
}): string {
  const externalEventId = input.eventId?.trim();
  if (!externalEventId) {
    throw new DeduplicationInputError(
      "Webhook deduplication requires a non-empty event id.",
    );
  }
  return `webhook:${normalizeSource(input.source)}:${externalEventId}`;
}

function reservationOf(
  state: WebhookReservationState,
  dedupeKey: string,
  source: string,
  externalEventId: string,
  attempts: number,
  recordId?: unknown,
): WebhookReservation {
  return {
    state,
    dedupeKey,
    source,
    externalEventId,
    attempts,
    ...(state === "acquired" && recordId !== undefined
      ? { recordId: String(recordId) }
      : {}),
  };
}

/**
 * Atomically claim the right to process an inbound webhook event.
 * Storage errors other than duplicate-key are rethrown so an outage is never
 * mistaken for a duplicate.
 */
export async function reserveWebhookDelivery(
  input: WebhookReservationInput,
): Promise<WebhookReservation> {
  const dedupeKey = buildWebhookDedupeKey(input);
  const source = normalizeSource(input.source);
  const externalEventId = input.eventId.trim();
  const leaseMs = input.leaseMs ?? WEBHOOK_DEDUPE_LEASE_MS;

  for (
    let readAttempt = 0;
    readAttempt < MAX_RESERVATION_READ_ATTEMPTS;
    readAttempt += 1
  ) {
    const now = Date.now();

    try {
      const created = await ProcessedWebhookEvent.create({
        eventId: dedupeKey,
        externalEventId,
        scope: source,
        eventType: input.eventType ?? null,
        status: "in_flight",
        attempts: 1,
        leaseExpiresAt: new Date(now + leaseMs),
        lastError: null,
        processedAt: new Date(now),
        expiresAt: new Date(now + WEBHOOK_DEDUPE_RETENTION_MS),
      });
      return reservationOf(
        "acquired", dedupeKey, source, externalEventId, 1, created._id,
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }

    const existing = await ProcessedWebhookEvent.findOne({ eventId: dedupeKey });
    if (!existing) continue;

    if (existing.status === "processed") {
      return reservationOf(
        "duplicate", dedupeKey, source, externalEventId, existing.attempts,
      );
    }

    const leaseIsLive =
      existing.status === "in_flight" &&
      existing.leaseExpiresAt instanceof Date &&
      existing.leaseExpiresAt.getTime() > now;

    if (leaseIsLive) {
      return reservationOf(
        "in_flight", dedupeKey, source, externalEventId, existing.attempts,
      );
    }

    const reacquired = await ProcessedWebhookEvent.findOneAndUpdate(
      {
        _id: existing._id,
        status: existing.status as ProcessedWebhookEventStatus,
        attempts: existing.attempts,
      },
      {
        $set: {
          status: "in_flight",
          leaseExpiresAt: new Date(now + leaseMs),
          lastError: null,
          processedAt: new Date(now),
          expiresAt: new Date(now + WEBHOOK_DEDUPE_RETENTION_MS),
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    );

    if (!reacquired) {
      return reservationOf(
        "in_flight", dedupeKey, source, externalEventId, existing.attempts + 1,
      );
    }
    return reservationOf(
      "acquired", dedupeKey, source, externalEventId,
      reacquired.attempts, reacquired._id,
    );
  }
  return reservationOf("in_flight", dedupeKey, source, externalEventId, 0);
}

/**
 * Mark an acquired reservation processed; later deliveries are duplicates.
 * `expectedAttempts` fences out a worker whose lease expired and was
 * re-acquired by another processor, so a stale worker cannot complete the
 * newer owner's reservation.
 */
export async function completeWebhookDelivery(
  recordId: string,
  options: { retentionMs?: number; expectedAttempts?: number } = {},
): Promise<boolean> {
  const now = Date.now();
  const retentionMs = options.retentionMs ?? WEBHOOK_DEDUPE_RETENTION_MS;
  const updated = await ProcessedWebhookEvent.findOneAndUpdate(
    {
      _id: recordId,
      status: "in_flight",
      ...(options.expectedAttempts !== undefined
        ? { attempts: options.expectedAttempts }
        : {}),
    },
    {
      $set: {
        status: "processed",
        processedAt: new Date(now),
        leaseExpiresAt: null,
        lastError: null,
        expiresAt: new Date(now + retentionMs),
      },
    },
    { new: true },
  );
  return Boolean(updated);
}

/** Record a failure and make the event immediately retryable. */
export async function failWebhookDelivery(
  recordId: string,
  error: unknown,
  options: { retentionMs?: number; expectedAttempts?: number } = {},
): Promise<boolean> {
  const now = Date.now();
  const retentionMs = options.retentionMs ?? WEBHOOK_DEDUPE_RETENTION_MS;
  const updated = await ProcessedWebhookEvent.findOneAndUpdate(
    {
      _id: recordId,
      status: "in_flight",
      ...(options.expectedAttempts !== undefined
        ? { attempts: options.expectedAttempts }
        : {}),
    },
    {
      $set: {
        status: "failed",
        lastError: truncateError(error),
        leaseExpiresAt: null,
        processedAt: new Date(now),
        expiresAt: new Date(now + retentionMs),
      },
    },
    { new: true },
  );
  return Boolean(updated);
}

/** Roll back an unprocessed reservation. Completed rows are never deleted. */
export async function releaseWebhookDelivery(
  recordId: string,
): Promise<boolean> {
  const released = await ProcessedWebhookEvent.findOneAndDelete({
    _id: recordId,
    status: { $in: ["in_flight", "failed"] },
  });
  return Boolean(released);
}

/** Look up one dedupe record by its scoped key. */
export async function getWebhookDedupeRecord(dedupeKey: string) {
  return ProcessedWebhookEvent.findOne({ eventId: dedupeKey.trim() }).lean();
}

export interface WebhookDedupeFilter {
  status?: ProcessedWebhookEventStatus;
  source?: string;
  limit?: number;
}

/** Operator view of the dedupe ledger, most recently touched first. */
export async function listWebhookDedupeRecords(
  filter: WebhookDedupeFilter = {},
) {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.source) {
    query.$or = [
      { scope: normalizeSource(filter.source) },
      { source: normalizeSource(filter.source) },
    ];
  }
  return ProcessedWebhookEvent.find(query)
    .sort({ processedAt: -1, _id: -1 })
    .limit(Math.min(filter.limit ?? 100, 500))
    .lean();
}

export interface NotificationDedupeInput {
  recipientWallet: string;
  type: NotificationType;
  message: string;
  dedupeKey: string;
  promptId?: string;
  promptTitle?: string;
  versionIndex?: number;
  changeNote?: string;
  sourceEventId?: string;
  deepLink?: string;
  mandatory?: boolean;
  /** Optional delivery metadata preserved from the legacy writer. */
  deliveryStatus?: string;
  attempts?: number;
  lastError?: string;
  deliveredAt?: Date;
}

export interface NotificationDedupeResult {
  created: boolean;
  dedupeKey: string;
  notificationId?: string;
}

/**
 * Persist an in-app notification exactly once for
 * (recipientWallet, type, dedupeKey). Duplicate-key errors return the stored
 * notification; every other error propagates as retryable.
 */
export async function deliverNotificationOnce(
  input: NotificationDedupeInput,
): Promise<NotificationDedupeResult> {
  const recipientWallet = input.recipientWallet.trim().toLowerCase();
  const dedupeKey = input.dedupeKey?.trim();

  if (!recipientWallet) {
    throw new DeduplicationInputError(
      "Notification deduplication requires a recipient wallet.",
    );
  }
  if (!dedupeKey) {
    throw new DeduplicationInputError(
      "Notification deduplication requires a non-empty dedupeKey.",
    );
  }

  try {
    const created = await Notification.create({
      recipientWallet,
      promptId: input.promptId ?? null,
      promptTitle: input.promptTitle ?? "",
      type: input.type,
      message: input.message,
      deepLink: input.deepLink ?? null,
      versionIndex: input.versionIndex ?? 0,
      changeNote: input.changeNote ?? "",
      mandatory: input.mandatory ?? false,
      dedupeKey,
      sourceEventId: input.sourceEventId,
      deliveryStatus: input.deliveryStatus,
      attempts: input.attempts,
      lastError: input.lastError,
      deliveredAt: input.deliveredAt,
      read: false,
    });
    return { created: true, dedupeKey, notificationId: String(created._id) };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const existing = await Notification.findOne({
      recipientWallet,
      type: input.type,
      dedupeKey,
    }).lean();
    if (!existing) throw error;
    return {
      created: false,
      dedupeKey,
      notificationId: String((existing as { _id?: unknown })._id ?? ""),
    };
  }
}
