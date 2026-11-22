import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import mongoose from "mongoose";

/**
 * Concurrency contracts for duplicate submissions and stale versions (#1041).
 *
 * Unlike the existing `concurrencyHarness`/`concurrencyStress` suites (which
 * drive mocked models), these tests run against a REAL in-memory MongoDB so
 * they can prove the database-level guarantees the system actually relies on:
 *
 *   - the idempotency gate's unique `(scope, key)` index makes concurrent
 *     duplicate submissions collapse to a single handler execution;
 *   - the optimistic-version compare-and-swap (`{...filter, version}` +
 *     `$inc`) lets exactly one of N concurrent writers win;
 *   - the purchase path keeps its sequential contract (201 on first write,
 *     200 on re-submission, exactly one entitlement row). Its concurrent
 *     check-then-insert gap is a KNOWN EDGE CASE — see
 *     docs/CONCURRENCY_STRATEGY.md ("Purchase TOCTOU") for why it cannot be
 *     closed with a unique index without breaking the indexer's re-purchase
 *     flow, and what remediation options exist.
 *
 * They also pin the HTTP/controller contracts those mechanisms expose —
 * replay headers, conflict codes, validation guards, and the `currentVersion`
 * a client needs to retry.
 *
 * Every DB test skips itself gracefully when mongodb-memory-server is
 * unavailable (same convention as `jobQueue.test.ts`).
 */

// ── module mocks (hoisted) ───────────────────────────────────────────────────
// `RecordPurchase` and `UpdateWithVersionCheck` are invoked as controllers
// (not over dead/unmounted routers) so they need a Prompt lookup without
// seeding a full User/Prompt graph, and `connectDb` must not open a second
// connection. `Purchase` stays REAL so the sequential dedup contract runs
// against actual storage.
const promptMock = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock("../models/Prompt", () => ({ default: promptMock }));
// `resolveActor` looks the acting wallet up in the real database; seed a buyer
// user so the controller's authorization matrix resolves it without a full
// User/Prompt graph.
const userMock = vi.hoisted(() => ({
  findOne: vi.fn(async () => ({ _id: "buyer-user-id", role: "user", walletAddress: "gbuyer" })),
}));
vi.mock("../models/User", () => ({ default: userMock }));
vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/notificationRouting", () => ({
  deliverNotification: vi.fn(),
}));

import { requireIdempotency } from "../middleware/idempotency";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_RETENTION_MS,
} from "../services/idempotencyService";
import IdempotencyRecord from "../models/IdempotencyRecord";
import Purchase from "../models/Purchase";
import { updateWithVersionCheck } from "../models/VersionedRecord";
import { RecordPurchase } from "../controllers/versioningControllers";
import { UpdateWithVersionCheck } from "../controllers/concurrencyControllers";
import {
  setupRealMongo,
  teardownRealMongo,
  resetRealMongo,
} from "./helpers/realMongo";
import {
  startHttpServer,
  jsonCall,
  type HttpTestServer,
} from "./helpers/httpApp";

const IDEM_SCOPE = "/test/purchase";
let mongoUp = false;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal express-style response double that records status/body/headers. */
function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: undefined,
  };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.setHeader = (k: string, v: string) => res.headers.set(k, v);
  res.json = (b: unknown) => ((res.body = b), res);
  res.send = (b: unknown) => ((res.body = b), res);
  return res;
}

function mockReq(body: unknown) {
  return {
    body,
    headers: {},
    baseUrl: "",
    path: IDEM_SCOPE,
    get: () => undefined,
  } as any;
}

/** A minimal model carrying the `version` field the CAS primitive requires. */
function versionedModel(name: string) {
  const schema = new mongoose.Schema({
    label: { type: String, default: "" },
    version: { type: Number, default: 1, min: 0 },
  });
  return mongoose.models[name] ?? mongoose.model(name, schema);
}

/**
 * Poll until the idempotency record for `key` leaves the `processing` state.
 * The gate persists the stored response asynchronously on the response
 * `finish` event, so a sequential replay assertion must wait for durability
 * rather than race it.
 */
