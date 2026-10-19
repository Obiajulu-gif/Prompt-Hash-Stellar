/**
 * Operator-safe backfill engine (#966).
 *
 * Walks a collection in `_id` order, asks a job what each record should look
 * like, and writes only the changes. It is built for operators:
 *   - dry-run is the default for the CLI, and a dry run reports every diff
 *     without writing anything or touching the checkpoint;
 *   - progress is checkpointed after every batch, so an interrupted run resumes
 *     from the last committed batch rather than starting over;
 *   - one bad record is recorded as a failure and does not stop the run;
 *   - `maxRecords` lets an operator stage a large backfill in pieces.
 *
 * Correctness rule for jobs: `plan` must depend only on the record's current
 * state, and returns `skip` once that state already matches the target. That is
 * what makes replaying a batch safe when a crash lands between `apply` and the
 * checkpoint save.
 *
 * Failure modes and recovery are documented in
 * docs/operations/stellar-wave-integrity-hardening.md.
 */

import { promises as fs } from "fs";
import path from "path";

export interface BackfillRecord {
  id: string;
  data: Record<string, unknown>;
}

export type BackfillPlan =
  | { kind: "update"; changes: Record<string, unknown> }
  | { kind: "skip"; reason: string };

export interface BackfillJob {
  name: string;
  /** Returns up to `limit` records with `id` strictly after `after` (null = start). */
  fetchPage(after: string | null, limit: number): Promise<BackfillRecord[]>;
  /** Decides the change for one record. Must not perform I/O. */
  plan(record: BackfillRecord): BackfillPlan;
  /** Writes exactly `changes` to the record. */
  apply(record: BackfillRecord, changes: Record<string, unknown>): Promise<void>;
}

export interface BackfillCheckpoint {
  job: string;
  /** Last record id whose batch has been fully applied; null before the first batch. */
  cursor: string | null;
  /** Records written across all runs of this job. */
  appliedTotal: number;
  complete: boolean;
  updatedAt: string;
}

export interface CheckpointStore {
  load(): Promise<BackfillCheckpoint | null>;
  save(checkpoint: BackfillCheckpoint): Promise<void>;
}

export interface DiffEntry {
  id: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

export interface BackfillFailure {
  id: string;
  error: string;
}

export interface BackfillOptions {
  /** Default true. When true nothing is written and the checkpoint is left alone. */
  dryRun?: boolean;
  /** Records fetched per page. Default 100. */
  batchSize?: number;
  /** Stop after scanning this many records in this run. */
  maxRecords?: number;
  /** Ignore any existing checkpoint and start from the first record. */
  restart?: boolean;
  /** Maximum number of diffs kept in the report. Default 200. */
  diffLimit?: number;
}

export interface BackfillReport {
  job: string;
  dryRun: boolean;
  resumedFrom: string | null;
  scanned: number;
  planned: number;
  applied: number;
  skipped: number;
  failed: number;
  diffs: DiffEntry[];
  diffsTruncated: boolean;
  failures: BackfillFailure[];
  complete: boolean;
  cursor: string | null;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function diffOf(record: BackfillRecord, changes: Record<string, unknown>): DiffEntry["changes"] {
  const out: DiffEntry["changes"] = {};
  for (const [key, after] of Object.entries(changes)) {
    out[key] = { before: record.data[key], after };
  }
  return out;
}

/**
 * Runs `job` against `store`. Resolves with a report; rejects only when the
 * checkpoint cannot be read or written, or when the checkpoint belongs to a
 * different job.
 */
export async function runBackfill(
  job: BackfillJob,
  store: CheckpointStore,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const dryRun = options.dryRun ?? true;
  const batchSize = Math.max(1, options.batchSize ?? 100);
  const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
  const diffLimit = options.diffLimit ?? 200;

  const previous = options.restart ? null : await store.load();
  if (previous && previous.job !== job.name) {
    throw new Error(
      `Checkpoint belongs to job "${previous.job}", not "${job.name}". Pass restart to discard it.`,
    );
  }

  const resumedFrom = previous?.cursor ?? null;
  let cursor = resumedFrom;
  let appliedTotal = previous?.appliedTotal ?? 0;
  const report: BackfillReport = {
    job: job.name,
    dryRun,
    resumedFrom,
    scanned: 0,
    planned: 0,
    applied: 0,
    skipped: 0,
    failed: 0,
    diffs: [],
    diffsTruncated: false,
    failures: [],
    complete: false,
    cursor,
  };

  while (report.scanned < maxRecords) {
    const limit = Math.min(batchSize, maxRecords - report.scanned);
    const page = await job.fetchPage(cursor, limit);
    if (page.length === 0) {
      report.complete = true;
      break;
    }

    for (const record of page) {
      report.scanned += 1;
      let plan: BackfillPlan;
      try {
        plan = job.plan(record);
      } catch (err) {
        report.failed += 1;
        report.failures.push({ id: record.id, error: describeError(err) });
        continue;
      }

      if (plan.kind === "skip") {
        report.skipped += 1;
        continue;
      }

      report.planned += 1;
      if (dryRun) {
        if (report.diffs.length < diffLimit) {
          report.diffs.push({ id: record.id, changes: diffOf(record, plan.changes) });
        } else {
          report.diffsTruncated = true;
        }
        continue;
      }

      try {
        await job.apply(record, plan.changes);
        report.applied += 1;
        appliedTotal += 1;
      } catch (err) {
        report.failed += 1;
        report.failures.push({ id: record.id, error: describeError(err) });
      }
    }

    cursor = page[page.length - 1].id;
    report.cursor = cursor;

    if (page.length < limit) {
      report.complete = true;
      break;
    }

    if (!dryRun) {
      await store.save({
        job: job.name,
        cursor,
        appliedTotal,
        complete: false,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (!dryRun && report.complete) {
    await store.save({
      job: job.name,
      cursor,
      appliedTotal,
      complete: true,
      updatedAt: new Date().toISOString(),
    });
  }

  return report;
}

/** In-memory checkpoint store for tests and dry runs. */
export function memoryCheckpointStore(initial: BackfillCheckpoint | null = null): CheckpointStore {
  let current = initial;
  return {
    async load() {
      return current;
    },
    async save(checkpoint) {
      current = checkpoint;
    },
  };
}

/**
 * JSON checkpoint file. Writes go to a temp file that is renamed over the
 * target, so a crash mid-write leaves the previous checkpoint intact.
 */
export function fileCheckpointStore(filePath: string): CheckpointStore {
  return {
    async load() {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw) as BackfillCheckpoint;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async save(checkpoint) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(checkpoint, null, 2)}\n`);
      await fs.rename(tmp, filePath);
    },
  };
}
