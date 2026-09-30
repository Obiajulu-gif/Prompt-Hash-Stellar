import connectDb from "../db/connectDb";
import FulfillmentRecord, { FulfillmentStatus } from "../models/FulfillmentRecord";
import type { AuditAction } from "../models/AuditLog";
import { recordAuditEvent } from "./auditTrail";
import { logger } from "./structuredLogger";

/**
 * Escrow-style disputed purchase resolution (#755).
 *
 * When a buyer's payment is confirmed on-chain but the unlock fails, the
 * purchase's FulfillmentRecord becomes a recoverable dispute. Every state
 * change goes through `applyDisputeTransition`, which:
 *
 *  - only moves a record out of the states listed in `DISPUTE_TRANSITIONS`,
 *    using a single conditional update so concurrent actions cannot both win;
 *  - treats a repeated `eventKey` (redelivered webhook, indexer replay,
 *    double-submitted admin action) as an acknowledged no-op; and
 *  - appends to the record's own timeline and emits one audit event per
 *    applied transition.
 *
 * Refunds themselves settle on-chain through the contract's escrow
 * (`resolve_dispute`); the indexer reports that back as `refund_settled`.
 */

export type DisputeEvent =
  | "unlock_failed"
  | "unlock_succeeded"
  | "refund_requested"
  | "retry_scheduled"
  | "refund_approved"
  | "refund_rejected"
  | "resolved"
  | "escalated"
  | "refund_settled";

interface TransitionRule {
  from: FulfillmentStatus[];
  to: FulfillmentStatus;
  /** The first unlock failure creates the dispute record. */
  upsert?: boolean;
}

export const DISPUTE_TRANSITIONS: Record<DisputeEvent, TransitionRule> = {
  unlock_failed: {
    from: ["pending", "delivered", "failed", "retrying", "rejected", "resolved"],
    to: "failed",
    upsert: true,
  },
  unlock_succeeded: { from: ["pending", "failed", "retrying"], to: "delivered" },
  refund_requested: { from: ["pending", "failed", "retrying"], to: "refund_requested" },
  retry_scheduled: { from: ["failed", "refund_requested"], to: "retrying" },
  refund_approved: { from: ["failed", "retrying", "refund_requested"], to: "refunded" },
  refund_rejected: { from: ["refund_requested"], to: "rejected" },
  resolved: { from: ["failed", "retrying", "refund_requested", "rejected"], to: "resolved" },
  escalated: { from: ["pending", "failed", "retrying"], to: "refund_requested" },
  refund_settled: { from: ["failed", "retrying", "refund_requested"], to: "refunded" },
};

/** Paid-but-unusable states that a maintainer still has to act on. */
export const OPEN_DISPUTE_STATUSES: FulfillmentStatus[] = [
  "failed",
  "retrying",
  "refund_requested",
];

const MAX_EVENT_KEYS = 50;

type DisputeFields =
  | "txHash"
  | "failureReason"
  | "refundReason"
  | "disputeTxHash"
  | "resolutionTxHash"
  | "resolutionNotes"
  | "resolvedBy";

export interface DisputeTransitionInput {
  promptId: string;
  buyerWallet: string;
  event: DisputeEvent;
  /** Admin token subject, "buyer", "indexer", or "system". */
  actor?: string;
  note?: string;
  /** Idempotency key; a key that was already applied is not applied again. */
  eventKey?: string;
  requestId?: string | null;
  set?: Partial<Record<DisputeFields, string>>;
  /** Extra filter conditions, e.g. an optimistic check on `lastTransitionAt`. */
  guard?: Record<string, unknown>;
}

export type DisputeTransitionOutcome =
  | "applied"
  | "duplicate"
  | "already_applied"
  | "invalid_transition"
  | "not_found";

export interface DisputeTransitionResult {
  outcome: DisputeTransitionOutcome;
  record: any | null;
  previousStatus?: FulfillmentStatus | null;
}

