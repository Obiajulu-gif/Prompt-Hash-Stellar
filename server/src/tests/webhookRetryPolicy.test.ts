import { describe, it, expect, vi, beforeEach } from "vitest";
import WebhookOutboxEvent from "../models/WebhookOutboxEvent";
import WebhookSubscription from "../models/WebhookSubscription";
import {
  WEBHOOK_RETRY_POLICY,
  computeBackoffDelayMs,
  deliverRow,
} from "../services/webhookOutboxWorker";
import { postSignedWebhook } from "../services/ssrfGuard";

/*
 * Retry-policy tests for the webhook outbox (#606).
 *
 * Unlike the single-call tests in webhookOutbox.test.ts, these drive
 * `deliverRow` repeatedly against an in-memory outbox row, the way the poll
 * loop re-claims a row after each scheduled retry. That verifies the full
 * lifecycle: how many deliveries are made, when the row reaches a terminal
 * state, and that a recovered subscriber ends in `delivered`.
 */

vi.mock("../models/WebhookOutboxEvent", () => ({
  default: {
    find: vi.fn(),
    findOne: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock("../models/WebhookSubscription", () => ({
  default: {
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock("../services/ssrfGuard", async () => {
  const actual = await vi.importActual<typeof import("../services/ssrfGuard")>(
    "../services/ssrfGuard",
  );
  return { ...actual, postSignedWebhook: vi.fn() };
});

type Row = Record<string, any>;

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    _id: "row-1",
    subscriptionId: "sub-1",
    eventId: "event-42",
    deliveryId: "delivery-42",
    sequence: 1,
    payloadHash: "a".repeat(64),
    event: "PromptPurchased",
    payload: { promptId: "1" },
    status: "pending",
    attempts: 0,
    inactiveDeferrals: 0,
    ...overrides,
  };
}

/** Applies `$set` updates from the worker onto the in-memory row. */
function persistTo(row: Row) {
  (WebhookOutboxEvent.findByIdAndUpdate as any).mockImplementation(
    async (_id: unknown, update: { $set?: Row }) => {
      if (update?.$set) Object.assign(row, update.$set);
      return row;
    },
  );
}

function activeSub(overrides: Record<string, unknown> = {}) {
  (WebhookSubscription.findById as any).mockResolvedValue({
    _id: "sub-1",
    active: true,
    url: "https://example.com/hook",
    secret: "s3cret",
    ...overrides,
  });
}

/** Runs the worker until the row leaves `pending`, or the bound is hit. */
async function runUntilTerminal(row: Row, maxIterations: number) {
  for (let i = 0; i < maxIterations && row.status === "pending"; i++) {
    await deliverRow(row as any);
  }
}

describe("webhook retry policy — always-failing subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({ failureCount: 1 });
    activeSub();
  });

  it("retries a subscriber that always returns 500 exactly maxAttempts times, then dead-letters", async () => {
    const row = makeRow();
    persistTo(row);
    (postSignedWebhook as any).mockResolvedValue({ status: 500, body: "", headers: {} });

    await runUntilTerminal(row, WEBHOOK_RETRY_POLICY.maxAttempts + 5);

    expect(postSignedWebhook).toHaveBeenCalledTimes(WEBHOOK_RETRY_POLICY.maxAttempts);
    expect(row.status).toBe("dead_letter");
    expect(row.attempts).toBe(WEBHOOK_RETRY_POLICY.maxAttempts);
    expect(row.deadLetteredAt).toBeInstanceOf(Date);
    expect(row.lastError).toMatch(/Server error 500 after 8 attempts/);
  });

  it("keeps the same deliveryId across every retry so the subscriber can de-duplicate", async () => {
    const row = makeRow();
    persistTo(row);
    (postSignedWebhook as any).mockResolvedValue({ status: 503, body: "", headers: {} });

    await runUntilTerminal(row, WEBHOOK_RETRY_POLICY.maxAttempts + 5);

    const deliveryIds = (postSignedWebhook as any).mock.calls.map(
      ([, headers]: [string, Record<string, string>]) => headers["X-PromptHash-Delivery"],
    );
    expect(new Set(deliveryIds)).toEqual(new Set(["delivery-42"]));
  });

  it("does not hang: every retry schedules a future attempt until the budget runs out", async () => {
    const row = makeRow();
    persistTo(row);
    (postSignedWebhook as any).mockResolvedValue({ status: 500, body: "", headers: {} });

    let scheduled = 0;
    (WebhookOutboxEvent.findByIdAndUpdate as any).mockImplementation(
      async (_id: unknown, update: { $set?: Row }) => {
        if (update?.$set?.nextAttemptAt) scheduled++;
        if (update?.$set) Object.assign(row, update.$set);
        return row;
      },
    );

    await runUntilTerminal(row, WEBHOOK_RETRY_POLICY.maxAttempts + 5);

    // One scheduled retry per failed attempt except the last, which dead-letters.
    expect(scheduled).toBe(WEBHOOK_RETRY_POLICY.maxAttempts - 1);
  });
});

describe("webhook retry policy — intermittently failing subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({ failureCount: 1 });
    activeSub();
  });

  it("eventually delivers once the subscriber recovers, and never dead-letters", async () => {
    const row = makeRow();
    persistTo(row);
    (postSignedWebhook as any)
      .mockResolvedValueOnce({ status: 500, body: "", headers: {} })
      .mockResolvedValueOnce({ status: 503, body: "", headers: {} })
      .mockResolvedValueOnce({ status: 200, body: "ok", headers: {} });

    await runUntilTerminal(row, WEBHOOK_RETRY_POLICY.maxAttempts + 5);

    expect(postSignedWebhook).toHaveBeenCalledTimes(3);
    expect(row.status).toBe("delivered");
    expect(row.attempts).toBe(3);
    expect(row.deadLetteredAt ?? null).toBeNull();
    expect(WebhookSubscription.findByIdAndUpdate).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ $set: expect.objectContaining({ failureCount: 0 }) }),
    );
  });

  it("retries transient 408 and 425 responses instead of dead-lettering them", async () => {
    for (const status of WEBHOOK_RETRY_POLICY.retryableClientStatuses) {
      vi.clearAllMocks();
      (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
      (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({ failureCount: 1 });
      activeSub();

      const row = makeRow();
      persistTo(row);
      (postSignedWebhook as any)
        .mockResolvedValueOnce({ status, body: "", headers: {} })
        .mockResolvedValueOnce({ status: 200, body: "ok", headers: {} });

      await runUntilTerminal(row, 5);

      expect(row.status, `status ${status}`).toBe("delivered");
      expect(postSignedWebhook, `status ${status}`).toHaveBeenCalledTimes(2);
    }
  });

  it("still dead-letters a permanent 4xx on the first response", async () => {
    const row = makeRow();
    persistTo(row);
    (postSignedWebhook as any).mockResolvedValue({ status: 404, body: "", headers: {} });

    await runUntilTerminal(row, 5);

    expect(postSignedWebhook).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("dead_letter");
    expect(row.lastError).toBe("Rejected with status 404.");
  });
});

