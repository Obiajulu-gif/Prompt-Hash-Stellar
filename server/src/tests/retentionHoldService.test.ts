import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../models/InboundWebhookEvent", () => ({ default: {} }));
vi.mock("../models/QuarantinedEvent", () => ({ default: {} }));
vi.mock("../models/JobRecord", () => ({ default: {} }));
vi.mock("../models/Report", () => ({ default: {} }));
vi.mock("../models/RetentionHold", async () => ({
  default: {},
  HOLD_CASE_TYPES: ["dispute", "investigation", "legal"],
  HOLDABLE_COLLECTIONS: ["inboundWebhookEvents", "quarantinedEvents", "exports", "supportEvidence"],
}));
vi.mock("../services/auditTrail", () => ({ recordAuditEvent: vi.fn() }));

import {
  HOLDABLE_COLLECTIONS,
  MANAGED_FLAG_REASON,
  RetentionHoldError,
  getActiveHeldRecordIds,
  listOverdueHolds,
  placeHold,
  reconcileHoldFlags,
  releaseHold,
  validateHoldRequest,
  type HoldStore,
  type HoldTargetStore,
  type HoldableCollection,
  type RetentionHoldDeps,
  type RetentionHoldRecord,
} from "../services/retentionHoldService";

const id = (n: number) => n.toString(16).padStart(24, "0");
const NOW = new Date("2026-10-01T00:00:00.000Z");

interface FakeRecord {
  retentionHold: boolean;
  reason: string | null;
  archivedAt: Date | null;
}

function fakeTarget(records: Record<string, FakeRecord>): HoldTargetStore & { records: Record<string, FakeRecord> } {
  return {
    records,
    async findByIds(ids) {
      return ids
        .filter((i) => records[i])
        .map((i) => ({ id: i, retentionHold: records[i].retentionHold, archivedAt: records[i].archivedAt }));
    },
    async flagManaged(ids) {
      let n = 0;
      for (const i of ids) {
        if (records[i] && !records[i].retentionHold) {
          records[i].retentionHold = true;
          records[i].reason = MANAGED_FLAG_REASON;
          n++;
        }
      }
      return n;
    },
    async unflagManaged(ids) {
      let n = 0;
      for (const i of ids) {
        if (records[i]?.retentionHold && records[i].reason === MANAGED_FLAG_REASON) {
          records[i].retentionHold = false;
          records[i].reason = null;
          n++;
        }
      }
      return n;
    },
    async listManagedFlagged() {
      return Object.keys(records).filter((i) => records[i].retentionHold && records[i].reason === MANAGED_FLAG_REASON);
    },
  };
}

function fakeHoldStore(): HoldStore & { all: RetentionHoldRecord[]; failInsert?: boolean; failList?: boolean } {
  const store: any = {
    all: [] as RetentionHoldRecord[],
    async insert(doc: any) {
      if (store.failInsert) throw new Error("insert failed");
      const rec = { ...doc, id: id(1000 + store.all.length), createdAt: NOW };
      store.all.push(rec);
      return rec;
    },
    async get(i: string) {
      return store.all.find((h: RetentionHoldRecord) => h.id === i) ?? null;
    },
    async list(filter: any) {
      if (store.failList) throw new Error("list failed");
      return store.all.filter(
        (h: RetentionHoldRecord) =>
          (!filter.status || h.status === filter.status) && (!filter.caseRef || h.caseRef === filter.caseRef),
      );
    },
    async release(i: string, patch: any) {
      const h = store.all.find((x: RetentionHoldRecord) => x.id === i && x.status === "active");
      if (!h) return null;
      Object.assign(h, { status: "released", ...patch });
      return h;
    },
  };
  return store;
}

function setup(seed: Partial<Record<HoldableCollection, Record<string, FakeRecord>>> = {}) {
  const fresh = (): FakeRecord => ({ retentionHold: false, reason: null, archivedAt: null });
  const targets = Object.fromEntries(
    HOLDABLE_COLLECTIONS.map((c) => [c, fakeTarget(seed[c] ?? {})]),
  ) as Record<HoldableCollection, ReturnType<typeof fakeTarget>>;
  const holds = fakeHoldStore();
  const audit = vi.fn(async () => undefined);
  const deps: RetentionHoldDeps = {
    holds,
    targets,
    findReportIdsForPrompt: vi.fn(async (promptId: string) =>
      Object.keys(targets.supportEvidence.records).filter(() => promptId === "prompt-1"),
    ),
    audit,
    now: () => NOW,
  };
  return { deps, holds, targets, audit, fresh };
}

