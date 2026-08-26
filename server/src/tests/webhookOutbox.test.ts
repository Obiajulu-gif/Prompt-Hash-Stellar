import { describe, it, expect, vi, beforeEach } from "vitest";
import WebhookOutboxEvent from "../models/WebhookOutboxEvent";
import WebhookSubscription from "../models/WebhookSubscription";
import { enqueue, listDeadLetters, replayDeadLetter, rotateSigningKey } from "../services/webhookOutbox";
import { claimRow, deliverRow } from "../services/webhookOutboxWorker";
import { postSignedWebhook, UnsafeWebhookUrlError, assertSafeWebhookUrlShape } from "../services/ssrfGuard";

vi.mock("../models/WebhookOutboxEvent", () => ({
  default: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock("../models/WebhookSubscription", () => ({
  default: {
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock("../services/ssrfGuard", async () => {
  const actual = await vi.importActual<typeof import("../services/ssrfGuard")>(
    "../services/ssrfGuard",
  );
  return {
    ...actual,
    postSignedWebhook: vi.fn(),
  };
});

describe("webhookOutbox.enqueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates one durable row per active matching subscription", async () => {
    (WebhookSubscription.find as any).mockResolvedValue([
      { _id: "sub-1" },
      { _id: "sub-2" },
    ]);
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
    (WebhookSubscription.findByIdAndUpdate as any)
      .mockResolvedValueOnce({ _id: "sub-1", nextDeliverySequence: 7 })
      .mockResolvedValueOnce({ _id: "sub-2", nextDeliverySequence: 3 });
    (WebhookOutboxEvent.create as any).mockResolvedValue({ _id: "row" });

    await enqueue("0xCREATOR", "PromptPurchased", { promptId: "1" }, "event-42");

    expect(WebhookOutboxEvent.create).toHaveBeenCalledTimes(2);
    expect(WebhookOutboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub-1", dedupeKey: "event-42" }),
    );
    expect(WebhookOutboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-42",
        deliveryId: expect.any(String),
        sequence: 7,
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("swallows a duplicate-key error so a repeat enqueue is a no-op", async () => {
    (WebhookSubscription.find as any).mockResolvedValue([{ _id: "sub-1" }]);
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({
      _id: "sub-1",
      nextDeliverySequence: 2,
    });
    const dup = new Error("duplicate") as any;
    dup.code = 11000;
    (WebhookOutboxEvent.create as any).mockRejectedValueOnce(dup);

    await expect(
      enqueue("0xCREATOR", "PromptPurchased", { promptId: "1" }, "event-42"),
    ).resolves.not.toThrow();
  });

  it("re-throws a non-duplicate-key error", async () => {
    (WebhookSubscription.find as any).mockResolvedValue([{ _id: "sub-1" }]);
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({
      _id: "sub-1",
      nextDeliverySequence: 2,
    });
    (WebhookOutboxEvent.create as any).mockRejectedValueOnce(new Error("db down"));

    await expect(
      enqueue("0xCREATOR", "PromptPurchased", { promptId: "1" }, "event-42"),
    ).rejects.toThrow("db down");
  });
});

describe("webhookOutboxWorker.claimRow — concurrent-worker safety", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only one of two racing claims succeeds for the same row", async () => {
    // First worker's atomic update matches and claims the row; a second
    // worker racing the same tick finds it already leased and gets null.
    (WebhookOutboxEvent.findOneAndUpdate as any)
      .mockResolvedValueOnce({ _id: "row-1", leaseHolder: "worker-a" })
      .mockResolvedValueOnce(null);

    const now = new Date();
    const first = await claimRow(now);
    const second = await claimRow(now);

    expect(first).toEqual({ _id: "row-1", leaseHolder: "worker-a" });
    expect(second).toBeNull();
    expect(WebhookOutboxEvent.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});

describe("webhookOutboxWorker.deliverRow", () => {
  beforeEach(() => vi.clearAllMocks());

  const baseRow = () => ({
    _id: "row-1",
    subscriptionId: "sub-1",
    eventId: "event-42",
    deliveryId: "delivery-42",
    sequence: 1,
    payloadHash: "a".repeat(64),
    event: "PromptPurchased",
    payload: { promptId: "1" },
    attempts: 0,
  });

  it("marks a 2xx response delivered and resets the subscription failure count", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    (postSignedWebhook as any).mockResolvedValue({ status: 200, body: "ok", headers: {} });
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);

    await deliverRow(baseRow() as any);

    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ $set: expect.objectContaining({ status: "delivered" }) }),
    );
    expect(WebhookSubscription.findByIdAndUpdate).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ $set: expect.objectContaining({ failureCount: 0 }) }),
    );
  });

  it("sends stable delivery identity, sequence, and payload hash on every retry", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    (postSignedWebhook as any).mockResolvedValue({ status: 503, body: "", headers: {} });
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);

    await deliverRow({ ...baseRow(), attempts: 1 } as any);

    const [, headers, body] = (postSignedWebhook as any).mock.calls[0];
    expect(headers).toMatchObject({
      "X-PromptHash-Delivery": "delivery-42",
      "X-PromptHash-Event-Id": "event-42",
      "X-PromptHash-Sequence": "1",
      "X-PromptHash-Payload-Hash": "a".repeat(64),
    });
    expect(JSON.parse(body)).toMatchObject({
      eventId: "event-42",
      deliveryId: "delivery-42",
      sequence: 1,
      payloadHash: "a".repeat(64),
    });
  });

  it("does not deliver a later sequence while an earlier row is still undelivered", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    (WebhookOutboxEvent.findOne as any).mockResolvedValue({ _id: "row-previous" });

    await deliverRow({ ...baseRow(), sequence: 2 } as any);

    expect(postSignedWebhook).not.toHaveBeenCalled();
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({
        $set: expect.objectContaining({
          lastError: "Waiting for earlier subscription delivery sequence.",
        }),
      }),
    );
  });

  it("dead-letters immediately on a non-429 4xx without scheduling a retry", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    (postSignedWebhook as any).mockResolvedValue({ status: 400, body: "bad", headers: {} });

    await deliverRow(baseRow() as any);

    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ $set: expect.objectContaining({ status: "dead_letter" }) }),
    );
  });

  it("retries a 5xx with an incremented attempt count instead of dead-lettering early", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    (postSignedWebhook as any).mockResolvedValue({ status: 503, body: "", headers: {} });

    await deliverRow(baseRow() as any);

    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ $set: expect.objectContaining({ attempts: 1 }) }),
    );
    const call = (WebhookOutboxEvent.findByIdAndUpdate as any).mock.calls[0][1];
    expect(call.$set.status).toBeUndefined();
  });

  it("dead-letters after exhausting the retry budget", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    (postSignedWebhook as any).mockResolvedValue({ status: 503, body: "", headers: {} });
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({
      failureCount: 1,
    });

    await deliverRow({ ...baseRow(), attempts: 7 } as any); // 8th attempt == MAX_ATTEMPTS

    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ $set: expect.objectContaining({ status: "dead_letter" }) }),
    );
  });

  it("honors a 429 Retry-After header instead of computed backoff", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    (postSignedWebhook as any).mockResolvedValue({
      status: 429,
      body: "",
      headers: { "retry-after": "5" },
    });

    const before = Date.now();
    await deliverRow(baseRow() as any);

    const call = (WebhookOutboxEvent.findByIdAndUpdate as any).mock.calls[0][1];
    const scheduledDelay = call.$set.nextAttemptAt.getTime() - before;
    expect(scheduledDelay).toBeGreaterThanOrEqual(4_500);
    expect(scheduledDelay).toBeLessThanOrEqual(6_000);
  });

  it("dead-letters on a timeout/network error only once retries are exhausted", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    (postSignedWebhook as any).mockRejectedValue(new Error("Webhook delivery timed out."));

    await deliverRow({ ...baseRow(), attempts: 7 } as any);

    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ $set: expect.objectContaining({ status: "dead_letter" }) }),
    );
  });

  it("dead-letters immediately for an SSRF-unsafe target without retrying", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://169.254.169.254/hook",
      secret: "s3cret",
    });
    (postSignedWebhook as any).mockRejectedValue(new UnsafeWebhookUrlError("blocked"));

    await deliverRow(baseRow() as any);

    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({
        $set: expect.objectContaining({ status: "dead_letter", lastError: expect.stringContaining("Blocked unsafe URL") }),
      }),
    );
  });

  it("dead-letters immediately when the subscription no longer exists", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue(null);

    await deliverRow(baseRow() as any);

    expect(postSignedWebhook).not.toHaveBeenCalled();
    expect(WebhookOutboxEvent.findByIdAndUpdate).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ $set: expect.objectContaining({ status: "dead_letter" }) }),
    );
  });
});

