/**
 * Operator-safe backfill tool — Issue #966.
 *
 * The engine runs against an in-memory job so every scenario is deterministic:
 * dry-run isolation, batch checkpointing, resume after a crash between an
 * apply and its checkpoint save, failure isolation, and staged runs.
 */

import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  BackfillCheckpoint,
  BackfillJob,
  BackfillPlan,
  BackfillRecord,
  CheckpointStore,
  fileCheckpointStore,
  memoryCheckpointStore,
  runBackfill,
} from "../services/backfillEngine";
import { PROMPT_FILL_KEYS, PromptCollection, promptReadFillsJob } from "../services/backfillJobs";

type Row = { id: string; data: Record<string, unknown> };

/**
 * Job that sets `v` to 1 on every row. `plan` skips rows already at 1, which is
 * the idempotency property the engine relies on.
 */
function versionJob(rows: Row[], hooks: { applied?: string[]; failApply?: string; failPlan?: string } = {}): BackfillJob {
  return {
    name: "set-v1",
    async fetchPage(after, limit) {
      const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
      const start = after === null ? 0 : sorted.findIndex((row) => row.id > after);
      if (start === -1) return [];
      return sorted.slice(start, start + limit).map((row) => ({ id: row.id, data: { ...row.data } }));
    },
    plan(record): BackfillPlan {
      if (record.id === hooks.failPlan) throw new Error("plan exploded");
      if (record.data.v === 1) return { kind: "skip", reason: "already v1" };
      return { kind: "update", changes: { v: 1 } };
    },
    async apply(record, changes) {
      if (record.id === hooks.failApply) throw new Error("write rejected");
      const row = rows.find((candidate) => candidate.id === record.id)!;
      Object.assign(row.data, changes);
      hooks.applied?.push(record.id);
    },
  };
}

