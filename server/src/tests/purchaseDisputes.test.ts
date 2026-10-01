import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * In-memory stand-in for the FulfillmentRecord collection that honours the
 * conditional-update semantics the dispute service relies on: `$in`/`$ne`
 * filters, `$push` with `$each`/`$slice`, `$inc`, upserts, and the unique
 * (promptId, buyerWallet) index.
 */
const fake = vi.hoisted(() => {
  const docs: any[] = [];
  const clone = (value: any) => (value === undefined ? value : structuredClone(value));
  const sameTime = (a: any, b: any) =>
    (a == null && b == null) ||
    (a != null && b != null && new Date(a).getTime() === new Date(b).getTime());

  function matchValue(value: any, cond: any): boolean {
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("$in" in cond) return cond.$in.includes(value);
      if ("$ne" in cond) return !(value ?? []).includes(cond.$ne);
      if ("$lte" in cond) {
        return value != null && new Date(value).getTime() <= new Date(cond.$lte).getTime();
      }
    }
    if (cond === null || cond instanceof Date) return sameTime(value, cond);
    return value === cond;
  }

  function matches(doc: any, filter: any): boolean {
    return Object.entries(filter).every(([key, cond]: [string, any]) =>
      key === "$or" ? cond.some((sub: any) => matches(doc, sub)) : matchValue(doc[key], cond),
    );
  }

  function applyUpdate(doc: any, update: any, inserting: boolean) {
    Object.assign(doc, clone(update.$set ?? {}));
    if (inserting) Object.assign(doc, clone(update.$setOnInsert ?? {}));
    for (const [key, amount] of Object.entries(update.$inc ?? {})) {
      doc[key] = (doc[key] ?? 0) + (amount as number);
    }
    for (const [key, value] of Object.entries(update.$push ?? {}) as [string, any][]) {
      const list = [...(doc[key] ?? [])];
      if (value && typeof value === "object" && "$each" in value) {
        list.push(...clone(value.$each));
        doc[key] = value.$slice !== undefined ? list.slice(value.$slice) : list;
      } else {
        list.push(clone(value));
        doc[key] = list;
      }
    }
  }

  const keyOf = (value: any) => `${value.promptId}|${value.buyerWallet}`;

  const model = {
    findOneAndUpdate(filter: any, update: any, options: any) {
      return {
        lean: async () => {
          const doc = docs.find((d) => matches(d, filter));
          if (doc) {
            const before = clone(doc);
            applyUpdate(doc, update, false);
            return { value: before, lastErrorObject: { updatedExisting: true } };
          }
          if (!options?.upsert) return { value: null, lastErrorObject: { updatedExisting: false } };
          if (docs.some((d) => keyOf(d) === keyOf(filter))) {
            throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
          }
          const created: any = {
            _id: `record-${docs.length + 1}`,
            promptId: filter.promptId,
            buyerWallet: filter.buyerWallet,
            status: "pending",
            unlockAttempts: 0,
            retryCount: 0,
            processedEventKeys: [],
            auditLog: [],
            deliveryAttemptedAt: null,
            lastTransitionAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          applyUpdate(created, update, true);
          docs.push(created);
          return { value: null, lastErrorObject: { updatedExisting: false, upserted: created._id } };
        },
      };
    },
    findOne(filter: any) {
      return { lean: async () => clone(docs.find((d) => matches(d, filter)) ?? null) };
    },
    async updateOne(filter: any, update: any) {
      const doc = docs.find((d) => matches(d, filter));
      if (doc) applyUpdate(doc, update, false);
      return { modifiedCount: doc ? 1 : 0 };
    },
    find(filter: any) {
      const chain: any = {
        select: () => chain,
        sort: () => chain,
        limit: () => chain,
        lean: async () => clone(docs.filter((d) => matches(d, filter))),
      };
      return chain;
    },
  };

  return { docs, model };
});

