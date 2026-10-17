/**
 * Tests for Projection Integrity (Issues #985, #987, #1001)
 */

import { describe, it, expect, vi } from "vitest";
import {
  detectDuplicateCandidates,
  proposeMerge,
  reviewMerge,
  applyMerge,
  revertMerge,
  verifyMergeHistory,
  reconcileProjection,
  repairDrift,
  MergeWorkflowError,
  type PromptSnapshot,
  type ProjectionEntry,
} from "../services/projectionIntegrity.js";

const T0 = new Date("2026-10-01T00:00:00.000Z");
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

const LONG =
  "You are a senior Stellar engineer. Review this Soroban contract for reentrancy, auth bypass and storage TTL issues, then output a prioritized fix list.";

function prompt(id: string, content: string, extra: Partial<PromptSnapshot> = {}): PromptSnapshot {
  return { id, content, version: 1, updatedAt: T0, visible: true, mergedInto: null, ...extra };
}

const catalog = [
  prompt("p3", LONG.replace("prioritized", "prioritised")),
  prompt("p1", LONG),
  prompt("p2", `  ${LONG.toUpperCase()}  `),
  prompt("p4", "Write a haiku about lumens and ledgers closing every five seconds on the network."),
];

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as MergeWorkflowError).code;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// #985 duplicate detection
// ---------------------------------------------------------------------------

describe("detectDuplicateCandidates", () => {
  it("finds exact (normalized) and near duplicates, ignoring unrelated prompts", () => {
    const result = detectDuplicateCandidates(catalog);
    const pairs = result.map((c) => `${c.primaryId}-${c.duplicateId}:${c.reason}`);
    expect(pairs).toEqual(["p1-p2:exact_hash", "p1-p3:near_text", "p2-p3:near_text"]);
    expect(result.every((c) => c.score >= 0.9)).toBe(true);
  });

  it("is reproducible regardless of input order", () => {
    const a = detectDuplicateCandidates(catalog);
    const b = detectDuplicateCandidates([...catalog].reverse());
    expect(b).toEqual(a);
  });

  it("skips prompts that were already merged away", () => {
    const merged = catalog.map((p) => (p.id === "p2" ? { ...p, mergedInto: "p1" } : p));
    expect(detectDuplicateCandidates(merged).some((c) => c.duplicateId === "p2" || c.primaryId === "p2")).toBe(false);
  });

  it("prefers stored content hashes over derived ones", () => {
    const res = detectDuplicateCandidates([
      prompt("a", "alpha", { contentHash: "h1" }),
      prompt("b", "totally different text", { contentHash: "h1" }),
    ]);
    expect(res[0].reason).toBe("exact_hash");
  });
});

// ---------------------------------------------------------------------------
// #985 merge workflow
// ---------------------------------------------------------------------------

describe("merge review workflow", () => {
  const [candidate] = detectDuplicateCandidates(catalog);
  const dup = catalog.find((p) => p.id === candidate.duplicateId)!;

  it("runs propose → approve → apply → revert with a verifiable audit chain", () => {
    let p = proposeMerge(candidate, dup, "alice", at(0));
    p = reviewMerge(p, "bob", "approve", "same prompt reposted", at(1));
    const applied = applyMerge(p, dup, "bob", at(2));
    expect(applied.duplicate).toMatchObject({ mergedInto: "p1", visible: false, version: 2 });

    const reverted = revertMerge(applied.proposal, applied.duplicate, "carol", "false positive", at(3));
    expect(reverted.duplicate).toMatchObject({ mergedInto: null, visible: true, version: 3 });
    expect(reverted.proposal.status).toBe("reverted");
    expect(reverted.proposal.history.map((e) => `${e.from}>${e.to}`)).toEqual([
      "null>proposed",
      "proposed>approved",
      "approved>applied",
      "applied>reverted",
    ]);
    expect(verifyMergeHistory(reverted.proposal)).toBe(-1);
    for (let i = 1; i < reverted.proposal.history.length; i++) {
      expect(reverted.proposal.history[i].previousHash).toBe(reverted.proposal.history[i - 1].hash);
    }
  });

  it("detects tampering in the audit history", () => {
    let p = proposeMerge(candidate, dup, "alice", at(0));
    p = reviewMerge(p, "bob", "approve", "ok", at(1));
    const tampered = { ...p, history: p.history.map((e, i) => (i === 1 ? { ...e, actor: "alice" } : e)) };
    expect(verifyMergeHistory(tampered)).toBe(1);
  });

  it("detects a rewritten final transition or status", () => {
    let p = proposeMerge(candidate, dup, "alice", at(0));
    p = reviewMerge(p, "bob", "reject", "different intent", at(1));
    const last = p.history.length - 1;
    const flipped = {
      ...p,
      status: "approved" as const,
      history: p.history.map((e, i) => (i === last ? { ...e, action: "approve" as const, to: "approved" as const } : e)),
    };
    expect(verifyMergeHistory(flipped)).toBe(last);
    expect(verifyMergeHistory({ ...p, status: "approved" })).toBe(p.history.length);
  });

  it("enforces four-eyes review and required reasons", () => {
    const p = proposeMerge(candidate, dup, "alice", at(0));
    expect(code(() => reviewMerge(p, "alice", "approve", "mine", at(1)))).toBe("SELF_REVIEW");
    expect(code(() => reviewMerge(p, "bob", "approve", "  ", at(1)))).toBe("REASON_REQUIRED");
  });

  it("refuses invalid transitions", () => {
    const p = proposeMerge(candidate, dup, "alice", at(0));
    expect(code(() => applyMerge(p, dup, "bob", at(1)))).toBe("INVALID_TRANSITION");
    const rejected = reviewMerge(p, "bob", "reject", "different intent", at(1));
    expect(code(() => applyMerge(rejected, dup, "bob", at(2)))).toBe("INVALID_TRANSITION");
  });

  it("refuses to apply a stale proposal", () => {
    let p = proposeMerge(candidate, dup, "alice", at(0));
    p = reviewMerge(p, "bob", "approve", "ok", at(1));
    expect(code(() => applyMerge(p, { ...dup, version: 5 }, "bob", at(2)))).toBe("STALE_PROPOSAL");
  });

  it("refuses revert when the duplicate was re-pointed elsewhere", () => {
    let p = proposeMerge(candidate, dup, "alice", at(0));
    p = reviewMerge(p, "bob", "approve", "ok", at(1));
    const applied = applyMerge(p, dup, "bob", at(2));
    const moved = { ...applied.duplicate, mergedInto: "p9" };
    expect(code(() => revertMerge(applied.proposal, moved, "carol", "undo", at(3)))).toBe("NOT_REVERSIBLE");
  });
});

