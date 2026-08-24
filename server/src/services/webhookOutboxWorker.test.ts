import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeRetryDelay } from "./webhookOutboxWorker";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock mongoose models
vi.mock("../models/WebhookOutboxEvent", () => {
  const docs: Record<string, any> = {};
  let idCounter = 0;

  const Model = {
    find: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue([]),
    countDocuments: vi.fn().mockResolvedValue(0),
    findByIdAndUpdate: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
    _docs: docs,
    _idCounter: idCounter,
  };

  return { default: Model };
});

vi.mock("../models/WebhookSubscription", () => ({
  default: {
    find: vi.fn().mockResolvedValue([]),
    findByIdAndUpdate: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("./ssrfGuard", () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeRetryDelay", () => {
  it("returns a number within expected range for attempt 0", () => {
    // Base 1000ms + 0-40% jitter = 1000..1400
    for (let i = 0; i < 50; i++) {
      const delay = computeRetryDelay(0);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1400);
    }
  });

  it("returns a number within expected range for attempt 1", () => {
    // Base 2000ms + 0-40% jitter = 2000..2800
    for (let i = 0; i < 50; i++) {
      const delay = computeRetryDelay(1);
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(2800);
    }
  });

  it("exponentially increases the base delay", () => {
    const delay0 = computeRetryDelay(0);
    const delay3 = computeRetryDelay(3);
    // attempt 3: base = 1000 * 2^3 = 8000, range 8000..11200
    expect(delay3).toBeGreaterThanOrEqual(8000);
    expect(delay3).toBeLessThanOrEqual(11200);
  });

  it("caps at MAX_DELAY_MS (5 minutes = 300000)", () => {
    // attempt 20 would be 1000 * 2^20 = 1,048,576,000 but capped at 300,000
    const delay = computeRetryDelay(20);
    expect(delay).toBeLessThanOrEqual(300000 * 1.4); // cap + jitter
  });
});

describe("processBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when no events are pending", async () => {
    const WebhookOutboxEvent = (await import("../models/WebhookOutboxEvent")).default;
    (WebhookOutboxEvent.find as any).mockResolvedValue([]);

    const { processBatch } = await import("./webhookOutboxWorker");
    const count = await processBatch();
    expect(count).toBe(0);
  });

  it("processes events and marks successful deliveries as delivered", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const mockEvent = {
      _id: "evt-1",
      subscriptionId: "sub-1",
      url: "https://example.com/webhook",
      secret: "s3cret",
      event: "PromptPurchased",
      deliveryId: "del-1",
      payload: { event: "PromptPurchased", data: {} },
      attemptCount: 0,
      maxAttempts: 8,
      nextRetryAt: new Date(),
      status: "pending",
    };

    const WebhookOutboxEvent = (await import("../models/WebhookOutboxEvent")).default;
    (WebhookOutboxEvent.find as any).mockResolvedValue([mockEvent]);

    const { processBatch } = await import("./webhookOutboxWorker");
    const count = await processBatch();

    expect(count).toBe(1);
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "evt-1",
      expect.objectContaining({ status: "delivered" }),
    );
  });

  it("retries on 5xx with exponential backoff", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const mockEvent = {
      _id: "evt-2",
      subscriptionId: "sub-2",
      url: "https://example.com/webhook",
      secret: "s3cret",
      event: "PromptPurchased",
      deliveryId: "del-2",
      payload: { event: "PromptPurchased", data: {} },
      attemptCount: 0,
      maxAttempts: 8,
      nextRetryAt: new Date(),
      status: "pending",
    };

    const WebhookOutboxEvent = (await import("../models/WebhookOutboxEvent")).default;
    (WebhookOutboxEvent.find as any).mockResolvedValue([mockEvent]);

    const { processBatch } = await import("./webhookOutboxWorker");
    const count = await processBatch();

    expect(count).toBe(1);
    // Should schedule a retry, not dead-letter
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "evt-2",
      expect.objectContaining({
        status: "pending",
        attemptCount: 1,
      }),
    );
  });

  it("dead-letters immediately on persistent 4xx (not 408/429)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });

    const mockEvent = {
      _id: "evt-3",
      subscriptionId: "sub-3",
      url: "https://example.com/webhook",
      secret: "s3cret",
      event: "PromptPurchased",
      deliveryId: "del-3",
      payload: { event: "PromptPurchased", data: {} },
      attemptCount: 0,
      maxAttempts: 8,
      nextRetryAt: new Date(),
      status: "pending",
    };

    const WebhookOutboxEvent = (await import("../models/WebhookOutboxEvent")).default;
    (WebhookOutboxEvent.find as any).mockResolvedValue([mockEvent]);

    const { processBatch } = await import("./webhookOutboxWorker");
    const count = await processBatch();

    expect(count).toBe(1);
    // 400 is a permanent failure → dead-letter immediately
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "evt-3",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("retries on 408 and 429 (transient client errors)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    const mockEvent = {
      _id: "evt-4",
      subscriptionId: "sub-4",
      url: "https://example.com/webhook",
      secret: "s3cret",
      event: "PromptPurchased",
      deliveryId: "del-4",
      payload: { event: "PromptPurchased", data: {} },
      attemptCount: 0,
      maxAttempts: 8,
      nextRetryAt: new Date(),
      status: "pending",
    };

    const WebhookOutboxEvent = (await import("../models/WebhookOutboxEvent")).default;
    (WebhookOutboxEvent.find as any).mockResolvedValue([mockEvent]);

    const { processBatch } = await import("./webhookOutboxWorker");
    const count = await processBatch();

    expect(count).toBe(1);
    // 429 is transient → should retry, not dead-letter
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "evt-4",
      expect.objectContaining({
        status: "pending",
        attemptCount: 1,
      }),
    );
  });

  it("dead-letters after exhausting maxAttempts", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const mockEvent = {
      _id: "evt-5",
      subscriptionId: "sub-5",
      url: "https://example.com/webhook",
      secret: "s3cret",
      event: "PromptPurchased",
      deliveryId: "del-5",
      payload: { event: "PromptPurchased", data: {} },
      attemptCount: 7, // one less than maxAttempts=8
      maxAttempts: 8,
      nextRetryAt: new Date(),
      status: "pending",
    };

    const WebhookOutboxEvent = (await import("../models/WebhookOutboxEvent")).default;
    (WebhookOutboxEvent.find as any).mockResolvedValue([mockEvent]);

    const { processBatch } = await import("./webhookOutboxWorker");
    const count = await processBatch();

    expect(count).toBe(1);
    // attemptCount 7 + 1 = 8 = maxAttempts → dead-letter
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "evt-5",
      expect.objectContaining({ status: "failed" }),
    );
  });
});

describe("intermittent failure recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("event that fails then recovers is marked delivered", async () => {
    // First batch: fails with 500
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const mockEvent = {
      _id: "evt-recover",
      subscriptionId: "sub-recover",
      url: "https://example.com/webhook",
      secret: "s3cret",
      event: "PromptPurchased",
      deliveryId: "del-recover",
      payload: { event: "PromptPurchased", data: {} },
      attemptCount: 0,
      maxAttempts: 8,
      nextRetryAt: new Date(),
      status: "pending",
    };

    const WebhookOutboxEvent = (await import("../models/WebhookOutboxEvent")).default;
    (WebhookOutboxEvent.find as any).mockResolvedValue([mockEvent]);

    const { processBatch } = await import("./webhookOutboxWorker");

    // First attempt: fails, schedules retry
    await processBatch();
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "evt-recover",
      expect.objectContaining({ status: "pending", attemptCount: 1 }),
    );

    // Second attempt: succeeds
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    const recoveredEvent = { ...mockEvent, attemptCount: 1, status: "pending" };
    (WebhookOutboxEvent.find as any).mockResolvedValue([recoveredEvent]);

    await processBatch();
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "evt-recover",
      expect.objectContaining({ status: "delivered" }),
    );
  });
});