export async function applyDisputeTransition(
  input: DisputeTransitionInput,
): Promise<DisputeTransitionResult> {
  const rule = DISPUTE_TRANSITIONS[input.event];
  const key = { promptId: String(input.promptId), buyerWallet: input.buyerWallet.toLowerCase() };
  const actor = input.actor ?? "system";
  const now = new Date();

  const filter: Record<string, unknown> = {
    ...input.guard,
    ...key,
    status: { $in: rule.from },
  };
  if (input.eventKey) {
    filter.processedEventKeys = { $ne: input.eventKey };
  }

  const update: Record<string, any> = {
    $set: { ...input.set, status: rule.to, lastTransitionAt: now },
    $push: {
      auditLog: { status: rule.to, event: input.event, actor, note: input.note ?? "", at: now },
      ...(input.eventKey
        ? { processedEventKeys: { $each: [input.eventKey], $slice: -MAX_EVENT_KEYS } }
        : {}),
    },
  };
  if (input.event === "unlock_failed") update.$inc = { unlockAttempts: 1 };
  if (input.event === "retry_scheduled") update.$inc = { retryCount: 1 };

  let result: any = null;
  try {
    result = await FulfillmentRecord.findOneAndUpdate(filter, update, {
      upsert: Boolean(rule.upsert),
      new: false,
      includeResultMetadata: true,
    }).lean();
  } catch (err) {
    // An upsert whose filter did not match an existing record (wrong state or
    // key already processed) collides with the unique (promptId, buyerWallet)
    // index — that is "not applied", not a failure.
    if ((err as { code?: number }).code !== 11000) throw err;
  }

  const applied = Boolean(result?.value) || Boolean(result?.lastErrorObject?.upserted);

  if (applied) {
    const previousStatus: FulfillmentStatus | null = result?.value?.status ?? null;
    if (input.event === "unlock_failed") {
      // The refund-eligibility window starts at the first failed delivery.
      await FulfillmentRecord.updateOne(
        { ...key, deliveryAttemptedAt: null },
        { $set: { deliveryAttemptedAt: now } },
      );
    }
    await recordAuditEvent({
      action: `dispute_${input.event}` as AuditAction,
      result: "success",
      promptId: key.promptId,
      walletAddress: key.buyerWallet,
      actor,
      requestId: input.requestId ?? null,
      reason: `${previousStatus ?? "none"}->${rule.to}`,
    });
    const record = await FulfillmentRecord.findOne(key).lean();
    return { outcome: "applied", record, previousStatus };
  }

  const record: any = await FulfillmentRecord.findOne(key).lean();
  if (!record) return { outcome: "not_found", record: null };
  if (input.eventKey && record.processedEventKeys?.includes(input.eventKey)) {
    return { outcome: "duplicate", record };
  }
  if (record.status === rule.to) return { outcome: "already_applied", record };
  return { outcome: "invalid_transition", record };
}

/**
 * Called by the unlock endpoint when on-chain entitlement was confirmed but
 * the content could not be delivered. Never throws — a bookkeeping failure
 * must not change the unlock response.
 */
export async function recordUnlockFailure(params: {
  promptId: string;
  buyerWallet: string;
  reason: string;
  requestId?: string | null;
}): Promise<void> {
  try {
    await connectDb();
    await applyDisputeTransition({
      promptId: params.promptId,
      buyerWallet: params.buyerWallet,
      event: "unlock_failed",
      note: params.reason,
      eventKey: params.requestId ? `unlock:${params.requestId}` : undefined,
      requestId: params.requestId,
      set: { failureReason: params.reason },
    });
  } catch (err) {
    logger.error("Failed to record unlock failure dispute", {
      action: "recordUnlockFailure",
      promptId: params.promptId,
      error: err,
    });
  }
}

/**
 * Called by the unlock endpoint after a successful unlock. Closes an open
 * dispute (or a pending delivery) for this purchase if there is one.
 */
export async function recordUnlockSuccess(params: {
  promptId: string;
  buyerWallet: string;
  requestId?: string | null;
}): Promise<void> {
  try {
    await connectDb();
    await applyDisputeTransition({
      promptId: params.promptId,
      buyerWallet: params.buyerWallet,
      event: "unlock_succeeded",
      note: "Unlock succeeded",
      eventKey: params.requestId ? `unlock:${params.requestId}` : undefined,
      requestId: params.requestId,
    });
  } catch (err) {
    logger.error("Failed to record unlock success", {
      action: "recordUnlockSuccess",
      promptId: params.promptId,
      error: err,
    });
  }
}

function staleAfterMs(): number {
  return parseInt(process.env.FULFILLMENT_TIMEOUT_MS ?? "600000", 10);
}