function makeRows(count: number, startV = 0): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${String(i + 1).padStart(2, "0")}`,
    data: { v: startV },
  }));
}

function countingStore(inner: CheckpointStore) {
  const saves: BackfillCheckpoint[] = [];
  const store: CheckpointStore = {
    load: () => inner.load(),
    async save(checkpoint) {
      saves.push(checkpoint);
      await inner.save(checkpoint);
    },
  };
  return { store, saves };
}

describe("runBackfill dry run (#966)", () => {
  it("reports every planned diff without writing or checkpointing", async () => {
    const rows = makeRows(3);
    const inner = memoryCheckpointStore();
    const { store, saves } = countingStore(inner);

    const report = await runBackfill(versionJob(rows), store, { dryRun: true, batchSize: 2 });

    expect(report.dryRun).toBe(true);
    expect(report.planned).toBe(3);
    expect(report.applied).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.diffs[0]).toEqual({ id: "r01", changes: { v: { before: 0, after: 1 } } });
    expect(rows.every((row) => row.data.v === 0)).toBe(true);
    expect(saves).toHaveLength(0);
    expect(await inner.load()).toBeNull();
  });

  it("caps the diff list and flags truncation", async () => {
    const report = await runBackfill(versionJob(makeRows(5)), memoryCheckpointStore(), {
      dryRun: true,
      diffLimit: 2,
    });
    expect(report.diffs).toHaveLength(2);
    expect(report.diffsTruncated).toBe(true);
    expect(report.planned).toBe(5);
  });
});

describe("runBackfill apply (#966)", () => {
  it("applies every change, marks the checkpoint complete, and is a no-op on re-run", async () => {
    const rows = makeRows(5);
    const inner = memoryCheckpointStore();

    const first = await runBackfill(versionJob(rows), inner, { dryRun: false, batchSize: 2 });
    expect(first.applied).toBe(5);
    expect(first.complete).toBe(true);
    expect(rows.every((row) => row.data.v === 1)).toBe(true);

    const checkpoint = await inner.load();
    expect(checkpoint).toMatchObject({ job: "set-v1", complete: true, appliedTotal: 5, cursor: "r05" });

    const second = await runBackfill(versionJob(rows), inner, { dryRun: false, batchSize: 2 });
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(0); // resumed past the end, nothing left to scan
    expect(second.complete).toBe(true);
  });

  it("checkpoints after every full batch", async () => {
    const { store, saves } = countingStore(memoryCheckpointStore());
    await runBackfill(versionJob(makeRows(5)), store, { dryRun: false, batchSize: 2 });

    expect(saves.map((save) => [save.cursor, save.complete])).toEqual([
      ["r02", false],
      ["r04", false],
      ["r05", true],
    ]);
  });

  it("resumes after a crash between apply and checkpoint save without double-applying", async () => {
    const rows = makeRows(6);
    const applied: string[] = [];
    const inner = memoryCheckpointStore();

    // Fail the second checkpoint write: batch 2 is applied but never recorded.
    let saveCalls = 0;
    const flaky: CheckpointStore = {
      load: () => inner.load(),
      async save(checkpoint) {
        saveCalls += 1;
        if (saveCalls === 2) throw new Error("disk full");
        await inner.save(checkpoint);
      },
    };

    await expect(
      runBackfill(versionJob(rows, { applied }), flaky, { dryRun: false, batchSize: 2 }),
    ).rejects.toThrow("disk full");

    expect(await inner.load()).toMatchObject({ cursor: "r02", complete: false });
    expect(applied).toEqual(["r01", "r02", "r03", "r04"]);

    const resumed = await runBackfill(versionJob(rows, { applied }), inner, {
      dryRun: false,
      batchSize: 2,
    });

    expect(resumed.resumedFrom).toBe("r02");
    expect(resumed.complete).toBe(true);
    expect(rows.every((row) => row.data.v === 1)).toBe(true);
    // Each record was written exactly once across both runs.
    expect(applied).toEqual(["r01", "r02", "r03", "r04", "r05", "r06"]);
    expect(new Set(applied).size).toBe(applied.length);
  });

  it("isolates a failing write and keeps going", async () => {
    const rows = makeRows(3);
    const report = await runBackfill(versionJob(rows, { failApply: "r02" }), memoryCheckpointStore(), {
      dryRun: false,
    });

    expect(report.applied).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.failures).toEqual([{ id: "r02", error: "write rejected" }]);
    expect(report.complete).toBe(true);
    expect(rows.map((row) => row.data.v)).toEqual([1, 0, 1]);
  });

  it("isolates a plan that throws", async () => {
    const report = await runBackfill(versionJob(makeRows(3), { failPlan: "r03" }), memoryCheckpointStore(), {
      dryRun: true,
    });
    expect(report.planned).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.failures[0]).toEqual({ id: "r03", error: "plan exploded" });
  });

  it("stages a large run with maxRecords and finishes on the next run", async () => {
    const rows = makeRows(5);
    const inner = memoryCheckpointStore();

    const first = await runBackfill(versionJob(rows), inner, { dryRun: false, batchSize: 2, maxRecords: 3 });
    expect(first.scanned).toBe(3);
    expect(first.complete).toBe(false);
    expect(await inner.load()).toMatchObject({ cursor: "r03", complete: false });

    const second = await runBackfill(versionJob(rows), inner, { dryRun: false, batchSize: 2 });
    expect(second.resumedFrom).toBe("r03");
    expect(second.complete).toBe(true);
    expect(rows.every((row) => row.data.v === 1)).toBe(true);
    expect((await inner.load())?.appliedTotal).toBe(5);
  });
});

describe("runBackfill checkpoint ownership (#966)", () => {
  it("refuses to resume a checkpoint that belongs to another job", async () => {
    const inner = memoryCheckpointStore({
      job: "some-other-job",
      cursor: "r01",
      appliedTotal: 1,
      complete: false,
      updatedAt: new Date().toISOString(),
    });
    await expect(runBackfill(versionJob(makeRows(2)), inner, { dryRun: false })).rejects.toThrow(
      /belongs to job "some-other-job"/,
    );
  });

  it("restart discards the existing checkpoint and begins at the first record", async () => {
    const rows = makeRows(2);
    const inner = memoryCheckpointStore({
      job: "set-v1",
      cursor: "r02",
      appliedTotal: 9,
      complete: false,
      updatedAt: new Date().toISOString(),
    });
    const report = await runBackfill(versionJob(rows), inner, { dryRun: false, restart: true });
    expect(report.resumedFrom).toBeNull();
    expect(report.applied).toBe(2);
  });
});

describe("fileCheckpointStore (#966)", () => {
  it("round-trips a checkpoint and leaves no temp file behind", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-test-"));
    try {
      const file = path.join(dir, "nested", "job.json");
      const store = fileCheckpointStore(file);

      expect(await store.load()).toBeNull();

      const checkpoint: BackfillCheckpoint = {
        job: "set-v1",
        cursor: "r04",
        appliedTotal: 4,
        complete: false,
        updatedAt: "2026-10-01T00:00:00.000Z",
      };
      await store.save(checkpoint);

      expect(await store.load()).toEqual(checkpoint);
      const entries = await fs.readdir(path.dirname(file));
      expect(entries).toEqual(["job.json"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("promptReadFillsJob (#966)", () => {
  function fakeCollection(docs: Array<Record<string, unknown>>) {
    const calls: { filter?: Record<string, unknown>; limit?: number; updates: unknown[] } = {
      updates: [],
    };
    const collection: PromptCollection = {
      find(filter) {
        calls.filter = filter;
        const chain = {
          sort: () => chain,
          limit(n: number) {
            calls.limit = n;
            return chain;
          },
          lean: async () => docs.slice(0, calls.limit),
        };
        return chain;
      },
      async updateOne(filter, update) {
        calls.updates.push({ filter, update });
        return {};
      },
    };
    return { collection, calls };
  }

  const job = promptReadFillsJob({ find: () => null, updateOne: async () => null } as PromptCollection);

  it("selects only records below the current schema version, after the cursor", async () => {
    const { collection, calls } = fakeCollection([{ _id: "p1", schemaVersion: 0 }]);
    const pageJob = promptReadFillsJob(collection);

    const page = await pageJob.fetchPage("64f0000000000000000000aa", 25);

    expect(calls.filter).toEqual({
      $or: [{ schemaVersion: { $exists: false } }, { schemaVersion: { $lt: 2 } }],
      _id: { $gt: "64f0000000000000000000aa" },
    });
    expect(calls.limit).toBe(25);
    expect(page).toEqual([{ id: "p1", data: { _id: "p1", schemaVersion: 0 } }]);
  });

  it("plans the read-path fills for an unversioned prompt", () => {
    const plan = job.plan({ id: "p1", data: { _id: "p1", title: "Legacy" } });
    expect(plan.kind).toBe("update");
    if (plan.kind !== "update") return;
    expect(plan.changes).toMatchObject({
      schemaVersion: 2,
      moderationStatus: "none",
      tags: [],
      description: "",
      licence: "standard",
      category: "Other",
      listingStatus: "draft",
    });
    expect(plan.changes).toHaveProperty("lifecycleState");
    expect(Object.keys(plan.changes).every((key) => (PROMPT_FILL_KEYS as readonly string[]).includes(key))).toBe(true);
  });

  it("skips a prompt that already matches the read path", () => {
    const plan = job.plan({
      id: "p2",
      data: {
        _id: "p2",
        schemaVersion: 2,
        lifecycleState: "published",
        moderationStatus: "none",
        tags: [],
        description: "",
        licence: "standard",
      },
    });
    expect(plan.kind).toBe("skip");
  });

  it("is idempotent: a planned record re-plans as skip once its changes are applied", () => {
    const data = { _id: "p3", title: "Legacy" };
    const first = job.plan({ id: "p3", data });
    expect(first.kind).toBe("update");
    if (first.kind !== "update") return;
    expect(job.plan({ id: "p3", data: { ...data, ...first.changes } }).kind).toBe("skip");
  });

  it("rejects records written by a newer build instead of rewriting them", () => {
    expect(() => job.plan({ id: "p4", data: { _id: "p4", schemaVersion: 3 } })).toThrow();
  });

  it("writes only the planned $set, targeting the record's _id", async () => {
    const { collection, calls } = fakeCollection([]);
    const writeJob = promptReadFillsJob(collection);
    const record: BackfillRecord = { id: "p5", data: { _id: "p5", title: "x" } };

    await writeJob.apply(record, { schemaVersion: 2 });

    expect(calls.updates).toEqual([{ filter: { _id: "p5" }, update: { $set: { schemaVersion: 2 } } }]);
  });
});
