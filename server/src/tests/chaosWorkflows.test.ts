/**
 * Deterministic chaos suite for interrupted user and background workflows — Issue #964.
 *
 * Each scenario injects network drops, lost responses, process restarts and
 * transient storage failures on a fixed schedule (see helpers/faultInjector.ts),
 * then asserts the business invariant that must survive: exactly-once effects,
 * an intact audit chain, and convergence after restart. No timers, no real
 * network, and no reliance on Math.random, so a result never depends on load.
 *
 * Failure modes and recovery steps are documented in
 * docs/operations/stellar-wave-integrity-hardening.md.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { AuditLog } from "../models/AuditLog";
import { recordAuditEvent, verifyAuditTrail } from "../services/auditTrail";
import { hashIdempotentRequest } from "../services/idempotencyService";
import { signWebhookPayload, verifyWebhookSignature } from "../services/webhookOutboxWorker";
import {
  BackfillJob,
  BackfillPlan,
  CheckpointStore,
  memoryCheckpointStore,
  runBackfill,
} from "../services/backfillEngine";
import {
  InjectedFault,
  failBefore,
  loseResponseAfter,
  scriptedFaults,
  seededFaults,
} from "./helpers/faultInjector";

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

// ─── 1. Webhook delivery: network drops, lost acks, replay window ────────────

const WEBHOOK_SECRET = "chaos-webhook-secret";

interface Delivery {
  eventId: string;
  deliveryId: string;
  body: string;
}

interface SignedRequest extends Delivery {
  timestamp: string;
  signature: string;
}

/** Receiver that verifies the signature and dedupes by deliveryId, as a real subscriber should. */
function makeReceiver(clock: { now: number }) {
  const seen = new Set<string>();
  const processed: string[] = [];
  const accepted: SignedRequest[] = [];

  async function handle(request: SignedRequest): Promise<void> {
    const valid = verifyWebhookSignature(WEBHOOK_SECRET, request.signature, {
      body: request.body,
      timestamp: request.timestamp,
      eventId: request.eventId,
      deliveryId: request.deliveryId,
      now: clock.now,
    });
    if (!valid) throw new Error("rejected: bad signature or outside replay window");
    accepted.push(request);
    if (!seen.has(request.deliveryId)) {
      seen.add(request.deliveryId);
      processed.push(request.deliveryId);
    }
  }

  return { handle, processed, accepted };
}

/** Sender retry loop: every attempt is re-signed with the current clock. */
async function sendWithRetries(
  send: (request: SignedRequest) => Promise<void>,
  delivery: Delivery,
  clock: { now: number },
  maxAttempts: number,
): Promise<number> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timestamp = new Date(clock.now).toISOString();
    const signature = signWebhookPayload(WEBHOOK_SECRET, {
      body: delivery.body,
      timestamp,
      eventId: delivery.eventId,
      deliveryId: delivery.deliveryId,
    });
    try {
      await send({ ...delivery, timestamp, signature });
      return attempt;
    } catch (err) {
      if (!(err instanceof InjectedFault)) throw err;
      clock.now += 2_000;
    }
  }
  throw new Error(`delivery ${delivery.deliveryId} exhausted ${maxAttempts} attempts`);
}

