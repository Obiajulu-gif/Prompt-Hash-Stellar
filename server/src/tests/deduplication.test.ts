import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Notification from "../models/Notification";
import ProcessedWebhookEvent from "../models/ProcessedWebhookEvent";
import {
  buildWebhookDedupeKey,
  completeWebhookDelivery,
  deliverNotificationOnce,
  failWebhookDelivery,
  listWebhookDedupeRecords,
  releaseWebhookDelivery,
  reserveWebhookDelivery,
} from "../services/deduplication";

vi.mock("../services/auditTrail", () => ({ recordAuditEvent: vi.fn() }));

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Notification.init(), ProcessedWebhookEvent.init()]);
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    Notification.deleteMany({}),
    ProcessedWebhookEvent.deleteMany({}),
  ]);
});

describe("notification deduplication", () => {
  const base = {
    recipientWallet: " Alice ",
    type: "purchase_receipt" as const,
    message: "Purchased",
    dedupeKey: "event-1",
  };

  it("collapses concurrent deliveries to one row and returns it", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => deliverNotificationOnce(base)),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.notificationId)).size).toBe(1);
    expect(await Notification.countDocuments()).toBe(1);
  });

  it("scopes keys by recipient and type", async () => {
    await deliverNotificationOnce(base);
    await deliverNotificationOnce({ ...base, recipientWallet: "bob" });
    await deliverNotificationOnce({ ...base, type: "security_alert" });
    expect(await Notification.countDocuments()).toBe(3);
  });

  it("rethrows storage errors instead of dropping the notification", async () => {
    vi.spyOn(Notification, "create").mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    await expect(deliverNotificationOnce(base)).rejects.toThrow("DB unavailable");
    expect(await Notification.countDocuments()).toBe(0);
    const retried = await deliverNotificationOnce(base);
    expect(retried.created).toBe(true);
  });

  it("rejects missing recipient or dedupe key before writing", async () => {
    await expect(
      deliverNotificationOnce({ ...base, recipientWallet: " " }),
    ).rejects.toThrow("recipient wallet");
    await expect(
      deliverNotificationOnce({ ...base, dedupeKey: " " }),
    ).rejects.toThrow("dedupeKey");
    expect(await Notification.countDocuments()).toBe(0);
  });
});

describe("webhook deduplication", () => {
  const input = { source: "GitHub", eventId: "evt-1", eventType: "push" };

  it("builds a normalized, source-scoped key", () => {
    expect(buildWebhookDedupeKey(input)).toBe("webhook:github:evt-1");
    expect(() => buildWebhookDedupeKey({ ...input, eventId: " " })).toThrow(
      "non-empty event id",
    );
  });

  it("acquires, completes, then reports duplicates", async () => {
    const first = await reserveWebhookDelivery(input);
    expect(first.state).toBe("acquired");
    expect(first.recordId).toBeTruthy();
    await expect(completeWebhookDelivery(first.recordId!)).resolves.toBe(true);
    const second = await reserveWebhookDelivery(input);
    expect(second.state).toBe("duplicate");
    await expect(completeWebhookDelivery(first.recordId!)).resolves.toBe(false);
    expect(await ProcessedWebhookEvent.countDocuments()).toBe(1);
  });

  it("allows exactly one of many concurrent reservations", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => reserveWebhookDelivery(input)),
    );
    expect(results.filter((r) => r.state === "acquired")).toHaveLength(1);
    expect(results.filter((r) => r.state === "in_flight")).toHaveLength(11);
    expect(await ProcessedWebhookEvent.countDocuments()).toBe(1);
  });

  it("makes a failed delivery immediately retryable", async () => {
    const first = await reserveWebhookDelivery(input);
    await failWebhookDelivery(first.recordId!, new Error("receiver down"));
    const retry = await reserveWebhookDelivery(input);
    expect(retry.state).toBe("acquired");
    expect(retry.attempts).toBe(2);
    const stored = await ProcessedWebhookEvent.findById(retry.recordId).lean();
    expect(stored?.lastError).toBeNull();
  });

  it("fences a stale worker from a re-acquired reservation", async () => {
    const first = await reserveWebhookDelivery(input);
    await failWebhookDelivery(first.recordId!, new Error("crash"), {
      expectedAttempts: 1,
    });
    const retry = await reserveWebhookDelivery(input);
    expect(retry.attempts).toBe(2);
    await expect(
      completeWebhookDelivery(retry.recordId!, { expectedAttempts: 1 }),
    ).resolves.toBe(false);
    await expect(
      completeWebhookDelivery(retry.recordId!, { expectedAttempts: 2 }),
    ).resolves.toBe(true);
  });

  it("recovers a crashed processor's expired lease", async () => {
    const first = await reserveWebhookDelivery({ ...input, leaseMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const retry = await reserveWebhookDelivery(input);
    expect(retry.state).toBe("acquired");
    expect(retry.attempts).toBe(2);
    expect(retry.recordId).toBe(first.recordId);
  });

  it("releases only unprocessed reservations", async () => {
    const first = await reserveWebhookDelivery(input);
    await expect(releaseWebhookDelivery(first.recordId!)).resolves.toBe(true);
    const again = await reserveWebhookDelivery(input);
    expect(again.state).toBe("acquired");
    await completeWebhookDelivery(again.recordId!);
    await expect(releaseWebhookDelivery(again.recordId!)).resolves.toBe(false);
  });

  it("keeps event ids independent across sources", async () => {
    const a = await reserveWebhookDelivery(input);
    const b = await reserveWebhookDelivery({ ...input, source: "stripe" });
    expect(a.state).toBe("acquired");
    expect(b.state).toBe("acquired");
    expect(await ProcessedWebhookEvent.countDocuments()).toBe(2);
  });

  it("lists records by status and source for operators", async () => {
    const row = await reserveWebhookDelivery(input);
    await failWebhookDelivery(row.recordId!, new Error("x".repeat(900)));
    const failed = await listWebhookDedupeRecords({ status: "failed" });
    expect(failed).toHaveLength(1);
    expect(failed[0].externalEventId).toBe("evt-1");
    expect((failed[0].lastError ?? "").length).toBeLessThanOrEqual(500);
    const other = await listWebhookDedupeRecords({ source: "stripe" });
    expect(other).toHaveLength(0);
  });
});