describe("webhook retry policy — inactive subscriptions are bounded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({ failureCount: 1 });
  });

  it("defers without consuming the attempt budget, then dead-letters after the deferral cap", async () => {
    activeSub({ active: false });
    const row = makeRow();
    persistTo(row);

    await runUntilTerminal(row, WEBHOOK_RETRY_POLICY.maxInactiveDeferrals + 5);

    expect(postSignedWebhook).not.toHaveBeenCalled();
    expect(row.attempts).toBe(0);
    // The final check dead-letters instead of scheduling another deferral, so the
    // persisted counter stops one short of the cap.
    expect(row.inactiveDeferrals).toBe(WEBHOOK_RETRY_POLICY.maxInactiveDeferrals - 1);
    expect(row.status).toBe("dead_letter");
    expect(row.lastError).toMatch(/stayed inactive/);
  });

  it("remains pending (not dead-lettered) while the subscription is merely inactive for a short time", async () => {
    activeSub({ active: false });
    const row = makeRow();
    persistTo(row);

    await deliverRow(row as any);
    await deliverRow(row as any);

    expect(row.status).toBe("pending");
    expect(row.inactiveDeferrals).toBe(2);
    expect(row.lastError).toBe("Subscription is inactive.");
  });
});

describe("webhook retry policy — sequencing does not wedge on a dead letter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeSub();
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({ failureCount: 1 });
  });

  it("delivers sequence 2 when sequence 1 is already dead-lettered", async () => {
    // In-memory outbox: a terminal dead letter at sequence 1, a pending row at sequence 2.
    const store: Row[] = [
      makeRow({ _id: "row-1", sequence: 1, status: "dead_letter" }),
      makeRow({ _id: "row-2", sequence: 2, deliveryId: "delivery-2", eventId: "event-43", dedupeKey: "event-43" }),
    ];
    (WebhookOutboxEvent.findOne as any).mockImplementation(async (query: Record<string, any>) => {
      return (
        store.find((r) => {
          if (r.subscriptionId !== query.subscriptionId) return false;
          if (!(r.sequence < query.sequence.$lt)) return false;
          return typeof query.status === "string"
            ? r.status === query.status
            : r.status !== query.status.$ne;
        }) ?? null
      );
    });
    persistTo(store[1]);
    (postSignedWebhook as any).mockResolvedValue({ status: 200, body: "ok", headers: {} });

    await deliverRow(store[1] as any);

    expect(postSignedWebhook).toHaveBeenCalledTimes(1);
    expect(store[1].status).toBe("delivered");
  });

  it("holds sequence 2 while sequence 1 is still pending", async () => {
    const store: Row[] = [
      makeRow({ _id: "row-1", sequence: 1, status: "pending" }),
      makeRow({ _id: "row-2", sequence: 2, deliveryId: "delivery-2" }),
    ];
    (WebhookOutboxEvent.findOne as any).mockImplementation(async (query: Record<string, any>) => {
      return (
        store.find((r) => {
          if (r.subscriptionId !== query.subscriptionId) return false;
          if (!(r.sequence < query.sequence.$lt)) return false;
          return typeof query.status === "string"
            ? r.status === query.status
            : r.status !== query.status.$ne;
        }) ?? null
      );
    });
    persistTo(store[1]);

    await deliverRow(store[1] as any);

    expect(postSignedWebhook).not.toHaveBeenCalled();
    expect(store[1].lastError).toBe("Waiting for earlier subscription delivery sequence.");
  });
});

