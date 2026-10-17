/**
 * Deterministic lifecycle analytics: conversion, drop-off, recovery.
 *
 * Pure: the same events and options always produce byte-identical output (no
 * clock reads, no randomness, stable ordering), so results can be checked
 * against fixtures and re-derived after an incident.
 *
 * Privacy:
 *  - subjects are HMAC-hashed with a server salt at ingest and never appear
 *    in output;
 *  - output is aggregate only (counts, rates, medians); no per-user rows or
 *    timestamps;
 *  - cells with a cohort of 1..k-1 are suppressed (k = minCohort);
 *  - failure reasons come from an allow-list.
 *
 * Docs: docs/lifecycle-analytics.md
 */

import { createHmac } from "crypto";
import {
  LIFECYCLE_WORKFLOW_IDS,
  workflowDef,
  sanitizeFailureReason,
  stageIds,
  stageIndex,
  type LifecycleFailureReason,
  type LifecycleKind,
  type LifecycleWorkflow,
} from "./lifecycleStages";

// ─── Ingest / normalisation ──────────────────────────────────────────────────

export interface RawLifecycleEvent {
  /** Opaque, stable-per-journey id (a random session id, never a wallet). */
  subject: string;
  workflow: string;
  stage: string;
  kind?: string;
  /** Epoch ms, ISO string or Date. */
  at: number | string | Date;
  reason?: string;
}

export interface LifecycleEvent {
  subjectHash: string;
  workflow: LifecycleWorkflow;
  stage: string;
  kind: LifecycleKind;
  at: number;
  reason?: LifecycleFailureReason;
}

export type RejectionReason =
  | "missing_subject"
  | "unknown_workflow"
  | "unknown_stage"
  | "invalid_kind"
  | "invalid_timestamp";

export const MIN_SALT_LENGTH = 16;

export function hashSubject(subject: string, salt: string): string {
  if (salt.length < MIN_SALT_LENGTH) {
    throw new Error(`lifecycle salt must be at least ${MIN_SALT_LENGTH} characters`);
  }
  return createHmac("sha256", salt).update(subject).digest("hex").slice(0, 24);
}

export function normalizeLifecycleEvent(
  raw: RawLifecycleEvent,
  salt: string,
): { ok: true; event: LifecycleEvent } | { ok: false; rejection: RejectionReason } {
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  if (!subject || subject.length > 128) return { ok: false, rejection: "missing_subject" };
  if (!(LIFECYCLE_WORKFLOW_IDS as string[]).includes(raw.workflow)) {
    return { ok: false, rejection: "unknown_workflow" };
  }
  const workflow = raw.workflow as LifecycleWorkflow;
  if (stageIndex(workflow, raw.stage) < 0) return { ok: false, rejection: "unknown_stage" };
  const kind = raw.kind ?? "reached";
  if (kind !== "reached" && kind !== "failed") return { ok: false, rejection: "invalid_kind" };
  const at = raw.at instanceof Date ? raw.at.getTime() : typeof raw.at === "number" ? raw.at : Date.parse(raw.at);
  if (!Number.isFinite(at) || at <= 0) return { ok: false, rejection: "invalid_timestamp" };

  return {
    ok: true,
    event: {
      subjectHash: hashSubject(subject, salt),
      workflow,
      stage: raw.stage,
      kind,
      at,
      ...(kind === "failed" ? { reason: sanitizeFailureReason(raw.reason) } : {}),
    },
  };
}

// ─── Options and output ──────────────────────────────────────────────────────

export interface LifecycleOptions {
  /** Evaluation instant (epoch ms). Required: analysis never reads the clock. */
  asOf: number;
  /** A journey idle this long without completing counts as abandoned. */
  abandonAfterMs?: number;
  /** k-anonymity threshold: counts in 1..k-1 are suppressed. */
  minCohort?: number;
  /** Stages whose drop-off rate meets this are flagged. */
  dropOffThreshold?: number;
  /** Round published counts to a multiple of this (1 = exact). */
  roundTo?: number;
  /** Events later than asOf + this are rejected as clock skew. */
  maxFutureSkewMs?: number;
  /** Restrict analysis to events at or after this instant. */
  since?: number;
}

