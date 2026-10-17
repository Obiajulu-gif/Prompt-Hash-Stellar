/**
 * Projection Integrity (Issues #985, #987, #1001)
 *
 *  - Deterministic duplicate detection + reviewable, reversible, hash-chained
 *    merge workflow (#985).
 *  - Reconciliation of source-of-truth prompt state against derived
 *    projections (search index, read caches) with root-cause hints and a
 *    dry-run-first repair (#987).
 *  - Stale-cache / stale-index detection with scoped, evidence-carrying repair
 *    recommendations; anything not safe to auto-repair is queued (#1001).
 *
 * Everything here is pure over injected data so it can run from a job, a
 * script, or a test without a database. Callers persist the returned objects.
 * Operational notes: docs/projection-integrity.md
 */

import { createHash } from "crypto";
import { canonicalJson, computeRecordHash, AUDIT_INTEGRITY_VERSION } from "./auditTrail";
import { computeSimilarityScore, SIMILARITY_THRESHOLDS } from "./similarityDetection";
import { cacheDel, CACHE_KEYS } from "./cacheService";

const GENESIS_HASH = "0".repeat(64);

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface PromptSnapshot {
  id: string;
  content: string;
  /** Stored content hash; derived from normalized content when absent. */
  contentHash?: string | null;
  version: number;
  updatedAt: Date;
  visible: boolean;
  /** Set when this listing has been merged into another (alias, not deletion). */
  mergedInto?: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}