describe("webhookOutbox dead-letter inspection and replay", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only dead-lettered rows", async () => {
    const sort = vi.fn().mockReturnThis();
    const limit = vi.fn().mockResolvedValue([{ _id: "row-1" }]);
    (WebhookOutboxEvent.find as any).mockReturnValue({ sort, limit });

    const rows = await listDeadLetters({});

    expect(WebhookOutboxEvent.find).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dead_letter" }),
    );
    expect(rows).toEqual([{ _id: "row-1" }]);
  });

  it("resets a dead-lettered row back to pending for redelivery", async () => {
    (WebhookOutboxEvent.findOneAndUpdate as any).mockResolvedValue({ _id: "row-1" });

    const replayed = await replayDeadLetter("row-1");

    expect(replayed).toBe(true);
    expect(WebhookOutboxEvent.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "row-1", status: "dead_letter" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "pending", attempts: 0 }) }),
    );
  });

  it("returns false when there is nothing to replay", async () => {
    (WebhookOutboxEvent.findOneAndUpdate as any).mockResolvedValue(null);
    await expect(replayDeadLetter("missing")).resolves.toBe(false);
  });
});

describe("webhookOutbox.rotateSigningKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves the current secret to previousSecret and issues a fresh one", async () => {
    const sub = { _id: "sub-1", secret: "old-secret", save: vi.fn().mockResolvedValue(undefined) } as any;
    (WebhookSubscription.findById as any).mockResolvedValue(sub);

    const newSecret = await rotateSigningKey("sub-1");

    expect(newSecret).toBeTruthy();
    expect(newSecret).not.toBe("old-secret");
    expect(sub.previousSecret).toBe("old-secret");
    expect(sub.secret).toBe(newSecret);
    expect(sub.previousSecretExpiresAt).toBeInstanceOf(Date);
    expect(sub.save).toHaveBeenCalled();
  });

  it("returns null for an unknown subscription", async () => {
    (WebhookSubscription.findById as any).mockResolvedValue(null);
    await expect(rotateSigningKey("missing")).resolves.toBeNull();
  });
});

describe("ssrfGuard.assertSafeWebhookUrlShape", () => {
  it("rejects non-https URLs", () => {
    expect(() => assertSafeWebhookUrlShape("http://example.com/hook")).toThrow(
      UnsafeWebhookUrlError,
    );
  });

  it("rejects URLs carrying embedded credentials", () => {
    expect(() => assertSafeWebhookUrlShape("https://user:pass@example.com/hook")).toThrow(
      UnsafeWebhookUrlError,
    );
  });

  it("rejects a literal loopback address", () => {
    expect(() => assertSafeWebhookUrlShape("https://127.0.0.1/hook")).toThrow(
      UnsafeWebhookUrlError,
    );
  });

  it("rejects the cloud metadata address", () => {
    expect(() => assertSafeWebhookUrlShape("https://169.254.169.254/hook")).toThrow(
      UnsafeWebhookUrlError,
    );
  });

  it("rejects a private RFC1918 address", () => {
    expect(() => assertSafeWebhookUrlShape("https://10.0.0.5/hook")).toThrow(
      UnsafeWebhookUrlError,
    );
  });

  it("accepts a plain public https URL", () => {
    expect(() => assertSafeWebhookUrlShape("https://example.com/hook")).not.toThrow();
  });
});