// ---------------------------------------------------------------------------
// #987 / #1001 reconciliation + stale detection
// ---------------------------------------------------------------------------

describe("reconcileProjection", () => {
  const source: PromptSnapshot[] = [
    prompt("ok", "fine", { version: 2, contentHash: "h-ok" }),
    prompt("missing", "m"),
    prompt("behind", "b", { version: 3 }),
    prompt("ahead", "a", { version: 1 }),
    prompt("hidden", "h", { visible: false }),
    prompt("merged", "x", { mergedInto: "ok" }),
    prompt("hash", "c", { version: 1, contentHash: "real" }),
    prompt("old", "o"),
  ];
  const entry = (id: string, extra: Partial<ProjectionEntry> = {}): ProjectionEntry => ({
    id,
    version: 1,
    visible: true,
    projectedAt: at(0),
    ...extra,
  });
  const entries: ProjectionEntry[] = [
    entry("ok", { version: 2, contentHash: "h-ok", projectedAt: at(100) }),
    entry("behind", { projectedAt: at(100) }),
    entry("ahead", { version: 4, projectedAt: at(100) }),
    entry("hidden", { projectedAt: at(100) }),
    entry("merged", { projectedAt: at(100) }),
    entry("hash", { contentHash: "stale", projectedAt: at(100) }),
    entry("old"),
    entry("orphan", { projectedAt: at(100) }),
  ];
  const report = reconcileProjection("search", "search_index", source, entries, {
    now: at(120),
    staleAfterMs: 60 * 60_000,
  });
  const kinds = Object.fromEntries(report.drift.map((d) => [d.id, d.kind]));

  it("classifies every drift kind with a root-cause hint and evidence", () => {
    expect(kinds).toEqual({
      ahead: "version_ahead",
      behind: "version_behind",
      hash: "hash_mismatch",
      hidden: "visibility_mismatch",
      merged: "visibility_mismatch",
      missing: "missing_projection",
      old: "expired",
      orphan: "orphan_projection",
    });
    expect(report.drift.every((d) => d.hint.length > 0)).toBe(true);
    expect(report.drift.find((d) => d.id === "behind")!.evidence).toMatchObject({
      sourceVersion: 3,
      projectedVersion: 1,
    });
  });

  it("is deterministic and scopes cache repairs to prompt keys", () => {
    const again = reconcileProjection("search", "search_index", [...source].reverse(), [...entries].reverse(), {
      now: at(120),
      staleAfterMs: 60 * 60_000,
    });
    expect(again).toEqual(report);
    const cache = reconcileProjection("cache", "cache", [prompt("z", "z")], [], { now: at(0) });
    expect(cache.drift[0].scope).toEqual(["prompts:detail:z", "prompts:metadata:z"]);
  });

  it("does not flag expiry when staleAfterMs is unset", () => {
    const r = reconcileProjection("s", "search_index", [prompt("old", "o")], [entry("old")], { now: at(10_000) });
    expect(r.drift).toEqual([]);
  });

  it("dry-runs by default and never touches the sink", async () => {
    const sink = { upsert: vi.fn(), delete: vi.fn() };
    const res = await repairDrift(report, sink);
    expect(res.dryRun).toBe(true);
    expect(res.applied).toEqual([]);
    expect(sink.upsert).not.toHaveBeenCalled();
    expect(sink.delete).not.toHaveBeenCalled();
    expect(res.queued.map((q) => q.id)).toEqual(["ahead"]);
  });

  it("applies repairs, queues manual/overflow items and isolates failures", async () => {
    const sink = {
      upsert: vi.fn(async (item: { id: string }) => {
        if (item.id === "behind") throw new Error("index unavailable");
      }),
      delete: vi.fn(async () => {}),
    };
    const res = await repairDrift(report, sink, { apply: true, maxRepairs: 5 });
    expect(res.failed).toEqual([{ id: "behind", error: "index unavailable" }]);
    expect(res.applied).toEqual(["hash", "hidden", "merged", "missing"]);
    expect(res.queued.map((q) => q.id)).toEqual(["ahead", "old", "orphan"]);
    expect(sink.delete).toHaveBeenCalledTimes(2); // hidden + merged
  });
});
