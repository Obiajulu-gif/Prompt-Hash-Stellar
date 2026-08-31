import { createHash } from "crypto";
import { AuditLog, AuditAction, AuditResult } from "../models/AuditLog";
import { logger } from "./structuredLogger";

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

/**
 * Compute a SHA-256 hash of an audit record for tamper evidence.
 * The hash includes the previous record's hash to form a chain.
 */
function computeRecordHash(record: {
  action: string;
  result: string;
  promptId: string | null;
  walletAddress: string | null;
  requestId: string | null;
  createdAt: Date;
  previousHash: string;
}): string {
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
    promptId: params.promptId ?? undefined,
    reason: params.reason ?? undefined,
  };

  if ((params.result as string) === "failure" || (params.result as string) === "denied") {
    logger.warn(logFields, `audit: ${params.action} → ${params.result}`);
  } else {
    logger.info(logFields, `audit: ${params.action} → ${params.result}`);
  }

  try {
    // Get the last audit record to compute hash chain
    const lastRecord = await AuditLog.findOne().sort({ createdAt: -1 }).lean();
    const previousHash = lastRecord?.recordHash || "0".repeat(64);

    const now = new Date();
    const recordHash = computeRecordHash({
      action: params.action,
      result: params.result,
      promptId: params.promptId ?? null,
      walletAddress: walletHash,
      requestId: params.requestId ?? null,
      createdAt: now,
      previousHash,
    });

    await AuditLog.create({
      action: params.action,
      result: params.result,
      promptId: params.promptId ?? null,
      // Store the hash, not the raw address, for DB-level privacy (#224).
      walletAddress: walletHash,
      requestId: params.requestId ?? null,
      clientIp: params.clientIp ?? null,
      reason: params.reason ?? null,
      recordHash,
      previousHash,
    });
  } catch (err) {
    // Do not let audit failures surface to callers.
    logger.error(
      { action: params.action, requestId: params.requestId, err: err instanceof Error ? err.message : String(err) },
      "audit: failed to persist audit event to DB",
    );
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
  let previousHash = "0".repeat(64);
  let totalRecords = 0;

  // Get all records in chronological order
  const records = await AuditLog.find()
    .sort({ createdAt: 1 })
    .lean();

  totalRecords = records.length;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Verify previous hash chain
    if (record.previousHash !== previousHash) {
      errors.push(
        `Record ${i + 1} (${record._id}): previous hash mismatch. Expected ${previousHash}, got ${record.previousHash}`
      );
    }

    // Verify record hash
    const expectedHash = computeRecordHash({
      action: record.action,
      result: record.result,
      promptId: record.promptId,
      walletAddress: record.walletAddress,
      requestId: record.requestId,
      createdAt: new Date(record.createdAt),
      previousHash: record.previousHash,
    });

    if (record.recordHash !== expectedHash) {
      errors.push(
        `Record ${i + 1} (${record._id}): hash mismatch. Record may have been tampered with.`
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

export interface AuditBundleExportFilter {
  actor?: string;
  scope?: string;
  promptId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}

export interface AuditBundleRecord {
  sequence: number;
  createdAt: string;
  action: string;
  result: string;
  promptId: string | null;
  walletHash: string | null;
  requestId: string | null;
  reason: string | null;
  recordHash: string;
}

/**
 * Export a filtered, redacted audit bundle for investigation.
 * Supports filtering by actor (wallet), scope (category), prompt ID, and date range.
 * All sensitive data is redacted from the export.
 */
export async function exportAuditBundle(filter: AuditBundleExportFilter): Promise<{
  exportedAt: string;
  recordCount: number;
  filters: AuditBundleExportFilter;
  records: AuditBundleRecord[];
  integrityChecksum: string;
}> {
  const query: Record<string, unknown> = {};

  if (filter.actor) {
    query.walletAddress = hashWalletAddress(filter.actor);
  }
  if (filter.promptId) {
    query.promptId = filter.promptId;
  }
  if (filter.since || filter.until) {
    query.createdAt = {} as Record<string, Date>;
    if (filter.since) (query.createdAt as Record<string, Date>)["$gte"] = filter.since;
    if (filter.until) (query.createdAt as Record<string, Date>)["$lte"] = filter.until;
  }

  const records = await AuditLog.find(query)
    .sort({ createdAt: 1 })
    .limit(filter.limit ?? 10000)
    .lean();

  const exportedRecords: AuditBundleRecord[] = records.map((record, index) => ({
    sequence: index + 1,
    createdAt: record.createdAt.toISOString(),
    action: record.action,
    result: record.result,
    promptId: record.promptId,
    walletHash: record.walletAddress,
    requestId: record.requestId,
    reason: record.reason,
    recordHash: record.recordHash,
  }));

  const checksum = createHash("sha256")
    .update(JSON.stringify(exportedRecords))
    .digest("hex");

  return {
    exportedAt: new Date().toISOString(),
    recordCount: exportedRecords.length,
    filters: {
      actor: filter.actor ? "[REDACTED_HASH]" : undefined,
      scope: filter.scope,
      promptId: filter.promptId,
      since: filter.since?.toISOString(),
      until: filter.until?.toISOString(),
    },
    records: exportedRecords,
    integrityChecksum: checksum,
  };
}