/**
 * Escalates disputes nobody has acted on within the timeout window to a
 * refund request, one audited transition per record. A record that changes
 * between the scan and the update is skipped (optimistic `lastTransitionAt`
 * guard), and each stale period escalates at most once.
 */
export async function sweepStaleDisputes(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMs());
  const candidates: any[] = await FulfillmentRecord.find({
    status: { $in: DISPUTE_TRANSITIONS.escalated.from },
    $or: [
      { lastTransitionAt: { $lte: cutoff } },
      // Records written before #755 have no lastTransitionAt.
      { lastTransitionAt: null, deliveryAttemptedAt: { $lte: cutoff } },
    ],
  })
    .select("promptId buyerWallet status lastTransitionAt deliveryAttemptedAt")
    .limit(500)
    .lean();

  let escalated = 0;
  for (const candidate of candidates) {
    const since: Date = candidate.lastTransitionAt ?? candidate.deliveryAttemptedAt;
    const result = await applyDisputeTransition({
      promptId: candidate.promptId,
      buyerWallet: candidate.buyerWallet,
      event: "escalated",
      note: "Auto-refund: delivery timeout exceeded",
      eventKey: `stale:${candidate.status}:${new Date(since).toISOString()}`,
      guard: { lastTransitionAt: candidate.lastTransitionAt ?? null },
      set: { refundReason: "Auto-refund: delivery timeout" },
    });
    if (result.outcome === "applied") escalated += 1;
  }
  return escalated;
}

function isStale(record: any, now: number): boolean {
  if (!OPEN_DISPUTE_STATUSES.includes(record.status)) return false;
  const since = record.lastTransitionAt ?? record.updatedAt;
  return Boolean(since) && now - new Date(since).getTime() > staleAfterMs();
}

/**
 * Buyer-facing view. Deliberately omits the wallet, transaction hashes, the
 * buyer's free-text refund reason, maintainer identities, and idempotency
 * keys — the endpoint serving it is not authenticated.
 */
export function toBuyerDisputeView(record: any, refundEligible: boolean) {
  return {
    promptId: record.promptId,
    status: record.status as FulfillmentStatus,
    isOpen: OPEN_DISPUTE_STATUSES.includes(record.status),
    refundEligible,
    unlockAttempts: record.unlockAttempts ?? 0,
    retryCount: record.retryCount ?? 0,
    failureReason: record.failureReason || null,
    resolutionNotes: record.resolutionNotes || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    timeline: (record.auditLog ?? []).map((entry: any) => ({
      status: entry.status,
      event: entry.event ?? null,
      at: entry.at,
    })),
  };
}

/** Maintainer view for the admin dispute queue (admin-scoped routes only). */
export function toMaintainerDisputeView(record: any, now = Date.now()) {
  return {
    id: String(record._id),
    promptId: record.promptId,
    buyerWallet: record.buyerWallet,
    status: record.status as FulfillmentStatus,
    stale: isStale(record, now),
    txHash: record.txHash || null,
    disputeTxHash: record.disputeTxHash || null,
    resolutionTxHash: record.resolutionTxHash || null,
    failureReason: record.failureReason || null,
    refundReason: record.refundReason || null,
    resolutionNotes: record.resolutionNotes || null,
    resolvedBy: record.resolvedBy || null,
    unlockAttempts: record.unlockAttempts ?? 0,
    retryCount: record.retryCount ?? 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastTransitionAt: record.lastTransitionAt ?? null,
    timeline: (record.auditLog ?? []).map((entry: any) => ({
      status: entry.status,
      event: entry.event ?? null,
      actor: entry.actor ?? null,
      note: entry.note ?? "",
      at: entry.at,
    })),
  };
}

export async function listDisputes(options: {
  statuses?: FulfillmentStatus[];
  limit?: number;
}) {
  const rows = await FulfillmentRecord.find({
    status: { $in: options.statuses ?? OPEN_DISPUTE_STATUSES },
  })
    // Oldest first, so stale disputes surface at the top of the queue.
    .sort({ lastTransitionAt: 1, updatedAt: 1 })
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 200))
    .lean();
  const now = Date.now();
  return rows.map((row: any) => toMaintainerDisputeView(row, now));
}
