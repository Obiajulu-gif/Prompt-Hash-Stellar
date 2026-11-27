/**
 * Dry-run repair tooling with checkpoints (#1129).
 *
 * Runs the real backfill engine against an in-memory port, covering:
 *   - normal:        dry run reports diffs and writes nothing; apply converges;
 *                    a second run is a no-op
 *   - failure:       a purchase without a buyer wallet, and a write that throws,
 *                    are recorded per record while the rest of the run continues
 *   - retry:         a failed write is picked up by a restart run and converges
 *   - resume:        an interrupted run resumes from the last checkpoint
 *   - authorization: writes require --actor on the REPAIR_OPERATORS allowlist
 */
import { describe, expect, it } from "vitest";
import { memoryCheckpointStore, runBackfill } from "../services/backfillEngine";
import {
  ENTITLEMENT_REPAIR_JOB,
  authorizeRepairWrite,
  desiredEntitlementStatus,
  entitlementKey,
  entitlementRepairJob,
  type EntitlementKey,
  type EntitlementRepairPort,
  type RepairPurchase,
} from "../services/entitlementRepairJob";
import type { EntitlementStatus } from "../models/Entitlement";

const OP = "ops-alice";

function purchases(): RepairPurchase[] {
  return [
    // Paid, no entitlement yet: should grant active.
    { _id: "000000000000000000000001", buyerWallet: "GBUY1", promptId: "pr1", status: "paid", txHash: "tx1" },
    // Refunded, entitlement still active: should move to refunded.
    { _id: "000000000000000000000002", buyerWallet: "GBUY2", promptId: "pr2", disputeResolution: "refunded" },
    // Refunded, never granted: nothing to revoke, skip.
    { _id: "000000000000000000000003", buyerWallet: "GBUY3", promptId: "pr3", status: "refunded" },
    // Paid, already active, wallet in mixed case: skip.
    { _id: "000000000000000000000004", buyerWallet: "GBUY4", promptId: "pr4", status: "paid" },
    // Malformed: no buyer wallet. Must be a recorded failure, not a silent skip.
    { _id: "000000000000000000000005", buyerWallet: null, promptId: "pr5", status: "paid" },
  ];
}

interface FakeState {
  rows: Map<string, EntitlementStatus>;
  writes: Array<{ purchaseId: string; key: string; before: EntitlementStatus | null; status: EntitlementStatus; actor: string }>;
  failOnce: Set<string>;
}

function fakeState(initial: Array<[EntitlementKey, EntitlementStatus]> = []): FakeState {
  const rows = new Map<string, EntitlementStatus>();
  for (const [key, status] of initial) rows.set(entitlementKey(key), status);
  return { rows, writes: [], failOnce: new Set() };
}

/** Entitlements that already exist: gbuy2 is active (needs refund), gbuy4 is active (already correct). */
function seeded(): FakeState {
  return fakeState([
    [{ userAddress: "gbuy2", promptId: "pr2" }, "active"],
    [{ userAddress: "gbuy4", promptId: "pr4" }, "active"],
  ]);
}

function fakePort(data: RepairPurchase[], state: FakeState): EntitlementRepairPort {
  return {
    async listPurchases(after, limit) {
      return data.filter((p) => !after || p._id > after).slice(0, limit);
    },
    async currentStatuses(keys) {
      const out = new Map<string, EntitlementStatus | null>();
      for (const k of keys) out.set(entitlementKey(k), state.rows.get(entitlementKey(k)) ?? null);
      return out;
    },
    async writeEntitlement(input) {
      if (state.failOnce.has(input.purchaseId)) {
        state.failOnce.delete(input.purchaseId);
        throw new Error("simulated write failure");
      }
      const key = entitlementKey({ userAddress: input.userAddress, promptId: input.promptId });
      state.rows.set(key, input.status);
      state.writes.push({
        purchaseId: input.purchaseId,
        key,
        before: input.before,
        status: input.status,
        actor: input.actor,
      });
    },
  };
}

const run = (state: FakeState, data: RepairPurchase[], opts: Parameters<typeof runBackfill>[2], store = memoryCheckpointStore()) =>
  runBackfill(entitlementRepairJob(fakePort(data, state), OP), store, opts);

