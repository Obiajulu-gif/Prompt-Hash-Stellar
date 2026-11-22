/**
 * Tests — notification and webhook deduplication (#1223).
 *
 * Coverage:
 *  - pure classification: new, duplicate, conflict, retry, permanent failure,
 *    abandoned in-flight attempts, legacy rows without a fingerprint;
 *  - stable fingerprints: key order does not matter, content does;
 *  - notification integration: a repeated dedupe key with different content is
 *    suppressed as a conflict and audited, identical content stays a duplicate;
 *  - inbound webhook integration: conflicting replay returns `conflict` and
 *    HTTP 409, identical replay preserves 202;
 *  - authorization surface: the inspection controller validates its inputs and
 *    returns fingerprints, never payload content.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

vi.mock("../models/Notification", () => ({
  default: { create: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn() },
  NOTIFICATION_TYPES: [
    "prompt_update",
    "purchase_receipt",
    "security_alert",
    "account_lifecycle",
    "entitlement_update",
    "support_access_notice",
  ],
  MANDATORY_NOTIFICATION_TYPES: [
    "security_alert",
    "account_lifecycle",
    "entitlement_update",
    "support_access_notice",
  ],
  isMandatoryNotificationType: (type: string) =>
    ["security_alert", "account_lifecycle", "entitlement_update", "support_access_notice"].includes(
      type,
    ),
}));

vi.mock("../models/InboundWebhookEvent", () => ({
  default: {
    create: vi.fn(),
    findOne: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findOneAndUpdate: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock("../models/WebhookOutboxEvent", () => ({
  default: { countDocuments: vi.fn() },
}));

vi.mock("../models/NotificationPreference", () => ({
  default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock("../models/User", () => ({ default: { findOne: vi.fn() } }));

vi.mock("../db/connectDb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/structuredLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Notification from "../models/Notification";
import InboundWebhookEvent from "../models/InboundWebhookEvent";
import WebhookOutboxEvent from "../models/WebhookOutboxEvent";
import { recordAuditEvent } from "../services/auditTrail";
import { defaultEffectivePreferences } from "../services/notificationPreferences";
import { deliverNotification } from "../services/notificationRouting";
import {
  verifyAndProcess,
  verifyInboundSignature,
} from "../services/inboundWebhookProcessor";
import { ReceiveInboundWebhook } from "../controllers/inboundWebhookControllers";
import {
  GetDeduplicationStatus,
  GetDeduplicationSummary,
} from "../controllers/deduplicationControllers";
import {
  classifyDeduplication,
  classifyNotificationCollision,
  deduplicationRemedy,
  fingerprintDeduplicationPayload,
  fingerprintInboundWebhook,
  fingerprintNotification,
} from "../services/deduplication";

const NOW = 1_750_000_000_000;

function lean<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  return res;
}

function mockReq(params: Record<string, string> = {}) {
  return { params, body: {}, headers: {}, query: {} } as any;
}

// ── pure classification ──────────────────────────────────────────────────────

describe("classifyDeduplication", () => {
  it("returns new when the key has not been seen", () => {
    expect(classifyDeduplication(null, { fingerprint: "abc", now: NOW })).toEqual({
      status: "new",
      reason: expect.any(String),
      retryable: true,
    });
  });

  it("returns duplicate for a terminal delivery with the same fingerprint", () => {
    const verdict = classifyDeduplication(
      { fingerprint: "abc", status: "processed", attempts: 1 },
      { fingerprint: "abc", now: NOW },
    );
    expect(verdict.status).toBe("duplicate");
    expect(verdict.retryable).toBe(false);
  });

  it("returns conflict when the key is reused with different content", () => {
    const verdict = classifyDeduplication(
      { fingerprint: "abc", status: "processed", attempts: 1 },
      { fingerprint: "different", now: NOW },
    );
    expect(verdict.status).toBe("conflict");
    expect(verdict.retryable).toBe(false);
    expect(verdict.reason).toMatch(/different payload/i);
  });

  it("returns retry for a failed delivery with budget remaining", () => {
    const verdict = classifyDeduplication(
      { fingerprint: "abc", status: "failed", attempts: 2 },
      { fingerprint: "abc", now: NOW, maxAttempts: 8 },
    );
    expect(verdict.status).toBe("retry");
    expect(verdict.retryable).toBe(true);
  });

  it("returns permanent_failure once the attempt budget is spent", () => {
    const verdict = classifyDeduplication(
      { fingerprint: "abc", status: "failed", attempts: 8 },
      { fingerprint: "abc", now: NOW, maxAttempts: 8 },
    );
    expect(verdict.status).toBe("permanent_failure");
    expect(verdict.retryable).toBe(false);
  });

  it("treats an in-flight attempt as duplicate until its lease expires", () => {
    const fresh = classifyDeduplication(
      { fingerprint: "abc", status: "processing", lastAttemptAt: new Date(NOW - 1_000) },
      { fingerprint: "abc", now: NOW, inFlightTtlMs: 60_000 },
    );
    expect(fresh.status).toBe("duplicate");

    const abandoned = classifyDeduplication(
      { fingerprint: "abc", status: "processing", lastAttemptAt: new Date(NOW - 120_000) },
      { fingerprint: "abc", now: NOW, inFlightTtlMs: 60_000 },
    );
    expect(abandoned.status).toBe("retry");
    expect(abandoned.retryable).toBe(true);
  });

  it("preserves legacy behaviour when no fingerprint was recorded", () => {
    expect(
      classifyDeduplication({ status: "processed" }, { fingerprint: "x", now: NOW }).status,
    ).toBe("duplicate");
    expect(
      classifyDeduplication({ status: "failed", attempts: 1 }, { fingerprint: "x", now: NOW })
        .status,
    ).toBe("retry");
  });

  it("explains every status", () => {
    for (const status of [
      "new",
      "duplicate",
      "conflict",
      "retry",
      "permanent_failure",
    ] as const) {
      expect(deduplicationRemedy(status).length).toBeGreaterThan(10);
    }
  });
});

describe("fingerprints", () => {
  it("is independent of object key order but sensitive to content", () => {
    expect(fingerprintDeduplicationPayload({ a: 1, b: "x" })).toBe(
      fingerprintDeduplicationPayload({ b: "x", a: 1 }),
    );
    expect(fingerprintDeduplicationPayload({ a: 1 })).not.toBe(
      fingerprintDeduplicationPayload({ a: 2 }),
    );
  });

  it("scopes notification content and inbound webhook bytes", () => {
    const a = fingerprintNotification({
      type: "security_alert",
      message: "New device",
      versionIndex: 1,
    });
    const b = fingerprintNotification({
      type: "security_alert",
      message: "New device",
      versionIndex: 2,
    });
    expect(a).not.toBe(b);

    const body = '{"id":"1"}';
    expect(
      fingerprintInboundWebhook({ eventType: "PromptPurchased", source: "s", rawBody: body }),
    ).toBe(
      fingerprintInboundWebhook({ eventType: "PromptPurchased", source: "s", rawBody: body }),
    );
    expect(
      fingerprintInboundWebhook({ eventType: "PromptPurchased", source: "s", rawBody: body }),
    ).not.toBe(
      fingerprintInboundWebhook({
        eventType: "PromptPurchased",
        source: "s",
        rawBody: '{"id":"2"}',
      }),
    );
  });

  it("classifies notification collisions without exposing content", () => {
    const incoming = {
      recipientWallet: "alice",
      type: "security_alert",
      message: "New device",
      versionIndex: 1,
    };
    expect(
      classifyNotificationCollision({
        incoming,
        existing: { message: "New device", versionIndex: 1 },
      }).conflict,
    ).toBe(false);

    const conflict = classifyNotificationCollision({
      incoming,
      existing: { message: "Password changed", versionIndex: 1 },
    });
    expect(conflict).toEqual(
      expect.objectContaining({ duplicate: true, conflict: true }),
    );
    expect(conflict.reason).not.toContain("Password");

    expect(
      classifyNotificationCollision({ incoming, existing: { message: null } }),
    ).toEqual(expect.objectContaining({ duplicate: true, conflict: false }));
  });
});

// ── notification integration ────────────────────────────────────────────────

describe("notification deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("suppresses a conflicting reuse of a dedupe key and audits it", async () => {
    const dup = Object.assign(new Error("dup"), { code: 11000 });
    (Notification.create as any).mockRejectedValueOnce(dup);
    (Notification.findOne as any).mockReturnValue(
      lean({ _id: "existing-id", message: "Original body", versionIndex: 1 }),
    );

    const receipt = await deliverNotification({
      recipientWallet: "GUSER",
      type: "security_alert",
      message: "Different body",
      dedupeKey: "security_alert:event-conflict",
      versionIndex: 1,
      preferences: defaultEffectivePreferences(),
    });

    expect(receipt.delivered).toBe(false);
    expect(receipt.alreadyDelivered).toBe(true);
    expect(receipt.suppressionReason).toBe("dedupe_conflict");
    expect(receipt.notificationId).toBe("existing-id");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification_mandatory_delivered",
        reason: expect.stringContaining("conflict=true"),
      }),
    );
  });

  it("keeps an identical duplicate as a plain duplicate", async () => {
    const dup = Object.assign(new Error("dup"), { code: 11000 });
    (Notification.create as any).mockRejectedValueOnce(dup);
    (Notification.findOne as any).mockReturnValue(
      lean({ _id: "existing-id", message: "Same body", versionIndex: 1 }),
    );

    const receipt = await deliverNotification({
      recipientWallet: "GUSER",
      type: "security_alert",
      message: "Same body",
      dedupeKey: "security_alert:event-same",
      versionIndex: 1,
      preferences: defaultEffectivePreferences(),
    });

    expect(receipt.alreadyDelivered).toBe(true);
    expect(receipt.suppressionReason).toBeUndefined();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.not.stringContaining("conflict=true"),
      }),
    );
  });
});

// ── inbound webhook integration ─────────────────────────────────────────────

describe("inbound webhook deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INBOUND_WEBHOOK_SECRET = "super-secret";
  });

  const secret = "super-secret";
  const existingBody = '{"promptId":"first"}';
  const conflictingBody = '{"promptId":"second"}';
  const timestamp = new Date(NOW).toISOString();
  const idempotencyKey = "idem-conflict-1";
  const deliveryId = "del-1";

  function signedInput(body: string) {
    const signature = `sha256=${createHmac("sha256", secret)
      .update([timestamp, idempotencyKey, deliveryId, body].join("."))
      .digest("hex")}`;
    return {
      idempotencyKey,
      eventType: "PromptPurchased",
      source: "test-source",
      safeHeaders: { "x-prompthash-delivery": deliveryId },
      rawBody: body,
      signature,
      timestamp,
    };
  }

  it("returns conflict when the same key replays different bytes", async () => {
    (InboundWebhookEvent.create as any).mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: 11000 }),
    );
    (InboundWebhookEvent.findOne as any).mockResolvedValue({
      _id: "ev1",
      idempotencyKey,
      eventType: "PromptPurchased",
      source: "test-source",
      rawBody: existingBody,
      processingStatus: "processed",
      attemptCount: 1,
      lastAttemptAt: new Date(NOW),
    });

    const result = await verifyAndProcess(signedInput(conflictingBody), secret);

    expect(result.status).toBe("conflict");
    expect(result.alreadyProcessed).toBe(true);
    expect(result.dedupe).toEqual(
      expect.objectContaining({ status: "conflict", retryable: false }),
    );
    expect(InboundWebhookEvent.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("keeps an identical replay as skipped with duplicate metadata", async () => {
    (InboundWebhookEvent.create as any).mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: 11000 }),
    );
    (InboundWebhookEvent.findOne as any).mockResolvedValue({
      _id: "ev1",
      idempotencyKey,
      eventType: "PromptPurchased",
      source: "test-source",
      rawBody: existingBody,
      processingStatus: "processed",
      attemptCount: 1,
      lastAttemptAt: new Date(NOW),
    });

    const result = await verifyAndProcess(signedInput(existingBody), secret);

    expect(result.status).toBe("skipped");
    expect(result.dedupe?.status).toBe("duplicate");
  });

  it("reports a failed duplicate as retryable without auto-retrying", async () => {
    (InboundWebhookEvent.create as any).mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: 11000 }),
    );
    (InboundWebhookEvent.findOne as any).mockResolvedValue({
      _id: "ev1",
      idempotencyKey,
      eventType: "PromptPurchased",
      source: "test-source",
      rawBody: existingBody,
      processingStatus: "failed",
      attemptCount: 2,
      lastAttemptAt: null,
    });

    const result = await verifyAndProcess(signedInput(existingBody), secret);

    expect(result.status).toBe("failed");
    expect(result.dedupe).toEqual(expect.objectContaining({ status: "retry", retryable: true }));
    // The admin retry endpoint is still the only way to re-run a failed event.
    expect(InboundWebhookEvent.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("answers HTTP 409 for a conflicting replay and 202 for an identical one", async () => {
    const dup = () => Object.assign(new Error("dup"), { code: 11000 });
    const model = InboundWebhookEvent as any;

    model.create.mockRejectedValueOnce(dup());
    model.findOne.mockResolvedValueOnce({
      _id: "ev1",
      rawBody: existingBody,
      processingStatus: "processed",
      attemptCount: 1,
    });
    const conflictRes = mockRes();
    const conflictReq: any = {
      headers: {
        "x-prompthash-event-id": idempotencyKey,
        "x-prompthash-delivery": deliveryId,
        "x-prompthash-event": "PromptPurchased",
        "x-prompthash-signature": "sha256=unused",
        "x-prompthash-timestamp": timestamp,
      },
      body: conflictingBody,
    };
    await ReceiveInboundWebhook(conflictReq, conflictRes);
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.body.code).toBe("WEBHOOK_IDEMPOTENCY_CONFLICT");

    model.create.mockRejectedValueOnce(dup());
    model.findOne.mockResolvedValueOnce({
      _id: "ev1",
      rawBody: existingBody,
      processingStatus: "processed",
      attemptCount: 1,
    });
    const sameRes = mockRes();
    await ReceiveInboundWebhook({ ...conflictReq, body: existingBody }, sameRes);
    expect(sameRes.statusCode).toBe(202);
    expect(sameRes.body.status).toBe("skipped");
  });

  it("still rejects a genuinely bad first signature", async () => {
    (InboundWebhookEvent.create as any).mockResolvedValue({
      _id: "ev-new",
      processingStatus: "pending",
    });
    (InboundWebhookEvent.findByIdAndUpdate as any).mockResolvedValue({});
    const input = signedInput(existingBody);
    expect(
      verifyInboundSignature(
        secret,
        {
          rawBody: input.rawBody,
          timestamp: input.timestamp,
          eventId: input.idempotencyKey,
          deliveryId,
          now: NOW,
        },
        "sha256=bad",
      ),
    ).toBe(false);
  });
});

// ── observability controller ─────────────────────────────────────────────────

describe("deduplication observability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unknown kind and an empty key", async () => {
    const badKind = mockRes();
    await GetDeduplicationStatus(mockReq({ kind: "email", key: "k" }), badKind);
    expect(badKind.statusCode).toBe(400);
    expect(badKind.body.code).toBe("INVALID_DEDUPE_KIND");

    const badKey = mockRes();
    await GetDeduplicationStatus(mockReq({ kind: "notification", key: "  " }), badKey);
    expect(badKey.statusCode).toBe(400);
    expect(badKey.body.code).toBe("INVALID_DEDUPE_KEY");
  });

  it("returns a fingerprint, never the notification body", async () => {
    (Notification.findOne as any).mockReturnValue(
      lean({
        _id: "n1",
        type: "security_alert",
        message: "secret-ish body",
        versionIndex: 1,
        createdAt: new Date(NOW),
      }),
    );
    const res = mockRes();
    await GetDeduplicationStatus(mockReq({ kind: "notification", key: "k1" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(res.body)).not.toContain("secret-ish body");
  });

  it("reports retryability for a failed inbound event without raw payload", async () => {
    (InboundWebhookEvent.findOne as any).mockReturnValue(
      lean({
        _id: "ev1",
        eventType: "PromptPurchased",
        source: "s",
        rawBody: "",
        processingStatus: "failed",
        attemptCount: 2,
        lastAttemptAt: null,
      }),
    );
    const res = mockRes();
    await GetDeduplicationStatus(mockReq({ kind: "webhook", key: "k2" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("failed");
    expect(res.body.retryable).toBe(true);
    expect(res.body.remedy).toMatch(/retry/i);
  });

  it("returns found=false for an unknown key", async () => {
    (Notification.findOne as any).mockReturnValue(lean(null));
    const res = mockRes();
    await GetDeduplicationStatus(mockReq({ kind: "notification", key: "nope" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it("summarizes all three delivery surfaces", async () => {
    (Notification.countDocuments as any).mockResolvedValue(4);
    (InboundWebhookEvent.countDocuments as any)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    (WebhookOutboxEvent.countDocuments as any)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(1);

    const res = mockRes();
    await GetDeduplicationSummary(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      notifications: { keyed: 4 },
      inboundWebhooks: { processed: 10, failed: 2, skipped: 1 },
      outboundWebhooks: { pending: 3, delivered: 20, deadLetter: 1 },
    });
  });
});