const request = (over: Record<string, unknown> = {}) => ({
  caseType: "dispute",
  caseRef: "case-42",
  reason: "Buyer dispute pending, evidence must be preserved",
  actor: "admin-1",
  links: [{ collection: "supportEvidence", recordId: id(1) }],
  ...over,
});

describe("validateHoldRequest", () => {
  it("accepts a well-formed request and normalises ids", () => {
    const r = validateHoldRequest(request({ links: [{ collection: "exports", recordId: id(1).toUpperCase() }] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.links[0].recordId).toBe(id(1));
      expect(r.value.reviewDays).toBe(90);
    }
  });

  it("rejects bad case types, short reasons, missing links and bad ids", () => {
    const r = validateHoldRequest({
      caseType: "whatever",
      caseRef: "",
      reason: "short",
      actor: "",
      links: [{ collection: "supportEvidence", recordId: "nope" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/caseType/);
      expect(r.errors.join("\n")).toMatch(/caseRef/);
      expect(r.errors.join("\n")).toMatch(/reason/);
      expect(r.errors.join("\n")).toMatch(/actor/);
      expect(r.errors.join("\n")).toMatch(/not a valid record id/);
    }
  });

  it("rejects collections that cleanup never archives", () => {
    const r = validateHoldRequest(request({ links: [{ collection: "auditLogs", recordId: id(1) }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/never archived/);
  });

  it("de-duplicates links and bounds review days", () => {
    const dup = { collection: "exports", recordId: id(2) };
    const r = validateHoldRequest(request({ links: [dup, dup], reviewDays: 9999 }));
    expect(r.ok).toBe(false);
    const ok = validateHoldRequest(request({ links: [dup, dup] }));
    if (ok.ok) expect(ok.value.links).toHaveLength(1);
  });
});

describe("placeHold", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup({
      supportEvidence: { [id(1)]: { retentionHold: false, reason: null, archivedAt: null }, [id(2)]: { retentionHold: false, reason: null, archivedAt: null } },
      exports: { [id(3)]: { retentionHold: false, reason: null, archivedAt: null } },
    });
  });

  it("flags linked records, writes the ledger, and audits", async () => {
    const { hold, created } = await placeHold(
      request({ links: [{ collection: "supportEvidence", recordId: id(1) }, { collection: "exports", recordId: id(3) }] }),
      ctx.deps,
    );
    expect(created).toBe(true);
    expect(hold.status).toBe("active");
    expect(ctx.targets.supportEvidence.records[id(1)]).toMatchObject({ retentionHold: true, reason: MANAGED_FLAG_REASON });
    expect(ctx.targets.exports.records[id(3)].retentionHold).toBe(true);
    expect(ctx.targets.supportEvidence.records[id(2)].retentionHold).toBe(false);
    expect(ctx.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "retention_hold_created", actor: "admin-1" }));
    expect(hold.reviewBy.getTime()).toBe(NOW.getTime() + 90 * 86400000);
  });

  it("refuses to hold records that do not exist and changes nothing", async () => {
    await expect(
      placeHold(request({ links: [{ collection: "supportEvidence", recordId: id(1) }, { collection: "exports", recordId: id(99) }] }), ctx.deps),
    ).rejects.toMatchObject({ code: "record_not_found", details: [`exports:${id(99)}`] });
    expect(ctx.targets.supportEvidence.records[id(1)].retentionHold).toBe(false);
    expect(ctx.holds.all).toHaveLength(0);
  });

  it("is idempotent for an identical active hold", async () => {
    const first = await placeHold(request(), ctx.deps);
    const second = await placeHold(request(), ctx.deps);
    expect(second.created).toBe(false);
    expect(second.hold.id).toBe(first.hold.id);
    expect(ctx.holds.all).toHaveLength(1);
  });

  it("rolls back the flags it set when the ledger write fails", async () => {
    ctx.holds.failInsert = true;
    await expect(placeHold(request(), ctx.deps)).rejects.toThrow("insert failed");
    expect(ctx.targets.supportEvidence.records[id(1)].retentionHold).toBe(false);
  });

  it("does not overwrite or later clear a manually set flag", async () => {
    ctx.targets.supportEvidence.records[id(1)] = { retentionHold: true, reason: "legal request #7", archivedAt: null };
    const { hold } = await placeHold(request(), ctx.deps);
    expect(ctx.targets.supportEvidence.records[id(1)].reason).toBe("legal request #7");
    await releaseHold(hold.id, { actor: "admin-2", reason: "Dispute closed in buyer's favour" }, ctx.deps);
    expect(ctx.targets.supportEvidence.records[id(1)]).toMatchObject({ retentionHold: true, reason: "legal request #7" });
  });

  it("reports already-archived records instead of silently pretending they are protected", async () => {
    ctx.targets.supportEvidence.records[id(2)].archivedAt = new Date("2026-01-01");
    const res = await placeHold(
      request({ links: [{ collection: "supportEvidence", recordId: id(2) }] }),
      ctx.deps,
    );
    expect(res.alreadyArchived).toEqual([`supportEvidence:${id(2)}`]);
  });

  it("can link every report filed against a prompt", async () => {
    const res = await placeHold(request({ links: [], includePromptReportsFor: "prompt-1" }), ctx.deps);
    expect(res.hold.links.map((l) => l.recordId).sort()).toEqual([id(1), id(2)]);
    expect(ctx.targets.supportEvidence.records[id(2)].retentionHold).toBe(true);
  });

  it("errors when the prompt has no reports to hold", async () => {
    await expect(
      placeHold(request({ links: [], includePromptReportsFor: "other-prompt" }), ctx.deps),
    ).rejects.toMatchObject({ code: "record_not_found" });
  });

  it("surfaces validation failures as RetentionHoldError(invalid_request)", async () => {
    await expect(placeHold(request({ reason: "x" }), ctx.deps)).rejects.toBeInstanceOf(RetentionHoldError);
  });
});

describe("releaseHold", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup({
      supportEvidence: { [id(1)]: { retentionHold: false, reason: null, archivedAt: null } },
    });
  });
  const releaseInput = { actor: "admin-2", reason: "Investigation closed, nothing to preserve" };

  it("returns records to normal retention and audits the release", async () => {
    const { hold } = await placeHold(request(), ctx.deps);
    const res = await releaseHold(hold.id, releaseInput, ctx.deps);
    expect(res).toMatchObject({ releasedRecords: 1, stillHeld: 0, flagsCleared: true });
    expect(res.hold).toMatchObject({ status: "released", releasedBy: "admin-2" });
    expect(ctx.targets.supportEvidence.records[id(1)]).toMatchObject({ retentionHold: false, reason: null });
    expect(ctx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "retention_hold_released", result: "success", actor: "admin-2" }),
    );
    expect((await getActiveHeldRecordIds(ctx.deps)).supportEvidence).toEqual([]);
  });

  it("keeps a record protected while another active hold still covers it", async () => {
    const a = await placeHold(request({ caseRef: "case-A" }), ctx.deps);
    const b = await placeHold(request({ caseType: "investigation", caseRef: "case-B" }), ctx.deps);

    const first = await releaseHold(a.hold.id, releaseInput, ctx.deps);
    expect(first).toMatchObject({ releasedRecords: 0, stillHeld: 1 });
    expect(ctx.targets.supportEvidence.records[id(1)].retentionHold).toBe(true);
    expect((await getActiveHeldRecordIds(ctx.deps)).supportEvidence).toEqual([id(1)]);

    const second = await releaseHold(b.hold.id, releaseInput, ctx.deps);
    expect(second.releasedRecords).toBe(1);
    expect(ctx.targets.supportEvidence.records[id(1)].retentionHold).toBe(false);
  });

  it("rejects unknown ids, double release, and thin justifications", async () => {
    const { hold } = await placeHold(request(), ctx.deps);
    await expect(releaseHold(id(555), releaseInput, ctx.deps)).rejects.toMatchObject({ code: "hold_not_found" });
    await expect(releaseHold(hold.id, { actor: "a", reason: "ok" }, ctx.deps)).rejects.toMatchObject({
      code: "invalid_request",
    });
    await releaseHold(hold.id, releaseInput, ctx.deps);
    await expect(releaseHold(hold.id, releaseInput, ctx.deps)).rejects.toMatchObject({ code: "already_released" });
  });

  it("fails safe when clearing flags errors: stays flagged, reports it, reconcile finishes the job", async () => {
    const { hold } = await placeHold(request(), ctx.deps);
    const real = ctx.targets.supportEvidence.unflagManaged;
    ctx.targets.supportEvidence.unflagManaged = async () => {
      throw new Error("db blip");
    };
    const res = await releaseHold(hold.id, releaseInput, ctx.deps);
    expect(res.flagsCleared).toBe(false);
    expect(ctx.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "retention_hold_released", result: "failure" }));
    expect(ctx.targets.supportEvidence.records[id(1)].retentionHold).toBe(true);

    ctx.targets.supportEvidence.unflagManaged = real;
    const dry = await reconcileHoldFlags({ dryRun: true }, ctx.deps);
    expect(dry.orphanedFlags.supportEvidence).toEqual([id(1)]);
    expect(dry.cleared).toBe(0);
    expect(ctx.targets.supportEvidence.records[id(1)].retentionHold).toBe(true);

    const run = await reconcileHoldFlags({ dryRun: false }, ctx.deps);
    expect(run.cleared).toBe(1);
    expect(ctx.targets.supportEvidence.records[id(1)].retentionHold).toBe(false);
  });
});