vi.mock("../models/FulfillmentRecord", () => ({ default: fake.model }));
vi.mock("../services/auditTrail", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("../db/connectDb", () => ({ default: vi.fn() }));

import { recordAuditEvent } from "../services/auditTrail";
import {
  applyDisputeTransition,
  recordUnlockFailure,
  recordUnlockSuccess,
  sweepStaleDisputes,
  toBuyerDisputeView,
  toMaintainerDisputeView,
} from "../services/purchaseDisputes";

const PROMPT = "42";
const BUYER = "GBUYERWALLET";
const buyer = BUYER.toLowerCase();

function stored() {
  return fake.docs.find((doc) => doc.promptId === PROMPT && doc.buyerWallet === buyer);
}

describe("disputed purchase resolution (#755)", () => {
  beforeEach(() => {
    fake.docs.length = 0;
    vi.clearAllMocks();
    process.env.FULFILLMENT_TIMEOUT_MS = "600000";
  });

  afterEach(() => {
    delete process.env.FULFILLMENT_TIMEOUT_MS;
  });

  it("opens a recoverable dispute when a paid unlock fails (partial failure)", async () => {
    await recordUnlockFailure({
      promptId: PROMPT,
      buyerWallet: BUYER,
      reason: "integrity_failure",
      requestId: "req-1",
    });

    const record = stored();
    expect(record.status).toBe("failed");
    expect(record.unlockAttempts).toBe(1);
    expect(record.failureReason).toBe("integrity_failure");
    expect(record.deliveryAttemptedAt).toBeInstanceOf(Date);
    expect(record.auditLog).toEqual([
      expect.objectContaining({ status: "failed", event: "unlock_failed", actor: "system" }),
    ]);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dispute_unlock_failed",
        promptId: PROMPT,
        walletAddress: buyer,
        reason: "none->failed",
      }),
    );
  });

  it("applies a redelivered event only once (duplicate webhook)", async () => {
    const report = () =>
      applyDisputeTransition({
        promptId: PROMPT,
        buyerWallet: BUYER,
        event: "unlock_failed",
        eventKey: "unlock:req-1",
      });

    expect((await report()).outcome).toBe("applied");
    expect((await report()).outcome).toBe("duplicate");
    expect(stored().unlockAttempts).toBe(1);
    expect(stored().auditLog).toHaveLength(1);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);

    const settle = () =>
      applyDisputeTransition({
        promptId: PROMPT,
        buyerWallet: BUYER,
        event: "refund_settled",
        actor: "indexer",
        eventKey: "chain:evt-9",
      });
    expect((await settle()).outcome).toBe("applied");
    expect((await settle()).outcome).toBe("duplicate");
    expect(stored().status).toBe("refunded");
  });

  it("acknowledges a repeated maintainer action without applying it twice", async () => {
    await recordUnlockFailure({ promptId: PROMPT, buyerWallet: BUYER, reason: "unlock_error" });

    const approve = () =>
      applyDisputeTransition({
        promptId: PROMPT,
        buyerWallet: BUYER,
        event: "refund_approved",
        actor: "ops-jane",
        set: { resolvedBy: "ops-jane" },
      });

    const first = await approve();
    expect(first.outcome).toBe("applied");
    expect(first.previousStatus).toBe("failed");
    expect((await approve()).outcome).toBe("already_applied");
    expect(stored().auditLog.filter((entry: any) => entry.event === "refund_approved")).toHaveLength(1);
  });

  it("rejects actions that are not allowed from the current state", async () => {
    await recordUnlockFailure({ promptId: PROMPT, buyerWallet: BUYER, reason: "unlock_error" });

    const result = await applyDisputeTransition({
      promptId: PROMPT,
      buyerWallet: BUYER,
      event: "refund_rejected",
    });

    expect(result.outcome).toBe("invalid_transition");
    expect(stored().status).toBe("failed");
  });

  it("reports not_found for a purchase with no delivery record", async () => {
    const result = await applyDisputeTransition({
      promptId: "999",
      buyerWallet: BUYER,
      event: "retry_scheduled",
    });
    expect(result).toEqual({ outcome: "not_found", record: null });
  });

  it("closes the dispute when a maintainer-scheduled retry succeeds", async () => {
    await recordUnlockFailure({ promptId: PROMPT, buyerWallet: BUYER, reason: "unlock_error" });
    await applyDisputeTransition({
      promptId: PROMPT,
      buyerWallet: BUYER,
      event: "retry_scheduled",
      actor: "ops-jane",
    });
    expect(stored()).toMatchObject({ status: "retrying", retryCount: 1 });

    await recordUnlockSuccess({ promptId: PROMPT, buyerWallet: BUYER, requestId: "req-2" });
    expect(stored().status).toBe("delivered");
  });

  it("reopens the dispute when the retried unlock fails again, keeping the first failure time", async () => {
    await recordUnlockFailure({ promptId: PROMPT, buyerWallet: BUYER, reason: "unlock_error", requestId: "a" });
    const firstFailure = stored().deliveryAttemptedAt;
    await applyDisputeTransition({ promptId: PROMPT, buyerWallet: BUYER, event: "retry_scheduled" });

    await recordUnlockFailure({ promptId: PROMPT, buyerWallet: BUYER, reason: "unlock_error", requestId: "b" });

    expect(stored()).toMatchObject({ status: "failed", unlockAttempts: 2 });
    expect(stored().deliveryAttemptedAt).toEqual(firstFailure);
  });

  it("escalates stale disputes to a refund request once (stale dispute handling)", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    await recordUnlockFailure({ promptId: PROMPT, buyerWallet: BUYER, reason: "unlock_error" });
    stored().lastTransitionAt = new Date(now.getTime() - 60 * 60 * 1000);
    await recordUnlockFailure({ promptId: "43", buyerWallet: BUYER, reason: "unlock_error" });
    fake.docs[1].lastTransitionAt = new Date(now.getTime() - 60 * 1000);

    expect(await sweepStaleDisputes(now)).toBe(1);
    expect(stored()).toMatchObject({
      status: "refund_requested",
      refundReason: "Auto-refund: delivery timeout",
    });
    expect(fake.docs[1].status).toBe("failed");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dispute_escalated", reason: "failed->refund_requested" }),
    );

    expect(await sweepStaleDisputes(now)).toBe(0);
  });

  it("does not escalate a dispute that changed after it was scanned", async () => {
    await recordUnlockFailure({ promptId: PROMPT, buyerWallet: BUYER, reason: "unlock_error" });

    const result = await applyDisputeTransition({
      promptId: PROMPT,
      buyerWallet: BUYER,
      event: "escalated",
      guard: { lastTransitionAt: new Date("2020-01-01T00:00:00.000Z") },
    });

    expect(result.outcome).toBe("invalid_transition");
    expect(stored().status).toBe("failed");
  });

  it("escalates legacy records that predate transition tracking", async () => {
    fake.docs.push({
      promptId: PROMPT,
      buyerWallet: buyer,
      status: "pending",
      processedEventKeys: [],
      auditLog: [],
      lastTransitionAt: null,
      deliveryAttemptedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(await sweepStaleDisputes(new Date("2026-09-24T00:00:00.000Z"))).toBe(1);
    expect(stored().status).toBe("refund_requested");
  });
});

