/**
 * Granular retention holds for disputes and investigations.
 *
 * A hold links specific records (webhook events, quarantined events, export
 * jobs, support evidence) to a case. While any active hold covers a record,
 * retention cleanup skips it. Releasing a hold returns the record to normal
 * retention only when no other active hold still covers it.
 *
 * Protection is layered so a single failure cannot expose a held record:
 *   1. the ledger (`RetentionHold`) is read by cleanup and held ids are
 *      excluded from the candidate filter;
 *   2. each record also carries `retentionHold: true`, which the cleanup
 *      update filter re-checks at archive time (closes the race with a hold
 *      placed mid-run). Flags are written BEFORE the ledger document so the
 *      window where a ledger hold exists without flags never opens.
 *   3. cleanup fails closed: if the ledger cannot be read the run aborts.
 *
 * Flags set by this service carry a marker reason, so releasing a hold never
 * clears a flag that an operator set manually.
 *
 * All I/O goes through `RetentionHoldDeps`, so the logic is unit-testable
 * without a database. Runbook: docs/retention-holds.md
 */

import type { Model } from "mongoose";
import InboundWebhookEvent from "../models/InboundWebhookEvent";
import QuarantinedEvent from "../models/QuarantinedEvent";
import JobRecord from "../models/JobRecord";
import Report from "../models/Report";
import RetentionHold, {
  HOLD_CASE_TYPES,
  HOLDABLE_COLLECTIONS,
  type HoldCaseType,
  type HoldableCollection,
  type RetentionHoldLink,
} from "../models/RetentionHold";
import { recordAuditEvent, type AuditEventParams } from "./auditTrail";

export { HOLD_CASE_TYPES, HOLDABLE_COLLECTIONS };
export type { HoldCaseType, HoldableCollection, RetentionHoldLink };

/** Reason written on flags owned by the ledger; manual flags use anything else. */
export const MANAGED_FLAG_REASON = "retention-hold-ledger";

export const DEFAULT_REVIEW_DAYS = 90;
export const MAX_REVIEW_DAYS = 365;
export const MAX_LINKS_PER_HOLD = 500;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionHoldRecord {
  id: string;
  caseType: HoldCaseType;
  caseRef: string;
  reason: string;
  status: "active" | "released";
  links: RetentionHoldLink[];
  alreadyArchived: string[];
  createdBy: string;
  createdAt: Date;
  reviewBy: Date;
  releasedBy: string | null;
  releasedAt: Date | null;
  releaseReason: string | null;
}

export interface TargetRecordState {
  id: string;
  retentionHold: boolean;
  archivedAt: Date | null;
}

export interface HoldTargetStore {
  findByIds(ids: string[]): Promise<TargetRecordState[]>;
  /** Flag records not already flagged. Returns how many were flagged. */
  flagManaged(ids: string[]): Promise<number>;
  /** Clear flags that carry the managed marker only. */
  unflagManaged(ids: string[]): Promise<number>;
  /** Ids currently carrying a managed flag (bounded). */
  listManagedFlagged(limit: number): Promise<string[]>;
}

export interface HoldStore {
  insert(doc: Omit<RetentionHoldRecord, "id" | "createdAt">): Promise<RetentionHoldRecord>;
  get(id: string): Promise<RetentionHoldRecord | null>;
  list(filter: { status?: "active" | "released"; caseRef?: string }): Promise<RetentionHoldRecord[]>;
  /** Atomically move active → released. Null when not active. */
  release(
    id: string,
    patch: { releasedBy: string; releaseReason: string; releasedAt: Date },
  ): Promise<RetentionHoldRecord | null>;
}

export interface RetentionHoldDeps {
  holds: HoldStore;
  targets: Record<HoldableCollection, HoldTargetStore>;
  findReportIdsForPrompt(promptId: string): Promise<string[]>;
  audit(params: AuditEventParams): Promise<void>;
  now(): Date;
}

export class RetentionHoldError extends Error {
  constructor(
    public readonly code:
      | "invalid_request"
      | "record_not_found"
      | "hold_not_found"
      | "already_released"
      | "ledger_unavailable",
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = "RetentionHoldError";
  }
}

// ─── Validation (pure) ───────────────────────────────────────────────────────

export interface PlaceHoldInput {
  caseType: string;
  caseRef: string;
  reason: string;
  actor: string;
  links?: Array<{ collection: string; recordId: string }>;
  /** When set, also holds every Report filed against this prompt. */
  includePromptReportsFor?: string;
  reviewDays?: number;
}