describe("chaos: webhook delivery (#964)", () => {
  it("converges through dropped requests, re-signing each retry", async () => {
    const clock = { now: T0 };
    const receiver = makeReceiver(clock);
    const send = failBefore(receiver.handle, scriptedFaults(["network", "network", "ok"]));

    const attempts = await sendWithRetries(
      send,
      { eventId: "evt-1", deliveryId: "dlv-1", body: '{"type":"purchase"}' },
      clock,
      5,
    );

    expect(attempts).toBe(3);
    expect(receiver.processed).toEqual(["dlv-1"]);
    const timestamps = new Set(receiver.accepted.map((request) => request.timestamp));
    expect(timestamps.size).toBe(1); // only the successful attempt reached the receiver
  });

  it("absorbs a lost acknowledgement without a duplicate effect", async () => {
    const clock = { now: T0 };
    const receiver = makeReceiver(clock);
    // The receiver processes the first attempt, then the response is lost.
    const send = loseResponseAfter(receiver.handle, scriptedFaults(["network", "ok"]));

    const attempts = await sendWithRetries(
      send,
      { eventId: "evt-2", deliveryId: "dlv-2", body: '{"type":"refund"}' },
      clock,
      5,
    );

    expect(attempts).toBe(2);
    expect(receiver.accepted).toHaveLength(2); // both attempts reached the receiver
    expect(receiver.processed).toEqual(["dlv-2"]); // but the effect happened once
  });

  it("rejects a stale signature once it falls outside the replay window", () => {
    const body = '{"type":"listing"}';
    const timestamp = new Date(T0).toISOString();
    const signature = signWebhookPayload(WEBHOOK_SECRET, {
      body,
      timestamp,
      eventId: "evt-3",
      deliveryId: "dlv-3",
    });
    const check = (now: number) =>
      verifyWebhookSignature(WEBHOOK_SECRET, signature, {
        body,
        timestamp,
        eventId: "evt-3",
        deliveryId: "dlv-3",
        now,
      });

    expect(check(T0 + 4 * 60_000)).toBe(true);
    expect(check(T0 + 6 * 60_000)).toBe(false);
  });

  it("converges for 20 deliveries under a seeded failure rate, each applied once", async () => {
    const clock = { now: T0 };
    const receiver = makeReceiver(clock);
    const next = seededFaults(964, 0.6);
    const send = failBefore(receiver.handle, next);

    let totalAttempts = 0;
    for (let i = 0; i < 20; i += 1) {
      totalAttempts += await sendWithRetries(
        send,
        { eventId: `evt-s${i}`, deliveryId: `dlv-s${i}`, body: `{"n":${i}}` },
        clock,
        50,
      );
    }

    expect(receiver.processed).toHaveLength(20);
    expect(new Set(receiver.processed).size).toBe(20);
    expect(totalAttempts).toBeGreaterThan(20); // faults really were injected
  });
});

// ─── 2. Idempotent request replayed after a restart ───────────────────────────

interface StoredResponse {
  status: number;
  body: Record<string, unknown>;
}

interface IdempotencyRecord {
  hash: string;
  response: StoredResponse;
}

/**
 * Models the contract of the idempotency gate: the first request under a key
 * runs and its response is stored with the request digest. Later requests
 * under that key replay the stored response, or are rejected if the digest
 * differs. The durable record is what survives a restart.
 */
class PaymentServer {
  charges = 0;

  constructor(private readonly records: Record<string, IdempotencyRecord> = {}) {}

  snapshot(): Record<string, IdempotencyRecord> {
    return JSON.parse(JSON.stringify(this.records));
  }

  async handle(
    key: string,
    request: { method: string; scope: string; body: { amount: number; currency: string } },
  ): Promise<StoredResponse & { replayed: boolean }> {
    const hash = hashIdempotentRequest(request);
    const existing = this.records[key];
    if (existing) {
      if (existing.hash !== hash) {
        return { status: 422, body: { error: "key reused with a different payload" }, replayed: false };
      }
      return { ...existing.response, replayed: true };
    }
    this.charges += 1;
    const response: StoredResponse = {
      status: 201,
      body: { charged: request.body.amount, currency: request.body.currency },
    };
    this.records[key] = { hash, response };
    return { ...response, replayed: false };
  }
}

describe("chaos: idempotent payment across restart (#964)", () => {
  const request = { method: "POST", scope: "/purchases", body: { amount: 5, currency: "XLM" } };

  it("replays the stored response after a lost reply and a restart, with no second charge", async () => {
    const first = new PaymentServer();
    const sendFirst = loseResponseAfter(
      (key: string) => first.handle(key, request),
      scriptedFaults(["network"]),
    );
    await expect(sendFirst("key-pay-1")).rejects.toBeInstanceOf(InjectedFault);
    expect(first.charges).toBe(1);

    // Restart: the new process only has what was durably stored.
    const restarted = new PaymentServer(first.snapshot());
    const retry = await restarted.handle("key-pay-1", request);

    expect(retry).toEqual({ status: 201, body: { charged: 5, currency: "XLM" }, replayed: true });
    expect(first.charges + restarted.charges).toBe(1);
  });

  it("rejects a reused key carrying a different payload, without charging", async () => {
    const server = new PaymentServer();
    await server.handle("key-pay-2", request);

    const tampered = await server.handle("key-pay-2", {
      ...request,
      body: { amount: 500, currency: "XLM" },
    });

    expect(tampered.status).toBe(422);
    expect(server.charges).toBe(1);
  });

  it("treats method casing as the same request", async () => {
    const server = new PaymentServer();
    await server.handle("key-pay-3", request);
    const again = await server.handle("key-pay-3", { ...request, method: "post" });
    expect(again.replayed).toBe(true);
    expect(server.charges).toBe(1);
  });
});