import { webhookRouter } from "../routes/webhookRoutes";
import { createAdminToken } from "../services/adminToken";
import { startHttpServer, jsonCall } from "./helpers/httpApp";

describe("webhook dedupe authorization", () => {
  const originalSecret = process.env.ADMIN_TOKEN_SECRET;
  const originalAudience = process.env.ADMIN_TOKEN_AUDIENCE;
  let server: Awaited<ReturnType<typeof startHttpServer>>;

  beforeAll(async () => {
    process.env.ADMIN_TOKEN_SECRET = "a-sufficiently-long-admin-secret";
    process.env.ADMIN_TOKEN_AUDIENCE = "dedupe-admin-test";
    server = await startHttpServer((app) =>
      app.use("/api/webhooks", webhookRouter),
    );
  });

  afterAll(async () => {
    await server.close();
    process.env.ADMIN_TOKEN_SECRET = originalSecret;
    process.env.ADMIN_TOKEN_AUDIENCE = originalAudience;
  });

  it("rejects an unauthenticated ledger read with 401", async () => {
    const res = await jsonCall(server.baseUrl, "/api/webhooks/dedupe");
    expect(res.status).toBe(401);
  });

  it("rejects a read-scoped token on the release route", async () => {
    const { token } = createAdminToken(process.env.ADMIN_TOKEN_SECRET!, {
      sub: "ops-reader",
      scope: ["webhook:read"],
      iss: "ops-cli",
      aud: "dedupe-admin-test",
    });
    const res = await jsonCall(
      server.baseUrl,
      "/api/webhooks/dedupe/abc/release",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "idempotency-key": "k1" },
      },
    );
    expect(res.status).toBe(401);
  });

  it("fails closed when admin auth is unconfigured", async () => {
    delete process.env.ADMIN_TOKEN_SECRET;
    const res = await jsonCall(server.baseUrl, "/api/webhooks/dedupe");
    expect(res.status).toBe(503);
    process.env.ADMIN_TOKEN_SECRET = "a-sufficiently-long-admin-secret";
  });

  it("mounts the admin guard on both dedupe routes", () => {
    for (const [method, path] of [
      ["get", "/dedupe"],
      ["post", "/dedupe/:id/release"],
    ] as const) {
      const layer = (webhookRouter as any).stack.find(
        (entry: any) =>
          entry.route?.path === path && entry.route.methods[method],
      );
      expect(layer, `${method} ${path}`).toBeTruthy();
      expect(layer.route.stack.map((s: any) => s.name)).toContain(
        "adminAuthMiddleware",
      );
    }
  });
});
