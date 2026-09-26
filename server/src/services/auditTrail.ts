import { createHash } from "crypto";
import { AUDIT_ACTIONS, AuditLog, AuditAction, AuditResult } from "../models/AuditLog";
import { logger } from "./structuredLogger";

/**
 * Hash algorithm version written on new audit records (#783). Version 1 is
 * the original field set; version 2 also covers `actor` and `reason` and uses
 * canonical serialization.
 */
export const AUDIT_INTEGRITY_VERSION = 2;

const GENESIS_HASH = "0".repeat(64);

/**
 * Deterministic JSON serialization: object keys are sorted recursively and
 * `undefined` members are dropped, so the same logical record always produces
 * the same bytes regardless of property insertion order (#783).
 */
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || value === undefined || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(",")}}`;
}

/**
 * One-way SHA-256 hash of a Stellar wallet address.
 * Stored in audit logs instead of the raw address so logs are
 * privacy-safe by default while still allowing incident correlation (#224).
 *
 * @param address - Raw Stellar account ID (G…)
 * @returns Lowercase hex digest
 */
export function hashWalletAddress(address: string): string {
  return createHash("sha256").update(address.toLowerCase()).digest("hex");
}

export interface AuditHashInput {
  action: string;
  result: string;
  promptId: string | null;
  walletAddress: string | null;
  actor?: string | null;
  requestId: string | null;
  reason?: string | null;
  createdAt: Date;
  previousHash: string;
  integrityVersion?: number | null;
}

/**
 * Compute a SHA-256 hash of an audit record for tamper evidence.
 * The hash includes the previous record's hash to form a chain.
 */
export function computeRecordHash(record: AuditHashInput): string {
  if (!record.integrityVersion || record.integrityVersion < 2) {
    // Legacy field set, kept byte-for-byte so records written before #783
    // still verify.
    const data = JSON.stringify({
      action: record.action,
      result: record.result,
      promptId: record.promptId,
      walletAddress: record.walletAddress,
      requestId: record.requestId,
      createdAt: record.createdAt.toISOString(),
      previousHash: record.previousHash,
    });
    return createHash("sha256").update(data).digest("hex");
  }

  const data = canonicalJson({
    action: record.action,
    result: record.result,
    promptId: record.promptId ?? null,
    walletAddress: record.walletAddress ?? null,
    actor: record.actor ?? null,
    requestId: record.requestId ?? null,
    reason: record.reason ?? null,
    createdAt: record.createdAt.toISOString(),
    previousHash: record.previousHash,
    integrityVersion: record.integrityVersion,
  });
  return createHash("sha256").update(data).digest("hex");
}

function hashInputFromRow(row: any): AuditHashInput {
  return {
    action: row.action,
    result: row.result,
    promptId: row.promptId ?? null,
    walletAddress: row.walletAddress ?? null,
    actor: row.actor ?? null,
    requestId: row.requestId ?? null,
    reason: row.reason ?? null,
    createdAt: new Date(row.createdAt),
    previousHash: row.previousHash,
    integrityVersion: row.integrityVersion ?? null,
  };
}

/**
 * Structured fields logged for every unlock attempt.
 *
 * Fields:
 *   action      - AuditAction enum value (e.g. "unlock_attempt", "access_granted")
 *   result      - AuditResult enum value ("success" | "failure" | "denied")
 *   requestId   - UUID from withObservability middleware; links log → DB row
 *   walletHash  - SHA-256(walletAddress.toLowerCase()); never the raw address
 *   promptId    - Numeric prompt ID from the contract
 *   reason      - Human-readable explanation for denials/failures (no sensitive content)
 *
 * NEVER include: plaintext, signedMessage, challengeSecret, privateKey, or clientIp
 * in structured logs. Those are either redacted by the pino transport or must not
 * appear at all.
 */
export interface AuditEventParams {
  action: AuditAction;
  result: AuditResult;
  promptId?: string | null;
  /** Raw Stellar wallet address — hashed before logging or DB persistence. */
  walletAddress?: string | null;
  /** Non-wallet principal, e.g. the admin token subject. */
  actor?: string | null;
  requestId?: string | null;
  clientIp?: string | null;
  reason?: string | null;
}

/**
 * Persist a structured audit event and emit a pino log entry at the
 * appropriate level.
 *
 * Log levels (#224):
 *   info  — successful unlock or expected denial (no on-chain access)
 *   warn  — validation failure (bad signature, expired challenge)
 *   error — unexpected internal error during the unlock flow
 *
 * Fire-and-forget: DB errors are caught and logged to stderr; they never
 * propagate so a storage hiccup cannot block a legitimate unlock.
 */
export async function recordAuditEvent(params: AuditEventParams): Promise<void> {
  const walletHash = params.walletAddress
    ? hashWalletAddress(params.walletAddress)
    : null;

  // Structured pino log — wallet address is intentionally absent; only the
  // hash is emitted so the log stream never carries PII (#224).
  const logFields = {
    action: params.action,
    result: params.result,
    requestId: params.requestId ?? undefined,
    walletHash: walletHash ?? undefined,
    actor: params.actor ?? undefined,
    promptId: params.promptId ?? undefined,
    reason: params.reason ?? undefined,
  };

  if ((params.result as string) === "failure" || (params.result as string) === "denied") {
    logger.warn(`audit: ${params.action} -> ${params.result}`, logFields);
  } else {
    logger.info(`audit: ${params.action} -> ${params.result}`, logFields);
  }

  try {
    // Get the last audit record to compute hash chain
    const lastRecord = await AuditLog.findOne().sort({ createdAt: -1, _id: -1 }).lean();
    const previousHash = lastRecord?.recordHash || GENESIS_HASH;

    const now = new Date();
    const recordHash = computeRecordHash({
      action: params.action,
      result: params.result,
      promptId: params.promptId ?? null,
      walletAddress: walletHash,
      actor: params.actor ?? null,
      requestId: params.requestId ?? null,
      reason: params.reason ?? null,
      createdAt: now,
      previousHash,
      integrityVersion: AUDIT_INTEGRITY_VERSION,
    });

    await AuditLog.create({
      action: params.action,
      result: params.result,
      promptId: params.promptId ?? null,
      // Store the hash, not the raw address, for DB-level privacy (#224).
      walletAddress: walletHash,
      actor: params.actor ?? null,
      requestId: params.requestId ?? null,
      clientIp: params.clientIp ?? null,
      reason: params.reason ?? null,
      recordHash,
      previousHash,
      integrityVersion: AUDIT_INTEGRITY_VERSION,
      // Persist the exact timestamp that was hashed; letting Mongoose stamp
      // its own would make the record fail verification.
      createdAt: now,
    });
  } catch (err) {
    // Do not let audit failures surface to callers.
    logger.error("audit: failed to persist audit event to DB", {
      action: params.action,
      requestId: params.requestId ?? undefined,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Query audit events for incident review. Returns the most recent `limit`
 * events matching the filter, oldest-first within the result set.
 *
 * Pass walletAddress as a raw address — it will be hashed before querying
 * so the caller never needs to know the storage representation.
 */
export async function queryAuditEvents(filter: {
  walletAddress?: string;
  promptId?: string;
  action?: AuditAction;
  result?: AuditResult;
  since?: Date;
  until?: Date;
  limit?: number;
}) {
  const query: Record<string, unknown> = {};

  if (filter.walletAddress) query.walletAddress = hashWalletAddress(filter.walletAddress);
  if (filter.promptId) query.promptId = filter.promptId;
  if (filter.action) query.action = filter.action;
  if (filter.result) query.result = filter.result;
  if (filter.since || filter.until) {
    query.createdAt = {} as Record<string, Date>;
    if (filter.since) (query.createdAt as Record<string, Date>)["$gte"] = filter.since;
    if (filter.until) (query.createdAt as Record<string, Date>)["$lte"] = filter.until;
  }

  return AuditLog.find(query)
    .sort({ createdAt: -1 })
    .limit(filter.limit ?? 100)
    .lean();
}

export interface UnlockSupportTimelineEntry {
  sequence: number;
  createdAt: Date;
  action: AuditAction;
  result: AuditResult;
  promptId: string | null;
  walletHash: string | null;
  requestId: string | null;
  reason: string | null;
  recordHash: string;
  previousHash: string;
}

type UnlockSupportTimeline = {
  generatedAt: string;
  promptId: string;
  walletHash: string;
  decision: "allowed" | "denied" | "blocked" | "indeterminate";
  indexerStatus: "observed" | "missing";
  entries: UnlockSupportTimelineEntry[];
};

export function buildUnlockSupportTimelineFromRows(
  rows: any[],
  filter: { walletAddress: string; promptId: string },
): UnlockSupportTimeline {
  const walletHash = hashWalletAddress(filter.walletAddress);
  const entries = [...rows]
    .reverse()
    .map((row: any, index) => ({
      sequence: index + 1,
      createdAt: new Date(row.createdAt),
      action: row.action,
      result: row.result,
      promptId: row.promptId ?? null,
      walletHash: row.walletAddress ?? null,
      requestId: row.requestId ?? null,
      reason: row.reason ?? null,
      recordHash: row.recordHash,
      previousHash: row.previousHash,
    }));
  const lastUnlock = [...entries].reverse().find((entry) => entry.action.startsWith("unlock_"));
  const decision =
    lastUnlock?.action === "unlock_success"
      ? "allowed"
      : lastUnlock?.result === "blocked"
        ? "blocked"
        : lastUnlock?.result === "failure"
          ? "denied"
          : "indeterminate";

  return {
    generatedAt: new Date().toISOString(),
    promptId: filter.promptId,
    walletHash,
    decision,
    indexerStatus: entries.some((entry) => entry.action === "unlock_ledger_failure")
      ? "missing"
      : "observed",
    entries,
  };
}

export async function buildUnlockSupportTimeline(filter: {
  walletAddress: string;
  promptId: string;
  limit?: number;
}): Promise<UnlockSupportTimeline> {
  const rows = await queryAuditEvents({
    walletAddress: filter.walletAddress,
    promptId: filter.promptId,
    limit: filter.limit ?? 100,
  });
  return buildUnlockSupportTimelineFromRows(rows, filter);
}

/**
 * Verify the integrity of the audit trail hash chain.
 * Returns an object with the verification result and any errors found.
 * Can be run offline to detect tampering.
 */
export async function verifyAuditTrail(): Promise<{
  valid: boolean;
  totalRecords: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let previousHash = GENESIS_HASH;
  let totalRecords = 0;

  // Walk every record in chronological order through a lean cursor so the
  // whole trail is never held in memory at once.
  const cursor = AuditLog.find()
    .sort({ createdAt: 1, _id: 1 })
    .lean()
    .cursor({ batchSize: 500 });

  for await (const record of cursor) {
    totalRecords += 1;

    // Verify previous hash chain
    if (record.previousHash !== previousHash) {
      errors.push(
        `Record ${totalRecords} (${record._id}): previous hash mismatch. Expected ${previousHash}, got ${record.previousHash}`
      );
    }

    // Verify record hash
    if (record.recordHash !== computeRecordHash(hashInputFromRow(record))) {
      errors.push(
        `Record ${totalRecords} (${record._id}): hash mismatch. Record may have been tampered with.`
      );
    }

    previousHash = record.recordHash;
  }

  return {
    valid: errors.length === 0,
    totalRecords,
    errors,
  };
}

/**
 * Export scopes group related action codes so auditors can pull, e.g., every
 * moderation decision without enumerating each action (#783).
 */
export const AUDIT_EXPORT_SCOPES = {
  unlock: AUDIT_ACTIONS.filter((a) => a.startsWith("unlock_") || a.startsWith("challenge_")),
  admin: AUDIT_ACTIONS.filter((a) => a.startsWith("admin_") || a.startsWith("audit_")),
  moderation: AUDIT_ACTIONS.filter((a) => a.startsWith("prompt_") || a.startsWith("moderation_")),
  dispute: AUDIT_ACTIONS.filter((a) => a.startsWith("dispute_")),
} as const satisfies Record<string, AuditAction[]>;

export type AuditExportScope = keyof typeof AUDIT_EXPORT_SCOPES;

export const AUDIT_EXPORT_MAX_LIMIT = 10_000;
const AUDIT_EXPORT_DEFAULT_LIMIT = 1_000;
const AUDIT_EXPORT_VERSION = 1;

export interface AuditBundleExportFilter {
  /** Admin token subject, or a raw wallet address (matched by its hash). */
  actor?: string;
  action?: AuditAction | AuditAction[];
  scope?: AuditExportScope;
  promptId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  /** Continuation cursor returned as `nextCursor` by the previous page. */
  after?: string;
}

export interface AuditBundleRecord {
  sequence: number;
  createdAt: string;
  action: string;
  result: string;
  promptId: string | null;
  walletHash: string | null;
  actor: string | null;
  requestId: string | null;
  reason: string | null;
  recordHash: string;
  previousHash: string;
  integrityVersion: number;
}

export interface AuditBundle {
  exportVersion: number;
  exportedAt: string;
  recordCount: number;
  filters: Record<string, unknown>;
  records: AuditBundleRecord[];
  integrityChecksum: string;
  hasMore: boolean;
  nextCursor: string | null;
}

function encodeExportCursor(row: { createdAt: Date; _id: unknown }): string {
  return Buffer.from(`${new Date(row.createdAt).toISOString()}|${String(row._id)}`).toString(
    "base64url",
  );
}

function decodeExportCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (Number.isNaN(createdAt.getTime()) || !/^[a-f0-9]{24}$/i.test(id ?? "")) {
    throw new Error("Invalid export cursor.");
  }
  return { createdAt, id };
}

function resolveExportActions(filter: AuditBundleExportFilter): AuditAction[] | null {
  const requested = filter.action
    ? Array.isArray(filter.action)
      ? filter.action
      : [filter.action]
    : null;
  if (!filter.scope) return requested;
  const scoped: readonly AuditAction[] = AUDIT_EXPORT_SCOPES[filter.scope];
  return requested ? requested.filter((a) => scoped.includes(a)) : [...scoped];
}

/**
 * Build the MongoDB query for an audit export. Exported for unit tests.
 */
export function buildAuditExportQuery(filter: AuditBundleExportFilter): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  if (filter.actor) {
    // Admin actions carry the token subject in `actor`; wallet actions only
    // ever store the wallet hash, so match either representation.
    and.push({
      $or: [{ actor: filter.actor }, { walletAddress: hashWalletAddress(filter.actor) }],
    });
  }
  const actions = resolveExportActions(filter);
  if (actions) {
    query.action = { $in: actions };
  }
  if (filter.promptId) {
    query.promptId = filter.promptId;
  }
  if (filter.since || filter.until) {
    query.createdAt = {} as Record<string, Date>;
    if (filter.since) (query.createdAt as Record<string, Date>)["$gte"] = filter.since;
    if (filter.until) (query.createdAt as Record<string, Date>)["$lte"] = filter.until;
  }
  if (filter.after) {
    const { createdAt, id } = decodeExportCursor(filter.after);
    and.push({
      $or: [{ createdAt: { $gt: createdAt } }, { createdAt, _id: { $gt: id } }],
    });
  }
  if (and.length > 0) {
    query.$and = and;
  }
  return query;
}

function toBundleRecord(row: any, sequence: number): AuditBundleRecord {
  return {
    sequence,
    createdAt: new Date(row.createdAt).toISOString(),
    action: row.action,
    result: row.result,
    promptId: row.promptId ?? null,
    walletHash: row.walletAddress ?? null,
    actor: row.actor ?? null,
    requestId: row.requestId ?? null,
    reason: row.reason ?? null,
    recordHash: row.recordHash,
    previousHash: row.previousHash,
    integrityVersion: row.integrityVersion ?? 1,
  };
}

/**
 * Checksum over an ordered list of exported records: SHA-256 of each record's
 * canonical JSON followed by a newline. Recomputable by anyone holding the
 * export (see docs/operations/audit-log-usage.md).
 */
function exportChecksum(records: AuditBundleRecord[]): string {
  const hash = createHash("sha256");
  for (const record of records) {
    hash.update(`${canonicalJson(record)}\n`);
  }
  return hash.digest("hex");
}

/**
 * Export a filtered, redacted audit bundle for investigation.
 * Supports filtering by actor, action, scope, prompt ID, and date range. Large
 * result sets are paged: at most `limit` records are returned together with a
 * `nextCursor` for the following page. Client IPs are never exported.
 */
export async function exportAuditBundle(filter: AuditBundleExportFilter): Promise<AuditBundle> {
  const limit = Math.min(
    Math.max(Math.floor(filter.limit ?? AUDIT_EXPORT_DEFAULT_LIMIT), 1),
    AUDIT_EXPORT_MAX_LIMIT,
  );
  const query = buildAuditExportQuery(filter);

  const records: AuditBundleRecord[] = [];
  let hasMore = false;
  let last: { createdAt: Date; _id: unknown } | null = null;

  // Stream rows through a lean cursor so a large export never materializes
  // full documents; the extra row tells us whether another page exists.
  const cursor = AuditLog.find(query)
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit + 1)
    .lean()
    .cursor({ batchSize: 500 });

  for await (const row of cursor) {
    if (records.length === limit) {
      hasMore = true;
      break;
    }
    records.push(toBundleRecord(row, records.length + 1));
    last = row;
  }

  return {
    exportVersion: AUDIT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    recordCount: records.length,
    filters: {
      actor: filter.actor ? "[REDACTED_HASH]" : undefined,
      action: filter.action,
      scope: filter.scope,
      promptId: filter.promptId,
      since: filter.since?.toISOString(),
      until: filter.until?.toISOString(),
      after: filter.after,
      limit,
    },
    records,
    integrityChecksum: exportChecksum(records),
    hasMore,
    nextCursor: hasMore && last ? encodeExportCursor(last) : null,
  };
}

export interface AuditExportVerification {
  valid: boolean;
  recordCount: number;
  checksumValid: boolean;
  errors: string[];
}

/**
 * Verify an exported bundle (#783):
 *  1. the bundle checksum matches its records (nothing added/removed/edited),
 *  2. every record still hashes to its own `recordHash`, and
 *  3. every record matches the stored audit record with that hash, which in
 *     turn must still pass its own integrity hash.
 */
export async function verifyAuditExport(bundle: {
  records?: AuditBundleRecord[];
  integrityChecksum?: string;
}): Promise<AuditExportVerification> {
  const errors: string[] = [];
  const records = Array.isArray(bundle?.records) ? bundle.records : [];

  const checksumValid = exportChecksum(records) === bundle?.integrityChecksum;
  if (!checksumValid) {
    errors.push("Bundle checksum mismatch: records were added, removed, reordered, or edited.");
  }

  for (const record of records) {
    const expected = computeRecordHash({
      action: record.action,
      result: record.result,
      promptId: record.promptId,
      walletAddress: record.walletHash,
      actor: record.actor,
      requestId: record.requestId,
      reason: record.reason,
      createdAt: new Date(record.createdAt),
      previousHash: record.previousHash,
      integrityVersion: record.integrityVersion,
    });
    if (expected !== record.recordHash) {
      errors.push(`Record ${record.sequence}: content does not match its recordHash.`);
    }
  }

  const BATCH = 500;
  for (let offset = 0; offset < records.length; offset += BATCH) {
    const batch = records.slice(offset, offset + BATCH);
    const stored = await AuditLog.find({
      recordHash: { $in: batch.map((record) => record.recordHash) },
    }).lean();
    const storedByHash = new Map<string, any>(stored.map((row: any) => [row.recordHash, row]));

    for (const record of batch) {
      const row = storedByHash.get(record.recordHash);
      if (!row) {
        errors.push(`Record ${record.sequence}: no stored audit record has this recordHash.`);
        continue;
      }
      if (canonicalJson(toBundleRecord(row, record.sequence)) !== canonicalJson(record)) {
        errors.push(`Record ${record.sequence}: differs from the stored audit record.`);
      }
      if (computeRecordHash(hashInputFromRow(row)) !== row.recordHash) {
        errors.push(`Record ${record.sequence}: stored record fails its own integrity hash.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    recordCount: records.length,
    checksumValid,
    errors,
  };
}