export interface ValidatedHold {
  caseType: HoldCaseType;
  caseRef: string;
  reason: string;
  actor: string;
  links: RetentionHoldLink[];
  includePromptReportsFor?: string;
  reviewDays: number;
}

export function validateHoldRequest(
  input: PlaceHoldInput,
): { ok: true; value: ValidatedHold } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!(HOLD_CASE_TYPES as readonly string[]).includes(input.caseType)) {
    errors.push(`caseType must be one of: ${HOLD_CASE_TYPES.join(", ")}`);
  }
  const caseRef = (input.caseRef ?? "").trim();
  if (!caseRef || caseRef.length > 200) errors.push("caseRef is required (max 200 chars)");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 10 || reason.length > 500) {
    errors.push("reason must be 10-500 characters describing why the hold is needed");
  }
  const actor = (input.actor ?? "").trim();
  if (!actor) errors.push("actor is required");

  const reviewDays = input.reviewDays ?? DEFAULT_REVIEW_DAYS;
  if (!Number.isInteger(reviewDays) || reviewDays < 1 || reviewDays > MAX_REVIEW_DAYS) {
    errors.push(`reviewDays must be an integer between 1 and ${MAX_REVIEW_DAYS}`);
  }

  const seen = new Set<string>();
  const links: RetentionHoldLink[] = [];
  for (const link of input.links ?? []) {
    if (!(HOLDABLE_COLLECTIONS as readonly string[]).includes(link?.collection)) {
      errors.push(
        `links: "${link?.collection}" is not holdable (allowed: ${HOLDABLE_COLLECTIONS.join(", ")}); other collections are never archived`,
      );
      continue;
    }
    if (!OBJECT_ID.test(String(link.recordId))) {
      errors.push(`links: "${link.recordId}" is not a valid record id`);
      continue;
    }
    const key = `${link.collection}:${String(link.recordId).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ collection: link.collection as HoldableCollection, recordId: String(link.recordId).toLowerCase() });
  }

  const promptId = input.includePromptReportsFor?.trim();
  if (links.length === 0 && !promptId) {
    errors.push("at least one link (or includePromptReportsFor) is required");
  }
  if (links.length > MAX_LINKS_PER_HOLD) {
    errors.push(`a hold may link at most ${MAX_LINKS_PER_HOLD} records`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      caseType: input.caseType as HoldCaseType,
      caseRef,
      reason,
      actor,
      links,
      includePromptReportsFor: promptId || undefined,
      reviewDays,
    },
  };
}

function groupByCollection(links: RetentionHoldLink[]): Map<HoldableCollection, string[]> {
  const grouped = new Map<HoldableCollection, string[]>();
  for (const link of links) {
    const ids = grouped.get(link.collection) ?? [];
    ids.push(link.recordId);
    grouped.set(link.collection, ids);
  }
  return grouped;
}

function sameLinkSet(a: RetentionHoldLink[], b: RetentionHoldLink[]): boolean {
  const key = (l: RetentionHoldLink) => `${l.collection}:${l.recordId}`;
  const left = new Set(a.map(key));
  return left.size === b.length && b.every((l) => left.has(key(l)));
}

// ─── Place ───────────────────────────────────────────────────────────────────

export interface PlaceHoldResult {
  hold: RetentionHoldRecord;
  /** False when an identical active hold already existed (idempotent retry). */
  created: boolean;
  /** Linked records that were already archived; their data is already scrubbed. */
  alreadyArchived: string[];
}

export async function placeHold(
  input: PlaceHoldInput,
  deps: RetentionHoldDeps = defaultDeps(),
): Promise<PlaceHoldResult> {
  const checked = validateHoldRequest(input);
  if (!checked.ok) {
    throw new RetentionHoldError("invalid_request", "Invalid retention hold request.", checked.errors);
  }
  const req = checked.value;

  let links = [...req.links];
  if (req.includePromptReportsFor) {
    const reportIds = await deps.findReportIdsForPrompt(req.includePromptReportsFor);
    const have = new Set(links.map((l) => `${l.collection}:${l.recordId}`));
    for (const id of reportIds) {
      const lowered = String(id).toLowerCase();
      if (!have.has(`supportEvidence:${lowered}`)) {
        links.push({ collection: "supportEvidence", recordId: lowered });
      }
    }
    if (links.length === 0) {
      throw new RetentionHoldError(
        "record_not_found",
        "No reports exist for that prompt, so there is nothing to hold.",
      );
    }
  }
  if (links.length > MAX_LINKS_PER_HOLD) {
    throw new RetentionHoldError("invalid_request", "Invalid retention hold request.", [
      `a hold may link at most ${MAX_LINKS_PER_HOLD} records`,
    ]);
  }

  // Idempotent retry: same case and same records already held.
  const existing = (await deps.holds.list({ status: "active", caseRef: req.caseRef })).find(
    (h) => h.caseType === req.caseType && sameLinkSet(h.links, links),
  );
  if (existing) {
    return { hold: existing, created: false, alreadyArchived: existing.alreadyArchived };
  }

  // Every linked record must exist; refuse a hold that silently protects nothing.
  const states = new Map<string, TargetRecordState>();
  const missing: string[] = [];
  for (const [collection, ids] of groupByCollection(links)) {
    const found = await deps.targets[collection].findByIds(ids);
    const foundIds = new Set(found.map((s) => s.id.toLowerCase()));
    for (const s of found) states.set(`${collection}:${s.id.toLowerCase()}`, s);
    for (const id of ids) if (!foundIds.has(id)) missing.push(`${collection}:${id}`);
  }
  if (missing.length > 0) {
    throw new RetentionHoldError("record_not_found", "Some linked records do not exist.", missing);
  }

  const alreadyArchived = links
    .filter((l) => states.get(`${l.collection}:${l.recordId}`)?.archivedAt)
    .map((l) => `${l.collection}:${l.recordId}`);

  // Flags first (so a concurrent cleanup batch sees them), ledger second.
  const flaggedByUs: Array<[HoldableCollection, string[]]> = [];
  for (const [collection, ids] of groupByCollection(links)) {
    const needFlag = ids.filter((id) => !states.get(`${collection}:${id}`)?.retentionHold);
    if (needFlag.length > 0) {
      await deps.targets[collection].flagManaged(needFlag);
      flaggedByUs.push([collection, needFlag]);
    }
  }

  const now = deps.now();
  let hold: RetentionHoldRecord;
  try {
    hold = await deps.holds.insert({
      caseType: req.caseType,
      caseRef: req.caseRef,
      reason: req.reason,
      status: "active",
      links,
      alreadyArchived,
      createdBy: req.actor,
      reviewBy: new Date(now.getTime() + req.reviewDays * DAY_MS),
      releasedBy: null,
      releasedAt: null,
      releaseReason: null,
    });
  } catch (err) {
    // Compensate: do not leave flags that no hold accounts for.
    for (const [collection, ids] of flaggedByUs) {
      await deps.targets[collection].unflagManaged(ids).catch(() => 0);
    }
    throw err;
  }

  // Re-assert flags now that the ledger entry exists: if a concurrent release
  // of another hold on the same record cleared its flag between our read and
  // our insert, this restores it. The ledger already protects the record from
  // cleanup either way; this only keeps the archive-time recheck effective.
  for (const [collection, ids] of groupByCollection(links)) {
    await deps.targets[collection].flagManaged(ids).catch(() => 0);
  }

  await deps.audit({
    action: "retention_hold_created",
    result: "success",
    actor: req.actor,
    target: hold.id,
    targetType: "retention_hold",
    reason: `case=${req.caseType}:${req.caseRef} records=${links.length} archived=${alreadyArchived.length} reviewBy=${hold.reviewBy.toISOString()} why=${req.reason}`,
  });

  return { hold, created: true, alreadyArchived };
}

// ─── Release ─────────────────────────────────────────────────────────────────

export interface ReleaseHoldResult {
  hold: RetentionHoldRecord;
  /** Records returned to normal retention. */
  releasedRecords: number;
  /** Records still protected by another active hold. */
  stillHeld: number;
  /** False if clearing flags failed; run reconcileHoldFlags to finish. */
  flagsCleared: boolean;
}

export async function releaseHold(
  id: string,
  input: { actor: string; reason: string },
  deps: RetentionHoldDeps = defaultDeps(),
): Promise<ReleaseHoldResult> {
  const reason = (input.reason ?? "").trim();
  const actor = (input.actor ?? "").trim();
  if (!actor || reason.length < 10 || reason.length > 500) {
    throw new RetentionHoldError("invalid_request", "Invalid release request.", [
      "actor is required and reason must be 10-500 characters documenting why the hold is no longer needed",
    ]);
  }

  const released = await deps.holds.release(id, {
    releasedBy: actor,
    releaseReason: reason,
    releasedAt: deps.now(),
  });
  if (!released) {
    const current = await deps.holds.get(id);
    if (!current) throw new RetentionHoldError("hold_not_found", "Retention hold not found.");
    throw new RetentionHoldError("already_released", "Retention hold is already released.");
  }

  // Records another active hold still covers must stay protected.
  const stillCovered = coveredKeys(await deps.holds.list({ status: "active" }));
  let releasedRecords = 0;
  let stillHeld = 0;
  let flagsCleared = true;
  for (const [collection, ids] of groupByCollection(released.links)) {
    const clearable = ids.filter((rid) => !stillCovered.has(`${collection}:${rid}`));
    stillHeld += ids.length - clearable.length;
    if (clearable.length === 0) continue;
    try {
      await deps.targets[collection].unflagManaged(clearable);
      releasedRecords += clearable.length;
    } catch {
      // Fail safe: the record stays flagged (over-retained) until reconciled.
      flagsCleared = false;
    }
  }

  await deps.audit({
    action: "retention_hold_released",
    result: flagsCleared ? "success" : "failure",
    actor,
    target: released.id,
    targetType: "retention_hold",
    reason: `case=${released.caseType}:${released.caseRef} released=${releasedRecords} stillHeld=${stillHeld} flagsCleared=${flagsCleared} why=${reason}`,
  });

  return { hold: released, releasedRecords, stillHeld, flagsCleared };
}

function coveredKeys(activeHolds: RetentionHoldRecord[]): Set<string> {
  const keys = new Set<string>();
  for (const hold of activeHolds) {
    for (const l of hold.links) keys.add(`${l.collection}:${l.recordId.toLowerCase()}`);
  }
  return keys;
}

// ─── Read side used by cleanup ───────────────────────────────────────────────

/**
 * Record ids currently protected by an active hold, per collection. Throws
 * `ledger_unavailable` rather than returning an empty set on failure: callers
 * (cleanup) must fail closed.
 */
export async function getActiveHeldRecordIds(
  deps: Pick<RetentionHoldDeps, "holds"> = defaultDeps(),
): Promise<Record<HoldableCollection, string[]>> {
  const result = Object.fromEntries(HOLDABLE_COLLECTIONS.map((c) => [c, [] as string[]])) as Record<
    HoldableCollection,
    string[]
  >;
  let active: RetentionHoldRecord[];
  try {
    active = await deps.holds.list({ status: "active" });
  } catch (err) {
    throw new RetentionHoldError(
      "ledger_unavailable",
      `Retention hold ledger unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const seen = new Set<string>();
  for (const hold of active) {
    for (const link of hold.links) {
      const key = `${link.collection}:${link.recordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result[link.collection].push(link.recordId);
    }
  }
  return result;
}

/** Active holds whose review date has passed (forgotten holds over-retain data). */
export async function listOverdueHolds(
  deps: Pick<RetentionHoldDeps, "holds" | "now"> = defaultDeps(),
): Promise<RetentionHoldRecord[]> {
  const now = deps.now().getTime();
  return (await deps.holds.list({ status: "active" })).filter((h) => h.reviewBy.getTime() < now);
}

// ─── Reconcile ───────────────────────────────────────────────────────────────

export interface ReconcileResult {
  dryRun: boolean;
  /** Managed flags with no covering active hold (leaked by a failed release). */
  orphanedFlags: Record<HoldableCollection, string[]>;
  cleared: number;
}

/**
 * Finds ledger-managed flags no active hold accounts for and, unless dryRun,
 * clears them. Manual flags (different reason) are never touched.
 */
export async function reconcileHoldFlags(
  options: { dryRun?: boolean; limit?: number } = {},
  deps: RetentionHoldDeps = defaultDeps(),
): Promise<ReconcileResult> {
  const dryRun = options.dryRun ?? true;
  const limit = options.limit ?? 5000;
  const covered = coveredKeys(await deps.holds.list({ status: "active" }));
  const orphaned = Object.fromEntries(HOLDABLE_COLLECTIONS.map((c) => [c, [] as string[]])) as Record<
    HoldableCollection,
    string[]
  >;
  let cleared = 0;
  for (const collection of HOLDABLE_COLLECTIONS) {
    const flagged = await deps.targets[collection].listManagedFlagged(limit);
    orphaned[collection] = flagged.filter((id) => !covered.has(`${collection}:${id.toLowerCase()}`));
    if (!dryRun && orphaned[collection].length > 0) {
      cleared += await deps.targets[collection].unflagManaged(orphaned[collection]);
    }
  }
  if (!dryRun && cleared > 0) {
    await deps.audit({
      action: "retention_hold_reconciled",
      result: "success",
      actor: "system",
      reason: `cleared ${cleared} orphaned managed flags`,
    });
  }
  return { dryRun, orphanedFlags: orphaned, cleared };
}

// ─── Mongo-backed dependencies ───────────────────────────────────────────────

type FlaggableModel = Model<any>;

function modelTarget(model: FlaggableModel): HoldTargetStore {
  return {
    async findByIds(ids) {
      const docs = await model.find({ _id: { $in: ids } }, { _id: 1, retentionHold: 1, archivedAt: 1 }).lean();
      return docs.map((d: any) => ({
        id: String(d._id),
        retentionHold: d.retentionHold === true,
        archivedAt: d.archivedAt ?? null,
      }));
    },
    async flagManaged(ids) {
      const res = await model.updateMany(
        { _id: { $in: ids }, retentionHold: { $ne: true } },
        { $set: { retentionHold: true, retentionHoldReason: MANAGED_FLAG_REASON } },
      );
      return res.modifiedCount;
    },
    async unflagManaged(ids) {
      const res = await model.updateMany(
        { _id: { $in: ids }, retentionHold: true, retentionHoldReason: MANAGED_FLAG_REASON },
        { $set: { retentionHold: false, retentionHoldReason: null } },
      );
      return res.modifiedCount;
    },
    async listManagedFlagged(limit) {
      const docs = await model
        .find({ retentionHold: true, retentionHoldReason: MANAGED_FLAG_REASON }, { _id: 1 })
        .limit(limit)
        .lean();
      return docs.map((d: any) => String(d._id));
    },
  };
}

function toRecord(doc: any): RetentionHoldRecord {
  return {
    id: String(doc._id),
    caseType: doc.caseType,
    caseRef: doc.caseRef,
    reason: doc.reason,
    status: doc.status,
    links: (doc.links ?? []).map((l: any) => ({ collection: l.store, recordId: String(l.recordId).toLowerCase() })),
    alreadyArchived: doc.alreadyArchived ?? [],
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    reviewBy: doc.reviewBy,
    releasedBy: doc.releasedBy ?? null,
    releasedAt: doc.releasedAt ?? null,
    releaseReason: doc.releaseReason ?? null,
  };
}

function mongoHoldStore(): HoldStore {
  return {
    async insert(doc) {
      const { links, ...rest } = doc;
      return toRecord(
        await RetentionHold.create({
          ...rest,
          links: links.map((l) => ({ store: l.collection, recordId: l.recordId })),
        }),
      );
    },
    async get(id) {
      if (!OBJECT_ID.test(id)) return null;
      const doc = await RetentionHold.findById(id).lean();
      return doc ? toRecord(doc) : null;
    },
    async list(filter) {
      const docs = await RetentionHold.find(filter).sort({ createdAt: -1 }).lean();
      return docs.map(toRecord);
    },
    async release(id, patch) {
      if (!OBJECT_ID.test(id)) return null;
      const doc = await RetentionHold.findOneAndUpdate(
        { _id: id, status: "active" },
        { $set: { status: "released", ...patch } },
        { new: true },
      ).lean();
      return doc ? toRecord(doc) : null;
    },
  };
}

export function defaultDeps(): RetentionHoldDeps {
  return {
    holds: mongoHoldStore(),
    targets: {
      inboundWebhookEvents: modelTarget(InboundWebhookEvent as unknown as FlaggableModel),
      quarantinedEvents: modelTarget(QuarantinedEvent as unknown as FlaggableModel),
      exports: modelTarget(JobRecord as unknown as FlaggableModel),
      supportEvidence: modelTarget(Report as unknown as FlaggableModel),
    },
    async findReportIdsForPrompt(promptId) {
      const docs = await Report.find({ promptId }, { _id: 1 }).limit(MAX_LINKS_PER_HOLD + 1).lean();
      return docs.map((d: any) => String(d._id));
    },
    audit: (params) => recordAuditEvent(params),
    now: () => new Date(),
  };
}