describe("webhook retry policy — backoff and Retry-After bounds", () => {
  it("uses equal jitter: the delay is at least half the exponential cap", () => {
    // random() = 0 gives the floor, cap/2; random() → 1 approaches the cap.
    expect(computeBackoffDelayMs(1, () => 0)).toBe(2_000);
    expect(computeBackoffDelayMs(1, () => 0.999)).toBeLessThan(4_000);
    expect(computeBackoffDelayMs(3, () => 0)).toBe(8_000);
  });

  it("never schedules below the floor, so retries cannot stack up immediately", () => {
    for (let attempt = 1; attempt <= WEBHOOK_RETRY_POLICY.maxAttempts; attempt++) {
      const floor = computeBackoffDelayMs(attempt, () => 0);
      expect(floor).toBeGreaterThan(0);
      expect(computeBackoffDelayMs(attempt, () => 0.5)).toBeGreaterThanOrEqual(floor);
    }
  });

  it("caps the exponential delay at maxBackoffMs", () => {
    expect(computeBackoffDelayMs(40, () => 0.999999)).toBeLessThanOrEqual(
      WEBHOOK_RETRY_POLICY.maxBackoffMs,
    );
    expect(computeBackoffDelayMs(40, () => 0)).toBe(WEBHOOK_RETRY_POLICY.maxBackoffMs / 2);
  });

  it("caps a hostile Retry-After so a subscriber cannot park a row for days", async () => {
    vi.clearAllMocks();
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({ failureCount: 1 });
    activeSub();
    const row = makeRow();
    persistTo(row);
    (postSignedWebhook as any).mockResolvedValue({
      status: 429,
      body: "",
      headers: { "retry-after": "999999999" },
    });

    const before = Date.now();
    await deliverRow(row as any);

    const delay = row.nextAttemptAt.getTime() - before;
    expect(delay).toBeLessThanOrEqual(WEBHOOK_RETRY_POLICY.maxBackoffMs + 100);
    expect(row.status).toBe("pending");
  });
});