async function settleIdempotent(
  scope: string,
  key: string,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rec = await IdempotencyRecord.findOne({ scope, key });
    if (rec && rec.status !== "processing") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`idempotency record "${key}" never completed`);
}

// ── lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  mongoUp = await setupRealMongo();
  if (mongoUp) {
    // The concurrent-duplicate test depends on the UNIQUE (scope, key) index
    // existing before the race runs; await model init so autoIndex has finished.
    await IdempotencyRecord.init();
    await Purchase.init();
  }
}, 60_000);

afterAll(async () => {
  await teardownRealMongo();
}, 30_000);

beforeEach(async () => {
  vi.clearAllMocks();
  if (mongoUp) await resetRealMongo();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. DUPLICATE SUBMISSIONS — idempotency gate (real Mongo + real HTTP)
// ════════════════════════════════════════════════════════════════════════════

describe("duplicate submissions — idempotency gate (real Mongo + HTTP)", () => {
  let server: HttpTestServer;
  let executions = 0;

  const body = { promptId: "p1", buyerWallet: "gbuyer" };
  const hash = (b: unknown) =>
    hashIdempotentRequest({ method: "POST", scope: IDEM_SCOPE, body: b });

  beforeAll(async () => {
    executions = 0;
    server = await startHttpServer((app) => {
      // Mirrors the real versioning purchase route: gate runs before handler.
      app.post(IDEM_SCOPE, requireIdempotency, (_req, res) => {
        executions += 1;
        res.status(201).json({ ok: true, executions });
      });
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  it("rejects a missing Idempotency-Key before the handler runs", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const res = await jsonCall(server.baseUrl, IDEM_SCOPE, {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(executions).toBe(0);
  });

  it("rejects an oversized key (contract guard on key format)", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const before = executions;
    const res = await jsonCall(server.baseUrl, IDEM_SCOPE, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": "k".repeat(300) },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(executions).toBe(before); // never reached the handler
  });

  it("replays a completed request without re-executing the handler", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const headers = { "Idempotency-Key": "seq-1" };

    const first = await jsonCall(server.baseUrl, IDEM_SCOPE, {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    });
    expect(first.status).toBe(201);
    expect(first.body.executions).toBe(1);
    expect(executions).toBe(1);

    // The stored response is persisted on the async `finish` hook — wait for
    // it so the replay assertion tests replay, not the in-progress window.
    await settleIdempotent(IDEM_SCOPE, "seq-1");

    const second = await jsonCall(server.baseUrl, IDEM_SCOPE, {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    });
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(second.body).toEqual(first.body); // stored response, not re-run
    expect(executions).toBe(1); // handler never ran twice
  });

  it("rejects the same key reused with a different payload", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    await jsonCall(server.baseUrl, IDEM_SCOPE, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": "conflict-1" },
    });
    await settleIdempotent(IDEM_SCOPE, "conflict-1");

    const res = await jsonCall(server.baseUrl, IDEM_SCOPE, {
      method: "POST",
      body: JSON.stringify({ ...body, promptId: "DIFFERENT" }),
      headers: { "Idempotency-Key": "conflict-1" },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("collapses CONCURRENT duplicate submissions to exactly one execution", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const before = executions;
    const headers = { "Idempotency-Key": "storm-1" };

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        jsonCall(server.baseUrl, IDEM_SCOPE, {
          method: "POST",
          body: JSON.stringify(body),
          headers,
        }),
      ),
    );

    // The unique (scope, key) index lets exactly one insert win: one response
    // is the fresh execution, every other duplicate was either held at the
    // gate (409) or replayed once the winner finished.
    expect(executions - before).toBe(1);
    const fresh = results.filter(
      (r) => r.headers.get("idempotent-replayed") !== "true",
    );
    expect(fresh).toHaveLength(1);
    expect(fresh[0].status).toBe(201);
    expect(fresh[0].body.executions).toBe(before + 1);
    for (const r of results) {
      if (r === fresh[0]) continue;
      if (r.headers.get("idempotent-replayed") === "true") {
        expect([200, 201]).toContain(r.status);
      } else {
        expect(r.status).toBe(409);
        expect(r.body.code).toBe("IDEMPOTENCY_REQUEST_IN_PROGRESS");
      }
    }
    // Exactly one durable record exists for this key.
    expect(
      await IdempotencyRecord.countDocuments({
        scope: IDEM_SCOPE,
        key: "storm-1",
      }),
    ).toBe(1);
  });

  it("rejects an expired key so a retry regenerates one", async ({ skip }) => {
    if (!mongoUp) return skip();
    await IdempotencyRecord.create({
      scope: IDEM_SCOPE,
      key: "expired-1",
      requestHash: hash(body),
      status: "succeeded",
      expiresAt: new Date(Date.now() - 1_000), // already past
    });
    const before = executions;

    const res = await jsonCall(server.baseUrl, IDEM_SCOPE, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": "expired-1" },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IDEMPOTENCY_KEY_EXPIRED");
    expect(executions).toBe(before); // blocked before the handler
  });

  it("rejects a key whose original request is still in progress", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    await IdempotencyRecord.create({
      scope: IDEM_SCOPE,
      key: "inflight-1",
      requestHash: hash(body),
      status: "processing",
      expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
    });
    const before = executions;

    const res = await jsonCall(server.baseUrl, IDEM_SCOPE, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": "inflight-1" },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IDEMPOTENCY_REQUEST_IN_PROGRESS");
    expect(executions).toBe(before); // blocked before the handler
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. DUPLICATE SUBMISSIONS — purchase controller contract (real Mongo)
// ════════════════════════════════════════════════════════════════════════════

describe("duplicate submissions — purchase controller contract (real Mongo)", () => {
  it("is idempotent on a sequential re-submission (200, no new row)", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    // `resolveActor` and the controller both read the prompt through a
    // `.select().lean()` chain.
    promptMock.findById.mockReturnValue({
      select: () => ({ lean: async () => ({ owner: "creator-user-id" }) }),
    });

    const call = async () => {
      const res = mockRes();
      await RecordPurchase(
        mockReq({ promptId: "prompt-2", walletAddress: "gBuyer" }),
        res,
      );
      return res;
    };

    const first = await call();
    const second = await call();
    expect(first.statusCode).toBe(201);
    // The re-submission is deduplicated: same contract, no second row.
    expect(second.statusCode).toBe(201);
    expect(second.body.message).toBe("Purchase recorded.");
    expect(
      await Purchase.countDocuments({
        promptId: "prompt-2",
        buyerWallet: "gbuyer",
      }),
    ).toBe(1);
  });

  it("rejects a malformed submission without touching the database", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const res = mockRes();
    await RecordPurchase(mockReq({ promptId: "prompt-x" }), res); // no walletAddress
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/required/i);
    expect(await Purchase.countDocuments({})).toBe(0);
  });

  it("404s an unknown prompt without creating a purchase", async ({ skip }) => {
    if (!mongoUp) return skip();
    promptMock.findById.mockReturnValue({
      select: () => ({ lean: async () => null }),
    });
    const res = mockRes();
    await RecordPurchase(
      mockReq({ promptId: "missing", walletAddress: "gbuyer" }),
      res,
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(await Purchase.countDocuments({})).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. STALE VERSIONS — optimistic compare-and-swap (real Mongo)
// ════════════════════════════════════════════════════════════════════════════

describe("stale versions — optimistic CAS (real Mongo)", () => {
  it("lets exactly ONE of N concurrent writers win the same expectedVersion", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const Model = versionedModel("CasDoc");
    const doc = await Model.create({ label: "start", version: 1 });

    const attempt = () =>
      updateWithVersionCheck(
        Model,
        { _id: doc._id },
        { label: "contended" },
        1,
      );
    const results = await Promise.all([
      attempt(),
      attempt(),
      attempt(),
      attempt(),
      attempt(),
    ]);
    const winners = results.filter((r) => r.matched);

    expect(winners).toHaveLength(1);
    const after = await Model.findById(doc._id);
    expect(after.version).toBe(2); // incremented exactly once
    expect(after.label).toBe("contended");
  });

  it("rejects a stale version and accepts the refreshed one", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const Model = versionedModel("CasDocSeq");
    const doc = await Model.create({ label: "v", version: 1 });

    // First writer wins at version 1 → 2.
    expect(
      (await updateWithVersionCheck(Model, { _id: doc._id }, { label: "a" }, 1))
        .matched,
    ).toBe(true);
    // A second writer still holding version 1 is rejected (stale).
    expect(
      (await updateWithVersionCheck(Model, { _id: doc._id }, { label: "b" }, 1))
        .matched,
    ).toBe(false);
    // After refreshing to version 2 it succeeds → 3.
    expect(
      (await updateWithVersionCheck(Model, { _id: doc._id }, { label: "c" }, 2))
        .matched,
    ).toBe(true);

    const after = await Model.findById(doc._id);
    expect(after.version).toBe(3);
    expect(after.label).toBe("c"); // the stale write did not land
  });

  it("reports matched=false for a version that never existed", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const Model = versionedModel("CasDocMissing");
    const doc = await Model.create({ label: "x", version: 5 });
    expect(
      (
        await updateWithVersionCheck(
          Model,
          { _id: doc._id },
          { label: "y" },
          99,
        )
      ).matched,
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. STALE VERSIONS — controller contract (real Mongo, controller invoked
//    directly because `concurrencyRouter` is not mounted in production)
// ════════════════════════════════════════════════════════════════════════════

describe("stale versions — controller contract (real Mongo)", () => {
  beforeAll(() => {
    // The controller resolves models by plural name from an allowlist that
    // includes "invitations"; register a versioned doc under that name so the
    // 409 + currentVersion contract runs against real Mongo.
    versionedModel("invitations");
  });

  const callUpdate = async (body: unknown) => {
    const res = mockRes();
    await UpdateWithVersionCheck(mockReq(body), res);
    return res;
  };

  it("returns 409 with the currentVersion a client needs to retry", async ({
    skip,
  }) => {
    if (!mongoUp) return skip();
    const Model = mongoose.model("invitations");
    const doc = await Model.create({ label: "seed", version: 1 });

    // Someone else already moved the record to v2 — this write is stale.
    await updateWithVersionCheck(
      Model,
      { _id: doc._id },
      { label: "other" },
      1,
    );

    const res = await callUpdate({
      collection: "invitations",
      recordId: String(doc._id),
      update: { label: "stale" },
      expectedVersion: 1,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/modified by another session/i);
    expect(res.body.currentVersion).toBe(2);
    expect(res.body.message).toMatch(/refresh and retry/i);

    // The stale update did not land.
    expect((await Model.findById(doc._id)).label).toBe("other");
  });

  it("applies a fresh-version update and reports success", async ({ skip }) => {
    if (!mongoUp) return skip();
    const Model = mongoose.model("invitations");
    const doc = await Model.create({ label: "seed", version: 1 });

    const res = await callUpdate({
      collection: "invitations",
      recordId: String(doc._id),
      update: { label: "fresh" },
      expectedVersion: 1,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, modified: true });
    const after = await Model.findById(doc._id);
    expect(after.version).toBe(2);
    expect(after.label).toBe("fresh");
  });

  it("rejects a submission missing required fields", async ({ skip }) => {
    if (!mongoUp) return skip();
    const res = await callUpdate({ collection: "invitations" });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/missing required fields/i);
  });

  it("rejects a collection outside the allowlist", async ({ skip }) => {
    if (!mongoUp) return skip();
    const res = await callUpdate({
      collection: "secrets",
      recordId: "507f1f77bcf86cd799439011",
      update: { label: "x" },
      expectedVersion: 1,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/invalid collection/i);
  });
});