// ─── 3. Audit chain across a transient storage failure ────────────────────────

describe("chaos: audit chain under transient storage failure (#964)", () => {
  let rows: any[] = [];

  beforeEach(() => {
    rows = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops only the failed event and keeps every stored record chained", async () => {
    vi.spyOn(AuditLog, "findOne").mockImplementation((() => ({
      sort: () => ({
        lean: async () => rows[rows.length - 1] ?? null,
      }),
    })) as any);

    vi.spyOn(AuditLog, "create").mockImplementation(
      failBefore(async (doc: any) => {
        const stored = { ...doc, _id: `row-${rows.length + 1}` };
        rows.push(stored);
        return stored;
      }, scriptedFaults(["ok", "network", "ok"])) as any,
    );

    vi.spyOn(AuditLog, "find").mockImplementation((() => ({
      sort: () => ({
        lean: () => ({
          cursor: () =>
            (async function* () {
              for (const row of rows) yield row;
            })(),
        }),
      }),
    })) as any);

    for (const actor of ["ops-a", "ops-b", "ops-c"]) {
      // Non-throwing mode: a storage failure is logged, not surfaced to the caller.
      await recordAuditEvent({ action: "admin_auth_success", result: "success", actor });
    }

    expect(rows.map((row) => row.actor)).toEqual(["ops-a", "ops-c"]);
    expect(rows[1].previousHash).toBe(rows[0].recordHash);
    expect((await verifyAuditTrail()).valid).toBe(true);
  });
});

// ─── 4. Backfill crashing at seeded points, restarted until complete ─────────

type Row = { id: string; data: { v: number } };

function versionedJob(rows: Row[], appliedLog: string[]): BackfillJob {
  return {
    name: "chaos-set-v1",
    async fetchPage(after, limit) {
      const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
      const start = after === null ? 0 : sorted.findIndex((row) => row.id > after);
      if (start === -1) return [];
      return sorted
        .slice(start, start + limit)
        .map((row) => ({ id: row.id, data: { ...row.data } }));
    },
    plan(record): BackfillPlan {
      return record.data.v === 1
        ? { kind: "skip", reason: "already applied" }
        : { kind: "update", changes: { v: 1 } };
    },
    async apply(record) {
      const row = rows.find((candidate) => candidate.id === record.id)!;
      row.data.v = 1;
      appliedLog.push(record.id);
    },
  };
}

/** Checkpoint store whose writes can crash according to a seeded schedule. */
function crashingStore(inner: CheckpointStore, next: () => string): CheckpointStore & { crashes: number } {
  const store = {
    crashes: 0,
    load: () => inner.load(),
    async save(checkpoint: Parameters<CheckpointStore["save"]>[0]) {
      if (next() !== "ok") {
        store.crashes += 1;
        throw new InjectedFault("crash");
      }
      await inner.save(checkpoint);
    },
  };
  return store;
}

describe("chaos: backfill restarted after crashes (#964)", () => {
  it("reaches the target state with every record applied exactly once", async () => {
    const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({
      id: `r${String(i + 1).padStart(3, "0")}`,
      data: { v: 0 },
    }));
    const appliedLog: string[] = [];
    const inner = memoryCheckpointStore();
    const store = crashingStore(inner, seededFaults(964, 0.4, "crash"));

    let runs = 0;
    let report: Awaited<ReturnType<typeof runBackfill>> | null = null;
    while (!report?.complete) {
      runs += 1;
      if (runs > 200) throw new Error("backfill did not converge");
      try {
        report = await runBackfill(versionedJob(rows, appliedLog), store, {
          dryRun: false,
          batchSize: 4,
        });
      } catch (err) {
        if (!(err instanceof InjectedFault)) throw err;
        // The process "restarts": the next iteration resumes from the checkpoint.
      }
    }

    expect(store.crashes).toBeGreaterThan(0);
    expect(runs).toBeGreaterThan(1);
    expect(rows.every((row) => row.data.v === 1)).toBe(true);
    expect(new Set(appliedLog).size).toBe(rows.length);
    expect(appliedLog.length).toBe(rows.length);
    expect((await inner.load())?.complete).toBe(true);
  });
});