export const DEFAULT_LIFECYCLE_OPTIONS = {
  abandonAfterMs: 30 * 60 * 1000,
  minCohort: 5,
  dropOffThreshold: 0.25,
  roundTo: 1,
  maxFutureSkewMs: 5 * 60 * 1000,
} as const;

/** A count or rate, or `null` when suppressed by the minimum-cohort rule. */
export type Cell = number | null;

export interface StageMetrics {
  stage: string;
  label: string;
  /** Journeys that reached this stage or went beyond it. */
  reached: Cell;
  /** reached / started. */
  reachedRate: Cell;
  /** reached / previous stage's reached (1 for the first stage). */
  conversionFromPrevious: Cell;
  /** Abandoned journeys whose furthest stage is this one. */
  abandonedHere: Cell;
  /** abandonedHere / reached. */
  dropOffRate: Cell;
  failedAttempts: Cell;
  topFailureReasons: Array<{ reason: LifecycleFailureReason; count: number }>;
  /** Median ms from the previous stage to this one (completers and others). */
  medianMsFromPrevious: Cell;
  suppressed: boolean;
}

export interface WorkflowMetrics {
  workflow: LifecycleWorkflow;
  label: string;
  started: Cell;
  completed: Cell;
  abandoned: Cell;
  inProgress: Cell;
  completionRate: Cell;
  abandonRate: Cell;
  /** Journeys that hit at least one failure. */
  journeysWithFailure: Cell;
  /** Journeys that failed at least once and still completed. */
  recovered: Cell;
  recoveryRate: Cell;
  medianMsToComplete: Cell;
  stages: StageMetrics[];
  /** Stage ids at/above the drop-off threshold, worst first. */
  dropOffStages: string[];
  /** Worst stage by drop-off rate, or null when nothing was abandoned. */
  primaryDropOff: string | null;
  /** Journeys that skipped earlier stages (lost/blocked events). */
  gapJourneys: Cell;
}

export interface LifecycleReport {
  asOf: string;
  params: {
    abandonAfterMs: number;
    minCohort: number;
    dropOffThreshold: number;
    roundTo: number;
  };
  workflows: WorkflowMetrics[];
  quality: {
    accepted: number;
    duplicates: number;
    rejected: Record<string, number>;
  };
}

// ─── Journeys ────────────────────────────────────────────────────────────────

interface Journey {
  events: LifecycleEvent[];
  furthest: number;
  firstAt: number;
  lastAt: number;
  firstReachedAt: Map<number, number>;
  failures: LifecycleEvent[];
  completed: boolean;
  completedAt: number | null;
  /** True if a failure happened before the journey completed. */
  failedBeforeComplete: boolean;
  gap: boolean;
}