function effectiveHash(p: PromptSnapshot): string {
  return p.contentHash || sha256(normalizeContent(p.content));
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---------------------------------------------------------------------------
// #985 Duplicate detection
// ---------------------------------------------------------------------------

export type DuplicateReason = "exact_hash" | "near_text";

export interface DuplicateCandidate {
  /** Stable id: same pair + reason always yields the same candidate id. */
  candidateId: string;
  primaryId: string;
  duplicateId: string;
  reason: DuplicateReason;
  score: number;
}

/**
 * Detect duplicate candidates reproducibly: input order never affects output.
 * The primary is the lexicographically smallest id in a pair so re-runs agree.
 * Prompts already merged away are ignored.
 */
export function detectDuplicateCandidates(
  prompts: PromptSnapshot[],
  options: { threshold?: number } = {},
): DuplicateCandidate[] {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLDS.HIGHLY_SIMILAR;
  const live = prompts.filter((p) => !p.mergedInto).sort(byId);
  const candidates: DuplicateCandidate[] = [];

  // ponytail: O(n²) pairwise scan, fine for per-creator/per-category batches;
  // bucket by MinHash/LSH before calling this on the full catalog.
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      let reason: DuplicateReason | null = null;
      let score = 1;
      if (effectiveHash(a) === effectiveHash(b)) {
        reason = "exact_hash";
      } else {
        score = Math.round(computeSimilarityScore(a.content, b.content) * 10_000) / 10_000;
        if (score >= threshold) reason = "near_text";
      }
      if (!reason) continue;
      candidates.push({
        candidateId: sha256(`${a.id}|${b.id}|${reason}`).slice(0, 24),
        primaryId: a.id,
        duplicateId: b.id,
        reason,
        score,
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// #985 Merge review workflow
// ---------------------------------------------------------------------------

export type MergeStatus = "proposed" | "approved" | "rejected" | "applied" | "reverted";

export interface MergeAuditEntry {
  action: "propose" | "approve" | "reject" | "apply" | "revert";
  actor: string;
  at: string;
  from: MergeStatus | null;
  to: MergeStatus;
  reason: string | null;
  beforeState: unknown;
  afterState: unknown;
  previousHash: string;
  hash: string;
}

export interface MergeProposal {
  id: string;
  primaryId: string;
  duplicateId: string;
  /** Duplicate's version at proposal time; apply refuses if it changed. */
  duplicateVersion: number;
  status: MergeStatus;
  proposedBy: string;
  history: MergeAuditEntry[];
}

export class MergeWorkflowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MergeWorkflowError";
  }
}

function appendAudit(
  proposal: MergeProposal,
  entry: Omit<MergeAuditEntry, "previousHash" | "hash" | "from" | "to"> & { to: MergeStatus },
): MergeProposal {
  const previousHash = proposal.history.at(-1)?.hash ?? GENESIS_HASH;
  const from = proposal.history.length ? proposal.status : null;
  const hash = computeRecordHash({
    action: `merge_${entry.action}`,
    // Status lives in `result` so a rewritten transition breaks the hash.
    result: entry.to,
    promptId: proposal.duplicateId,
    walletAddress: null,
    actor: entry.actor,
    target: proposal.id,
    targetType: "prompt_merge",
    beforeState: entry.beforeState,
    afterState: entry.afterState,
    requestId: null,
    reason: entry.reason,
    createdAt: new Date(entry.at),
    previousHash,
    integrityVersion: AUDIT_INTEGRITY_VERSION,
  });
  return {
    ...proposal,
    status: entry.to,
    history: [...proposal.history, { ...entry, from, previousHash, hash }],
  };
}

function requireStatus(p: MergeProposal, allowed: MergeStatus[]): void {
  if (!allowed.includes(p.status)) {
    throw new MergeWorkflowError(
      "INVALID_TRANSITION",
      `Merge ${p.id} is ${p.status}; expected ${allowed.join(" or ")}`,
    );
  }
}

export function proposeMerge(
  candidate: DuplicateCandidate,
  duplicate: PromptSnapshot,
  actor: string,
  now: Date,
): MergeProposal {
  if (duplicate.id !== candidate.duplicateId) {
    throw new MergeWorkflowError("SNAPSHOT_MISMATCH", "Duplicate snapshot does not match candidate");
  }
  const base: MergeProposal = {
    id: candidate.candidateId,
    primaryId: candidate.primaryId,
    duplicateId: candidate.duplicateId,
    duplicateVersion: duplicate.version,
    status: "proposed",
    proposedBy: actor,
    history: [],
  };
  return appendAudit(base, {
    action: "propose",
    actor,
    at: now.toISOString(),
    to: "proposed",
    reason: `${candidate.reason} score=${candidate.score}`,
    beforeState: null,
    afterState: { primaryId: candidate.primaryId, duplicateId: candidate.duplicateId },
  });
}

/** Four-eyes review: the proposer can never approve their own merge. */
export function reviewMerge(
  proposal: MergeProposal,
  reviewer: string,
  decision: "approve" | "reject",
  reason: string,
  now: Date,
): MergeProposal {
  requireStatus(proposal, ["proposed"]);
  if (reviewer === proposal.proposedBy) {
    throw new MergeWorkflowError("SELF_REVIEW", "Proposer cannot review their own merge");
  }
  if (!reason.trim()) throw new MergeWorkflowError("REASON_REQUIRED", "Review reason is required");
  return appendAudit(proposal, {
    action: decision,
    actor: reviewer,
    at: now.toISOString(),
    to: decision === "approve" ? "approved" : "rejected",
    reason,
    beforeState: null,
    afterState: null,
  });
}

/**
 * Apply an approved merge: the duplicate becomes a hidden alias of the
 * primary. Entitlements, purchases and on-chain records are NOT moved — that
 * is what keeps revert safe.
 */
export function applyMerge(
  proposal: MergeProposal,
  duplicate: PromptSnapshot,
  actor: string,
  now: Date,
): { proposal: MergeProposal; duplicate: PromptSnapshot } {
  requireStatus(proposal, ["approved"]);
  if (duplicate.id !== proposal.duplicateId) {
    throw new MergeWorkflowError("SNAPSHOT_MISMATCH", "Duplicate snapshot does not match proposal");
  }
  if (duplicate.version !== proposal.duplicateVersion) {
    throw new MergeWorkflowError(
      "STALE_PROPOSAL",
      `Duplicate changed since proposal (v${proposal.duplicateVersion} → v${duplicate.version}); re-propose`,
    );
  }
  if (duplicate.mergedInto) {
    throw new MergeWorkflowError("ALREADY_MERGED", `Duplicate already merged into ${duplicate.mergedInto}`);
  }
  const before = { visible: duplicate.visible, mergedInto: null };
  const after = { visible: false, mergedInto: proposal.primaryId };
  const updated: PromptSnapshot = {
    ...duplicate,
    ...after,
    version: duplicate.version + 1,
    updatedAt: now,
  };
  return {
    duplicate: updated,
    proposal: appendAudit(proposal, {
      action: "apply",
      actor,
      at: now.toISOString(),
      to: "applied",
      reason: null,
      beforeState: before,
      afterState: after,
    }),
  };
}

/** Restore the duplicate to the exact state captured by the apply entry. */
export function revertMerge(
  proposal: MergeProposal,
  duplicate: PromptSnapshot,
  actor: string,
  reason: string,
  now: Date,
): { proposal: MergeProposal; duplicate: PromptSnapshot } {
  requireStatus(proposal, ["applied"]);
  if (!reason.trim()) throw new MergeWorkflowError("REASON_REQUIRED", "Revert reason is required");
  if (duplicate.mergedInto !== proposal.primaryId) {
    throw new MergeWorkflowError(
      "NOT_REVERSIBLE",
      "Duplicate no longer points at the primary; resolve manually (see docs/projection-integrity.md)",
    );
  }
  const applied = [...proposal.history].reverse().find((e) => e.action === "apply");
  const restore = applied!.beforeState as { visible: boolean; mergedInto: null };
  const updated: PromptSnapshot = {
    ...duplicate,
    ...restore,
    version: duplicate.version + 1,
    updatedAt: now,
  };
  return {
    duplicate: updated,
    proposal: appendAudit(proposal, {
      action: "revert",
      actor,
      at: now.toISOString(),
      to: "reverted",
      reason,
      beforeState: { visible: duplicate.visible, mergedInto: duplicate.mergedInto },
      afterState: restore,
    }),
  };
}

/**
 * Recompute the chain; returns the index of the first tampered entry, the
 * history length if only `status` disagrees with the last entry, or -1.
 */
export function verifyMergeHistory(proposal: MergeProposal): number {
  let replay: MergeProposal = { ...proposal, status: "proposed", history: [] };
  for (let i = 0; i < proposal.history.length; i++) {
    const e = proposal.history[i];
    const { previousHash: _p, hash: _h, from: _f, ...rest } = e;
    replay = appendAudit(replay, rest);
    if (canonicalJson(replay.history[i]) !== canonicalJson(e)) return i;
  }
  return proposal.status === replay.status ? -1 : proposal.history.length;
}

// ---------------------------------------------------------------------------
// #987 / #1001 Reconciliation + stale detection
// ---------------------------------------------------------------------------

export type ProjectionKind = "search_index" | "cache";

export interface ProjectionEntry {
  id: string;
  version: number;
  contentHash?: string | null;
  visible: boolean;
  projectedAt: Date;
}

export type DriftKind =
  | "missing_projection"
  | "orphan_projection"
  | "version_behind"
  | "version_ahead"
  | "hash_mismatch"
  | "visibility_mismatch"
  | "expired";

export type RepairAction = "upsert" | "delete" | "manual";

export interface DriftItem {
  id: string;
  kind: DriftKind;
  hint: string;
  repair: RepairAction;
  /** Scope a repair touches, e.g. cache keys for a cache projection. */
  scope: string[];
  evidence: {
    sourceVersion: number | null;
    projectedVersion: number | null;
    sourceUpdatedAt: string | null;
    projectedAt: string | null;
  };
}

export interface DriftReport {
  projection: string;
  kind: ProjectionKind;
  generatedAt: string;
  sourceCount: number;
  projectionCount: number;
  drift: DriftItem[];
}

const HINTS: Record<DriftKind, string> = {
  missing_projection:
    "Projection writer never saw the create/publish event — check indexer lag and the webhook outbox dead-letter queue.",
  orphan_projection:
    "Source record was deleted or merged without projection cleanup — check merge/delete handlers call invalidatePromptCaches.",
  version_behind: "Missed or reordered update event — projection lags source.",
  version_ahead:
    "Projection is newer than source: source was restored/rolled back or the projection was written from another environment. Never auto-repaired.",
  hash_mismatch:
    "Same version, different content hash — partial write or non-canonical serialization in the projection writer.",
  visibility_mismatch: "Visibility change (unlist/merge/moderation) was not propagated to the projection.",
  expired: "Entry outlived its freshness budget without being refreshed — TTL misconfigured or refresh job stalled.",
};

function scopeFor(kind: ProjectionKind, id: string): string[] {
  return kind === "cache"
    ? [CACHE_KEYS.promptDetail(id), CACHE_KEYS.promptMetadata(id)]
    : [`search_index:${id}`];
}

/**
 * Compare source-of-truth snapshots with a projection. Only the first
 * (most severe) drift per id is reported so repairs never conflict.
 * `staleAfterMs` turns time-based staleness on (#1001).
 */
export function reconcileProjection(
  projection: string,
  kind: ProjectionKind,
  source: PromptSnapshot[],
  entries: ProjectionEntry[],
  options: { now: Date; staleAfterMs?: number },
): DriftReport {
  const src = new Map(source.map((s) => [s.id, s]));
  const proj = new Map(entries.map((e) => [e.id, e]));
  const ids = [...new Set([...src.keys(), ...proj.keys()])].sort();
  const drift: DriftItem[] = [];

  for (const id of ids) {
    const s = src.get(id);
    const p = proj.get(id);
    const shouldProject = !!s && s.visible && !s.mergedInto;
    let kindFound: DriftKind | null = null;
    let repair: RepairAction = "upsert";

    if (!p) {
      if (shouldProject) kindFound = "missing_projection";
    } else if (!s) {
      kindFound = "orphan_projection";
      repair = "delete";
    } else if (p.version > s.version) {
      kindFound = "version_ahead";
      repair = "manual";
    } else if (shouldProject !== p.visible) {
      kindFound = "visibility_mismatch";
      repair = shouldProject ? "upsert" : "delete";
    } else if (p.version < s.version) {
      kindFound = "version_behind";
    } else if (p.contentHash && p.contentHash !== effectiveHash(s)) {
      kindFound = "hash_mismatch";
    } else if (
      options.staleAfterMs !== undefined &&
      options.now.getTime() - p.projectedAt.getTime() > options.staleAfterMs
    ) {
      kindFound = "expired";
    }

    if (!kindFound) continue;
    drift.push({
      id,
      kind: kindFound,
      hint: HINTS[kindFound],
      repair,
      scope: scopeFor(kind, id),
      evidence: {
        sourceVersion: s?.version ?? null,
        projectedVersion: p?.version ?? null,
        sourceUpdatedAt: s?.updatedAt.toISOString() ?? null,
        projectedAt: p?.projectedAt.toISOString() ?? null,
      },
    });
  }

  return {
    projection,
    kind,
    generatedAt: options.now.toISOString(),
    sourceCount: source.length,
    projectionCount: entries.length,
    drift,
  };
}

export interface ProjectionRepairSink {
  upsert(item: DriftItem): Promise<void>;
  delete(item: DriftItem): Promise<void>;
}

export interface RepairResult {
  dryRun: boolean;
  planned: DriftItem[];
  applied: string[];
  queued: { id: string; reason: string }[];
  failed: { id: string; error: string }[];
}

/**
 * Dry-run by default. With `apply: true`, at most `maxRepairs` items are
 * repaired (blast-radius cap); manual items and overflow are queued for an
 * operator. One failing repair never aborts the rest.
 */
export async function repairDrift(
  report: DriftReport,
  sink: ProjectionRepairSink,
  options: { apply?: boolean; maxRepairs?: number } = {},
): Promise<RepairResult> {
  const maxRepairs = options.maxRepairs ?? 50;
  const result: RepairResult = {
    dryRun: !options.apply,
    planned: report.drift,
    applied: [],
    queued: [],
    failed: [],
  };
  let budget = maxRepairs;
  for (const item of report.drift) {
    if (item.repair === "manual") {
      result.queued.push({ id: item.id, reason: item.hint });
    } else if (budget <= 0) {
      result.queued.push({ id: item.id, reason: `repair budget (${maxRepairs}) exhausted` });
    } else {
      budget--;
      if (!options.apply) continue;
      try {
        await (item.repair === "delete" ? sink.delete(item) : sink.upsert(item));
        result.applied.push(item.id);
      } catch (err) {
        result.failed.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return result;
}

/**
 * Cache sink: both repairs are an invalidation — the next read repopulates
 * from source, so it is always safe and idempotent.
 */
export const cacheRepairSink: ProjectionRepairSink = {
  upsert: (item) => cacheDel(...item.scope),
  delete: (item) => cacheDel(...item.scope),
};