describe("entitlement repair — normal path (#1129)", () => {
  it("dry run reports the planned changes and writes nothing", async () => {
    const state = seeded();
    const store = memoryCheckpointStore();
    const report = await run(state, purchases(), { dryRun: true, batchSize: 10 }, store);

    expect(report.job).toBe(ENTITLEMENT_REPAIR_JOB);
    expect(report.planned).toBe(2);
    expect(report.skipped).toBe(2);
    expect(report.applied).toBe(0);
    expect(report.diffs.map((d) => d.id).sort()).toEqual([
      "000000000000000000000001",
      "000000000000000000000002",
    ]);
    expect(state.writes).toHaveLength(0);
    expect(state.rows.get("gbuy2|pr2")).toBe("active");
    expect(await store.load()).toBeNull();
  });

  it("apply converges the entitlements and records each write with its operator", async () => {
    const state = seeded();
    const report = await run(state, purchases(), { dryRun: false, batchSize: 10 });

    expect(report.applied).toBe(2);
    expect(report.complete).toBe(true);
    expect(state.rows.get("gbuy1|pr1")).toBe("active");
    expect(state.rows.get("gbuy2|pr2")).toBe("refunded");
    expect(state.writes.every((w) => w.actor === OP)).toBe(true);
    expect(state.writes.find((w) => w.purchaseId === "000000000000000000000002")?.before).toBe("active");
  });

  it("a second apply is a no-op, so the repair is safe to rerun", async () => {
    const state = fakeState();
    await run(state, purchases(), { dryRun: false, batchSize: 10 });
    const again = await run(state, purchases(), { dryRun: false, batchSize: 10, restart: true });

    expect(again.applied).toBe(0);
    expect(again.planned).toBe(0);
    expect(again.skipped).toBe(4);
  });

  it("maps refunded and disputed-refunded purchases to refunded, everything else to active", () => {
    expect(desiredEntitlementStatus({ _id: "a", status: "refunded" })).toBe("refunded");
    expect(desiredEntitlementStatus({ _id: "a", disputeResolution: "refunded" })).toBe("refunded");
    expect(desiredEntitlementStatus({ _id: "a", status: "paid", disputeResolution: "upheld" })).toBe("active");
  });
});

describe("entitlement repair — failure paths (#1129)", () => {
  it("records a malformed purchase as a failure and keeps repairing the rest", async () => {
    const state = fakeState();
    const report = await run(state, purchases(), { dryRun: false, batchSize: 10 });

    expect(report.failed).toBe(1);
    expect(report.failures).toEqual([
      expect.objectContaining({ id: "000000000000000000000005", error: expect.stringMatching(/missing its buyer wallet/) }),
    ]);
    expect(report.applied).toBe(2);
    expect(report.complete).toBe(true);
  });

  it("isolates a failed write: the other records still apply and the failure is reported", async () => {
    const state = seeded();
    state.failOnce.add("000000000000000000000001");
    const report = await run(state, purchases(), { dryRun: false, batchSize: 10 });

    expect(report.failed).toBe(2); // the write failure and the malformed purchase
    expect(report.applied).toBe(1);
    expect(state.rows.has("gbuy1|pr1")).toBe(false);
    expect(state.rows.get("gbuy2|pr2")).toBe("refunded");
  });
});

describe("entitlement repair — retry and resume (#1129)", () => {
  it("a restart run picks up a previously failed write and converges", async () => {
    const state = fakeState();
    state.failOnce.add("000000000000000000000001");
    await run(state, purchases(), { dryRun: false, batchSize: 10 });
    expect(state.rows.has("gbuy1|pr1")).toBe(false);

    const retry = await run(state, purchases(), { dryRun: false, batchSize: 10, restart: true });
    expect(retry.applied).toBe(1);
    expect(state.rows.get("gbuy1|pr1")).toBe("active");
  });

  it("an interrupted run resumes from its checkpoint and applies every change exactly once", async () => {
    const state = seeded();
    const store = memoryCheckpointStore();

    const first = await run(state, purchases(), { dryRun: false, batchSize: 2, maxRecords: 2 }, store);
    expect(first.complete).toBe(false);
    expect(first.cursor).toBe("000000000000000000000002");
    expect((await store.load())?.cursor).toBe("000000000000000000000002");

    const second = await run(state, purchases(), { dryRun: false, batchSize: 2 }, store);
    expect(second.resumedFrom).toBe("000000000000000000000002");
    expect(second.complete).toBe(true);
    expect(state.writes.map((w) => w.purchaseId).sort()).toEqual([
      "000000000000000000000001",
      "000000000000000000000002",
    ]);
  });

  it("refuses to resume a checkpoint that belongs to another job", async () => {
    const store = memoryCheckpointStore({
      job: "some-other-job",
      cursor: null,
      appliedTotal: 0,
      complete: false,
      updatedAt: new Date().toISOString(),
    });
    await expect(run(fakeState(), purchases(), { dryRun: false }, store)).rejects.toThrow(/belongs to job/);
  });
});

describe("entitlement repair — authorization (#1129)", () => {
  const allowlist = ["ops-alice", "ops-bob"];

  it("refuses a write without an actor", () => {
    expect(authorizeRepairWrite(undefined, allowlist)).toMatch(/Writes require --actor/);
    expect(authorizeRepairWrite("   ", allowlist)).toMatch(/Writes require --actor/);
  });

  it("refuses every write when the allowlist is empty or unset", () => {
    expect(authorizeRepairWrite(OP, [])).toMatch(/REPAIR_OPERATORS is empty or unset/);
  });

  it("refuses an operator who is not on the allowlist", () => {
    expect(authorizeRepairWrite("mallory", allowlist)).toMatch(/not on the REPAIR_OPERATORS allowlist/);
  });

  it("permits a listed operator, ignoring surrounding whitespace", () => {
    expect(authorizeRepairWrite(" ops-bob ", allowlist)).toBeNull();
  });
});