function buildJourney(workflow: LifecycleWorkflow, events: LifecycleEvent[]): Journey {
  const last = stageIds(workflow).length - 1;
  const ordered = [...events].sort(
    (a, b) =>
      a.at - b.at ||
      stageIndex(workflow, a.stage) - stageIndex(workflow, b.stage) ||
      (a.kind === b.kind ? 0 : a.kind === "reached" ? -1 : 1),
  );

  let furthest = -1;
  const firstReachedAt = new Map<number, number>();
  const failures: LifecycleEvent[] = [];
  let completedAt: number | null = null;
  const reachedStages = new Set<number>();

  for (const e of ordered) {
    const idx = stageIndex(workflow, e.stage);
    if (e.kind === "reached") {
      reachedStages.add(idx);
      if (!firstReachedAt.has(idx)) firstReachedAt.set(idx, e.at);
      if (idx > furthest) furthest = idx;
      if (idx === last && completedAt === null) completedAt = e.at;
    } else {
      failures.push(e);
    }
  }

  // A failed attempt at stage i proves the user got to stage i-1 (e.g. a
  // payment that succeeded but whose unlock failed is a drop-off *at*
  // payment_confirmed, not a user who never paid).
  for (const f of failures) {
    const implied = stageIndex(workflow, f.stage) - 1;
    if (implied > furthest) furthest = implied;
  }

  let gap = false;
  for (let i = 0; i <= furthest; i++) if (!reachedStages.has(i)) gap = true;

  return {
    events: ordered,
    furthest,
    firstAt: ordered[0].at,
    lastAt: ordered[ordered.length - 1].at,
    firstReachedAt,
    failures,
    completed: completedAt !== null,
    completedAt,
    failedBeforeComplete: failures.some((f) => completedAt === null || f.at <= completedAt),
    gap,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

export function analyzeLifecycle(events: LifecycleEvent[], options: LifecycleOptions): LifecycleReport {
  const abandonAfterMs = options.abandonAfterMs ?? DEFAULT_LIFECYCLE_OPTIONS.abandonAfterMs;
  const minCohort = options.minCohort ?? DEFAULT_LIFECYCLE_OPTIONS.minCohort;
  const dropOffThreshold = options.dropOffThreshold ?? DEFAULT_LIFECYCLE_OPTIONS.dropOffThreshold;
  const roundTo = Math.max(1, options.roundTo ?? DEFAULT_LIFECYCLE_OPTIONS.roundTo);
  const maxSkew = options.maxFutureSkewMs ?? DEFAULT_LIFECYCLE_OPTIONS.maxFutureSkewMs;

  const rejected: Record<string, number> = {};
  const seen = new Set<string>();
  const byJourney = new Map<string, LifecycleEvent[]>();
  let accepted = 0;
  let duplicates = 0;

  for (const e of events) {
    if (options.since !== undefined && e.at < options.since) continue;
    if (e.at > options.asOf + maxSkew) {
      rejected.future_timestamp = (rejected.future_timestamp ?? 0) + 1;
      continue;
    }
    const dedupe = `${e.subjectHash}|${e.workflow}|${e.stage}|${e.kind}|${e.at}|${e.reason ?? ""}`;
    if (seen.has(dedupe)) {
      duplicates++;
      continue;
    }
    seen.add(dedupe);
    accepted++;
    const key = `${e.workflow}|${e.subjectHash}`;
    const list = byJourney.get(key);
    if (list) list.push(e);
    else byJourney.set(key, [e]);
  }

  // Count as k-anonymised, optionally rounded.
  const publish = (n: number): Cell => {
    if (n > 0 && n < minCohort) return null;
    return roundTo > 1 ? Math.round(n / roundTo) * roundTo : n;
  };
  // Rates come from the *published* counts, so rounding/suppression cannot be
  // undone by dividing; null if either side is suppressed.
  const safeRate = (num: number, den: number): Cell => {
    const n = publish(num);
    const d = publish(den);
    return n === null || d === null ? null : rate(n, d);
  };

  const workflows: WorkflowMetrics[] = LIFECYCLE_WORKFLOW_IDS.map((workflow) => {
    const def = workflowDef(workflow);
    const ids = stageIds(workflow);
    const journeys = [...byJourney.entries()]
      .filter(([key]) => key.startsWith(`${workflow}|`))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, list]) => buildJourney(workflow, list));

    const started = journeys.length;
    const completed = journeys.filter((j) => j.completed).length;
    const abandoned = journeys.filter((j) => !j.completed && options.asOf - j.lastAt >= abandonAfterMs).length;
    const inProgress = started - completed - abandoned;
    const withFailure = journeys.filter((j) => j.failures.length > 0);
    const recovered = withFailure.filter((j) => j.completed && j.failedBeforeComplete).length;

    const stages: StageMetrics[] = ids.map((stage, i) => {
      const reachedJ = journeys.filter((j) => j.furthest >= i);
      const prevReached = i === 0 ? started : journeys.filter((j) => j.furthest >= i - 1).length;
      const abandonedHere = journeys.filter(
        (j) => !j.completed && j.furthest === i && options.asOf - j.lastAt >= abandonAfterMs,
      ).length;

      const stageFailures = journeys.flatMap((j) => j.failures.filter((f) => f.stage === stage));
      const reasonCounts = new Map<LifecycleFailureReason, number>();
      for (const f of stageFailures) {
        const r = f.reason ?? "other";
        reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
      }
      // Reasons below k fold into "other" so rare reasons cannot single out a user.
      let otherFolded = 0;
      const reasons: Array<{ reason: LifecycleFailureReason; count: number }> = [];
      for (const [reason, count] of reasonCounts) {
        if (count < minCohort) otherFolded += count;
        else reasons.push({ reason, count: publish(count) as number });
      }
      if (otherFolded >= minCohort) {
        const existing = reasons.find((r) => r.reason === "other");
        if (existing) existing.count += publish(otherFolded) as number;
        else reasons.push({ reason: "other", count: publish(otherFolded) as number });
      }
      reasons.sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));

      const deltas: number[] = [];
      if (i > 0) {
        for (const j of journeys) {
          const here = j.firstReachedAt.get(i);
          const before = j.firstReachedAt.get(i - 1);
          if (here !== undefined && before !== undefined && here >= before) deltas.push(here - before);
        }
      }
      const medianDelta = deltas.length >= minCohort ? median(deltas) : null;
      const suppressed = reachedJ.length > 0 && reachedJ.length < minCohort;

      return {
        stage,
        label: def.stages[i].label,
        reached: publish(reachedJ.length),
        reachedRate: safeRate(reachedJ.length, started),
        conversionFromPrevious: i === 0 ? safeRate(reachedJ.length, started) : safeRate(reachedJ.length, prevReached),
        abandonedHere: publish(abandonedHere),
        dropOffRate: safeRate(abandonedHere, reachedJ.length),
        failedAttempts: publish(stageFailures.length),
        topFailureReasons: reasons.slice(0, 3),
        medianMsFromPrevious: medianDelta,
        suppressed,
      };
    });

    const flagged = stages
      .filter((s) => s.dropOffRate !== null && s.dropOffRate >= dropOffThreshold && (s.abandonedHere ?? 0) > 0)
      .sort((a, b) => (b.dropOffRate as number) - (a.dropOffRate as number) || ids.indexOf(a.stage) - ids.indexOf(b.stage));
    const abandonedStages = stages
      .filter((s) => s.dropOffRate !== null && (s.abandonedHere ?? 0) > 0)
      .sort((a, b) => (b.dropOffRate as number) - (a.dropOffRate as number) || ids.indexOf(a.stage) - ids.indexOf(b.stage));

    const completionTimes = journeys.filter((j) => j.completedAt !== null).map((j) => (j.completedAt as number) - j.firstAt);

    return {
      workflow,
      label: def.label,
      started: publish(started),
      completed: publish(completed),
      abandoned: publish(abandoned),
      inProgress: publish(inProgress),
      completionRate: safeRate(completed, started),
      abandonRate: safeRate(abandoned, started),
      journeysWithFailure: publish(withFailure.length),
      recovered: publish(recovered),
      recoveryRate: safeRate(recovered, withFailure.length),
      medianMsToComplete: completionTimes.length >= minCohort ? median(completionTimes) : null,
      stages,
      dropOffStages: flagged.map((s) => s.stage),
      primaryDropOff: abandonedStages[0]?.stage ?? null,
      gapJourneys: publish(journeys.filter((j) => j.gap).length),
    };
  });

  return {
    asOf: new Date(options.asOf).toISOString(),
    params: { abandonAfterMs, minCohort, dropOffThreshold, roundTo },
    workflows,
    quality: { accepted, duplicates, rejected },
  };
}

/** Normalise a batch, tally rejections, and analyse. */
export function analyzeRawLifecycleEvents(
  raw: RawLifecycleEvent[],
  salt: string,
  options: LifecycleOptions,
): LifecycleReport {
  const events: LifecycleEvent[] = [];
  const rejected: Record<string, number> = {};
  for (const r of raw) {
    const result = normalizeLifecycleEvent(r, salt);
    if (result.ok) events.push(result.event);
    else rejected[result.rejection] = (rejected[result.rejection] ?? 0) + 1;
  }
  const report = analyzeLifecycle(events, options);
  for (const [k, v] of Object.entries(rejected)) {
    report.quality.rejected[k] = (report.quality.rejected[k] ?? 0) + v;
  }
  return report;
}
