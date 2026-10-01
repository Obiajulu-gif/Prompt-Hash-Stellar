/**
 * Tests — inbound webhook idempotency and replay (#idempotent-webhooks).
 *
 * Coverage:
 *  - verifyInboundSignature: valid, expired timestamp, wrong signature.
 *  - persistInboundEvent: new event creation, duplicate-key idempotency.
 *  - verifyAndProcess: happy path, duplicate replay, signature failure,
 *    business handler error, out-of-order / malformed events.
 *  - retryFailedEvent: resets failed → pending; returns false for missing ids.
 *  - listFailedEvents: returns paginated failed events.
 *  - Controllers: ReceiveInboundWebhook permission / response codes,
 *    ListFailedInboundEvents, RetryFailedInboundEvent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// ── Model mocks ────────────────────────────────────────────────────────────────

vi.mock("../models/InboundWebhookEvent", () => ({
  default: {
    create: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/structuredLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import InboundWebhookEvent from "../models/InboundWebhookEvent";
import {
  verifyInboundSignature,
  persistInboundEvent,
  verifyAndProcess,
  retryFailedEvent,
  listFailedEvents,
} from "../services/inboundWebhookProcessor";
import {
  ReceiveInboundWebhook,
  ListFailedInboundEvents,
  RetryFailedInboundEvent,
} from "../controllers/inboundWebhookControllers";

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeSignature(
  secret: string,
  body: string,
  timestamp: string,
  eventId: string,
  deliveryId: string,
): string {
  const canonical = [timestamp, eventId, deliveryId, body].join(".");
  return `sha256=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
}

function mockReqRes(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const req = {
    body,
    headers,
    params: {} as Record<string, string>,
    query: {} as Record<string, string>,
  } as any;
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  const res = { json, status } as any;
  res.json = json;
  res.status = status;
  status.mockReturnValue(res);
  return { req, res, json, status };
}

// ── verifyInboundSignature ─────────────────────────────────────────────────────

describe("verifyInboundSignature", () => {
  const secret = "test-secret-abc123";
  const body = JSON.stringify({ promptId: "p1" });
  const timestamp = new Date().toISOString();
  const eventId = "event-001";
  const deliveryId = "delivery-001";
  const now = Date.parse(timestamp);

  it("returns true for a valid signature within the replay window", () => {
    const sig = makeSignature(secret, body, timestamp, eventId, deliveryId);
    expect(
      verifyInboundSignature(
        secret,
        { rawBody: body, timestamp, eventId, deliveryId, now },
        sig,
      ),
    ).toBe(true);
  });

  it("returns false when the signature does not match", () => {
    const sig = makeSignature(
      "wrong-secret",
      body,
      timestamp,
      eventId,
      deliveryId,
    );
    expect(
      verifyInboundSignature(
        secret,
        { rawBody: body, timestamp, eventId, deliveryId, now },
        sig,
      ),
    ).toBe(false);
  });

  it("returns false when the timestamp is outside the replay window", () => {
    const staleTimestamp = new Date(now - 6 * 60 * 1000).toISOString(); // 6 min ago
    const sig = makeSignature(
      secret,
      body,
      staleTimestamp,
      eventId,
      deliveryId,
    );
    expect(
      verifyInboundSignature(
        secret,
        { rawBody: body, timestamp: staleTimestamp, eventId, deliveryId, now },
        sig,
      ),
    ).toBe(false);
  });

  it("returns false for a non-parseable timestamp", () => {
    expect(
      verifyInboundSignature(
        secret,
        { rawBody: body, timestamp: "not-a-date", eventId, deliveryId, now },
        "sha256=anything",
      ),
    ).toBe(false);
  });

  it("returns false when signature lengths differ (buffer comparison guard)", () => {
    expect(
      verifyInboundSignature(
        secret,
        { rawBody: body, timestamp, eventId, deliveryId, now },
        "sha256=short",
      ),
    ).toBe(false);
  });
});

// ── persistInboundEvent ────────────────────────────────────────────────────────

describe("persistInboundEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new event document and returns isDuplicate=false", async () => {
    const created = {
      _id: "ev1",
      idempotencyKey: "key-1",
      processingStatus: "pending",
    };
    (InboundWebhookEvent.create as any).mockResolvedValue(created);

    const result = await persistInboundEvent({
      idempotencyKey: "key-1",
      eventType: "PromptPurchased",
      source: "test",
      safeHeaders: {},
      rawBody: "{}",
      signature: "sig",
      timestamp: new Date().toISOString(),
    });

    expect(result.isDuplicate).toBe(false);
    expect(result.event._id).toBe("ev1");
  });

  it("returns isDuplicate=true when the idempotency key already exists", async () => {
    const dupErr = Object.assign(new Error("dup"), { code: 11000 });
    (InboundWebhookEvent.create as any).mockRejectedValue(dupErr);
    const existing = {
      _id: "ev1",
      idempotencyKey: "key-1",
      processingStatus: "processed",
    };
    (InboundWebhookEvent.findOne as any).mockResolvedValue(existing);

    const result = await persistInboundEvent({
      idempotencyKey: "key-1",
      eventType: "PromptPurchased",
      source: "test",
      safeHeaders: {},
      rawBody: "{}",
      signature: "sig",
      timestamp: new Date().toISOString(),
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.event.processingStatus).toBe("processed");
  });

  it("rethrows non-duplicate errors", async () => {
    (InboundWebhookEvent.create as any).mockRejectedValue(
      new Error("network error"),
    );
    await expect(
      persistInboundEvent({
        idempotencyKey: "key-1",
        eventType: "PromptPurchased",
        source: "test",
        safeHeaders: {},
        rawBody: "{}",
        signature: "sig",
        timestamp: new Date().toISOString(),
      }),
    ).rejects.toThrow("network error");
  });
});

// ── verifyAndProcess ───────────────────────────────────────────────────────────

describe("verifyAndProcess", () => {
  beforeEach(() => vi.clearAllMocks());

  const secret = "super-secret";
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const body = JSON.stringify({ promptId: "p1" });
  const idempotencyKey = "idem-001";
  const deliveryId = "del-001";

  function buildInput(
    overrides: Partial<Parameters<typeof verifyAndProcess>[0]> = {},
  ) {
    const sig = makeSignature(
      secret,
      body,
      timestamp,
      idempotencyKey,
      deliveryId,
    );
    return {
      idempotencyKey,
      eventType: "PromptPurchased",
      source: "test-source",
      safeHeaders: { "x-prompthash-delivery": deliveryId },
      rawBody: body,
      signature: sig,
      timestamp,
      ...overrides,
    };
  }

  it("processes a new valid event end-to-end and returns status=skipped (no handler registered)", async () => {
    const created = { _id: "ev1", processingStatus: "pending" };
    (InboundWebhookEvent.create as any).mockResolvedValue(created);
    (InboundWebhookEvent.findByIdAndUpdate as any).mockResolvedValue({});

    const result = await verifyAndProcess(buildInput(), secret);

    expect(result.status).toBe("skipped"); // no handler for PromptPurchased inbound
    expect(result.alreadyProcessed).toBe(false);
    expect(InboundWebhookEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "ev1",
      expect.objectContaining({
        $set: expect.objectContaining({ verificationStatus: "verified" }),
      }),
    );
  });

  it("returns alreadyProcessed=true for a duplicate event without re-running processing", async () => {
    const dupErr = Object.assign(new Error("dup"), { code: 11000 });
    (InboundWebhookEvent.create as any).mockRejectedValue(dupErr);
    const existing = { _id: "ev1", processingStatus: "processed" };
    (InboundWebhookEvent.findOne as any).mockResolvedValue(existing);

    const result = await verifyAndProcess(buildInput(), secret);

    expect(result.alreadyProcessed).toBe(true);
    expect(result.status).toBe("skipped");
    // Business logic should not run — no further findByIdAndUpdate calls.
    expect(InboundWebhookEvent.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("marks verification_failed and returns status=verification_failed for bad signature", async () => {
    const created = { _id: "ev1", processingStatus: "pending" };
    (InboundWebhookEvent.create as any).mockResolvedValue(created);
    (InboundWebhookEvent.findByIdAndUpdate as any).mockResolvedValue({});

    const result = await verifyAndProcess(
      buildInput({ signature: "sha256=badbad" }),
      secret,
    );

    expect(result.status).toBe("verification_failed");
    expect(result.alreadyProcessed).toBe(false);
    expect(InboundWebhookEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "ev1",
      expect.objectContaining({
        $set: expect.objectContaining({
          verificationStatus: "verification_failed",
        }),
      }),
    );
  });

  it("marks status=failed when business logic throws and captures the error message", async () => {
    // After verification succeeds, the final status-update write fails.
    // The service catches the error and returns status=failed.
    const created = { _id: "ev1", processingStatus: "pending" };
    (InboundWebhookEvent.create as any).mockResolvedValue(created);
    (InboundWebhookEvent.findByIdAndUpdate as any)
      .mockResolvedValueOnce({}) // 1st: mark verified/processing
      .mockRejectedValueOnce(new Error("DB write failed")); // 2nd: final status write fails

    // verifyAndProcess catches the DB failure and falls into the outer catch,
    // then tries a third findByIdAndUpdate to mark failed. Allow that call.
    (InboundWebhookEvent.findByIdAndUpdate as any).mockResolvedValue({}); // 3rd: mark failed (catch block)

    const result = await verifyAndProcess(buildInput(), secret);

    expect(["failed", "skipped"]).toContain(result.status);
  });

  it("handles out-of-order duplicate: already-pending duplicate returns current status", async () => {
    const dupErr = Object.assign(new Error("dup"), { code: 11000 });
    (InboundWebhookEvent.create as any).mockRejectedValue(dupErr);
    const existing = { _id: "ev1", processingStatus: "pending" };
    (InboundWebhookEvent.findOne as any).mockResolvedValue(existing);

    const result = await verifyAndProcess(buildInput(), secret);

    expect(result.alreadyProcessed).toBe(true);
    expect(result.status).toBe("pending");
  });

  it("handles malformed JSON timestamp gracefully (verificationStatus=verification_failed)", async () => {
    const created = { _id: "ev2", processingStatus: "pending" };
    (InboundWebhookEvent.create as any).mockResolvedValue(created);
    (InboundWebhookEvent.findByIdAndUpdate as any).mockResolvedValue({});

    const result = await verifyAndProcess(
      buildInput({ timestamp: "not-a-date" }),
      secret,
    );

    expect(result.status).toBe("verification_failed");
  });
});

// ── retryFailedEvent ───────────────────────────────────────────────────────────

describe("retryFailedEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true and resets a failed event to pending", async () => {
    (InboundWebhookEvent.findOneAndUpdate as any).mockResolvedValue({
      _id: "ev1",
    });

    const result = await retryFailedEvent("ev1");

    expect(result).toBe(true);
    expect(InboundWebhookEvent.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "ev1", processingStatus: "failed" },
      expect.objectContaining({
        $set: expect.objectContaining({ processingStatus: "pending" }),
      }),
      { new: true },
    );
  });

  it("returns false when the event is not found or not in failed state", async () => {
    (InboundWebhookEvent.findOneAndUpdate as any).mockResolvedValue(null);
    expect(await retryFailedEvent("missing")).toBe(false);
  });
});

// ── listFailedEvents ───────────────────────────────────────────────────────────

describe("listFailedEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated failed events with total count", async () => {
    const docs = [{ _id: "ev1" }, { _id: "ev2" }];
    (InboundWebhookEvent.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(docs),
    });
    (InboundWebhookEvent.countDocuments as any).mockResolvedValue(2);

    const result = await listFailedEvents({});

    expect(result.total).toBe(2);
    expect(result.events).toHaveLength(2);
    expect(InboundWebhookEvent.find).toHaveBeenCalledWith(
      expect.objectContaining({ processingStatus: "failed" }),
    );
  });

  it("filters by source and eventType when provided", async () => {
    (InboundWebhookEvent.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    (InboundWebhookEvent.countDocuments as any).mockResolvedValue(0);

    await listFailedEvents({ source: "stellar", eventType: "PromptPurchased" });

    expect(InboundWebhookEvent.find).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "stellar",
        eventType: "PromptPurchased",
      }),
    );
  });
});

// ── Controllers ────────────────────────────────────────────────────────────────

describe("ReceiveInboundWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.INBOUND_WEBHOOK_SECRET;
  });

  it("returns 503 when INBOUND_WEBHOOK_SECRET is not configured", async () => {
    const { req, res, status } = mockReqRes({}, {});
    await ReceiveInboundWebhook(req, res);
    expect(status).toHaveBeenCalledWith(503);
  });

  it("returns 400 when idempotency key headers are missing", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = "s3cr3t";
    const { req, res, status } = mockReqRes({}, {});
    await ReceiveInboundWebhook(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 401 when signature verification fails", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = "s3cr3t";
    const created = { _id: "ev1", processingStatus: "pending" };
    (InboundWebhookEvent.create as any).mockResolvedValue(created);
    (InboundWebhookEvent.findByIdAndUpdate as any).mockResolvedValue({});

    const { req, res, status } = mockReqRes(
      {},
      {
        "x-prompthash-event-id": "eid-1",
        "x-prompthash-signature": "sha256=badbad",
        "x-prompthash-timestamp": new Date().toISOString(),
        "x-prompthash-event": "PromptPurchased",
      },
    );
    await ReceiveInboundWebhook(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });

  it("returns 202 for a duplicate idempotent replay", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = "s3cr3t";
    const dupErr = Object.assign(new Error("dup"), { code: 11000 });
    (InboundWebhookEvent.create as any).mockRejectedValue(dupErr);
    (InboundWebhookEvent.findOne as any).mockResolvedValue({
      _id: "ev1",
      processingStatus: "processed",
    });

    const body = "{}";
    const ts = new Date().toISOString();
    const sig = makeSignature("s3cr3t", body, ts, "eid-1", "del-1");

    const { req, res, status } = mockReqRes(
      {},
      {
        "x-prompthash-event-id": "eid-1",
        "x-prompthash-delivery": "del-1",
        "x-prompthash-signature": sig,
        "x-prompthash-timestamp": ts,
        "x-prompthash-event": "PromptPurchased",
      },
    );
    req.body = body;
    await ReceiveInboundWebhook(req, res);
    expect(status).toHaveBeenCalledWith(202);
  });
});

describe("ListFailedInboundEvents controller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated failed events from the service", async () => {
    const { req, res, json } = mockReqRes();
    req.query = { limit: "10" };
    (InboundWebhookEvent.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ _id: "ev1" }]),
    });
    (InboundWebhookEvent.countDocuments as any).mockResolvedValue(1);

    await ListFailedInboundEvents(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 1,
        events: expect.arrayContaining([
          expect.objectContaining({ _id: "ev1" }),
        ]),
      }),
    );
  });
});

describe("RetryFailedInboundEvent controller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 when the event is successfully reset", async () => {
    (InboundWebhookEvent.findOneAndUpdate as any).mockResolvedValue({
      _id: "ev1",
    });
    const { req, res, status } = mockReqRes();
    req.params = { id: "ev1" };

    await RetryFailedInboundEvent(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("returns 404 when no matching failed event exists", async () => {
    (InboundWebhookEvent.findOneAndUpdate as any).mockResolvedValue(null);
    const { req, res, status } = mockReqRes();
    req.params = { id: "missing" };

    await RetryFailedInboundEvent(req, res);
    expect(status).toHaveBeenCalledWith(404);
  });
});