describe("getActiveHeldRecordIds / overdue / reconcile", () => {
  it("lists each held id once per collection, ignoring released holds", async () => {
    const ctx = setup({
      supportEvidence: { [id(1)]: { retentionHold: false, reason: null, archivedAt: null } },
      exports: { [id(3)]: { retentionHold: false, reason: null, archivedAt: null } },
    });
    await placeHold(request({ caseRef: "A" }), ctx.deps);
    await placeHold(request({ caseRef: "B", links: [{ collection: "supportEvidence", recordId: id(1) }, { collection: "exports", recordId: id(3) }] }), ctx.deps);
    const held = await getActiveHeldRecordIds(ctx.deps);
    expect(held.supportEvidence).toEqual([id(1)]);
    expect(held.exports).toEqual([id(3)]);
    expect(held.inboundWebhookEvents).toEqual([]);
  });

  it("throws ledger_unavailable rather than returning an empty (unsafe) set", async () => {
    const ctx = setup();
    ctx.holds.failList = true;
    await expect(getActiveHeldRecordIds(ctx.deps)).rejects.toMatchObject({ code: "ledger_unavailable" });
  });

  it("flags active holds past their review date", async () => {
    const ctx = setup({ supportEvidence: { [id(1)]: { retentionHold: false, reason: null, archivedAt: null } } });
    const { hold } = await placeHold(request({ reviewDays: 1 }), ctx.deps);
    expect(await listOverdueHolds({ holds: ctx.holds, now: () => NOW })).toHaveLength(0);
    const later = new Date(NOW.getTime() + 2 * 86400000);
    expect((await listOverdueHolds({ holds: ctx.holds, now: () => later })).map((h) => h.id)).toEqual([hold.id]);
  });

  it("reconcile never touches active holds' flags or manual flags", async () => {
    const ctx = setup({
      supportEvidence: {
        [id(1)]: { retentionHold: false, reason: null, archivedAt: null },
        [id(2)]: { retentionHold: true, reason: "manual legal hold", archivedAt: null },
      },
    });
    await placeHold(request(), ctx.deps);
    const res = await reconcileHoldFlags({ dryRun: false }, ctx.deps);
    expect(res.cleared).toBe(0);
    expect(ctx.targets.supportEvidence.records[id(1)].retentionHold).toBe(true);
    expect(ctx.targets.supportEvidence.records[id(2)].retentionHold).toBe(true);
  });
});