describe("dispute views (#755)", () => {
  const record = {
    _id: "record-1",
    promptId: PROMPT,
    buyerWallet: buyer,
    status: "failed",
    txHash: "tx-secret",
    disputeTxHash: "dispute-tx",
    failureReason: "integrity_failure",
    refundReason: "free text from the buyer",
    resolvedBy: "ops-jane",
    unlockAttempts: 2,
    retryCount: 0,
    processedEventKeys: ["unlock:req-1"],
    lastTransitionAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    auditLog: [
      { status: "failed", event: "unlock_failed", actor: "system", note: "internal", at: new Date() },
    ],
  };

  it("keeps wallet, payment, and maintainer metadata out of the buyer view", () => {
    const view = toBuyerDisputeView(record, true);
    const serialized = JSON.stringify(view);

    expect(view).toMatchObject({ status: "failed", isOpen: true, refundEligible: true, unlockAttempts: 2 });
    for (const secret of [buyer, "tx-secret", "dispute-tx", "free text", "ops-jane", "unlock:req-1", "internal"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("flags disputes nobody has acted on in the maintainer queue", () => {
    expect(toMaintainerDisputeView(record).stale).toBe(true);
    expect(toMaintainerDisputeView({ ...record, status: "delivered" }).stale).toBe(false);
    expect(toMaintainerDisputeView({ ...record, lastTransitionAt: new Date() }).stale).toBe(false);
  });
});
