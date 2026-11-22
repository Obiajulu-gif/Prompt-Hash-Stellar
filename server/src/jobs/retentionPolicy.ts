export type RetentionDataType =
  | "promptEvents"
  | "exports"
  | "supportEvidence"
  | "auditLogs"
  | "financialRecords"
  | "blockchainRecords";

export interface RetentionCandidate {
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  completedAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  status?: string | null;
  processingStatus?: string | null;
  retentionHold?: boolean;
  archivedAt?: Date | string | null;
}

export const RETENTION_POLICIES = {
  promptEvents: {
    retentionDays: 30,
    action: "archive-and-scrub",
    eligibleStatuses: ["processed", "skipped", "replayed", "discarded"],
  },
  exports: {
    retentionDays: 30,
    action: "archive-and-scrub",
    eligibleStatuses: ["completed", "failed", "dead_letter"],
  },
  supportEvidence: {
    retentionDays: 365,
    action: "archive-and-scrub",
    eligibleStatuses: ["resolved", "dismissed"],
  },
  auditLogs: {
    retentionDays: null,
    action: "preserve",
    eligibleStatuses: [],
  },
  financialRecords: {
    retentionDays: null,
    action: "preserve",
    eligibleStatuses: [],
  },
  blockchainRecords: {
    retentionDays: null,
    action: "preserve",
    eligibleStatuses: [],
  },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getRetentionCutoff(
  dataType: RetentionDataType,
  now = new Date(),
): Date | null {
  const retentionDays = RETENTION_POLICIES[dataType].retentionDays;
  return retentionDays === null
    ? null
    : new Date(now.getTime() - retentionDays * DAY_MS);
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isRetentionEligible(
  dataType: RetentionDataType,
  candidate: RetentionCandidate,
  now = new Date(),
): boolean {
  const policy = RETENTION_POLICIES[dataType];
  const cutoff = getRetentionCutoff(dataType, now);
  if (
    cutoff === null ||
    candidate.retentionHold === true ||
    candidate.archivedAt != null
  ) {
    return false;
  }

  const status =
    dataType === "promptEvents"
      ? (candidate.processingStatus ?? candidate.status)
      : candidate.status;
  if (!(policy.eligibleStatuses as readonly string[]).includes(status ?? "")) {
    return false;
  }

  let effectiveDate = candidate.createdAt ?? candidate.updatedAt;
  if (dataType === "exports") {
    effectiveDate = candidate.completedAt ?? candidate.updatedAt;
  } else if (dataType === "supportEvidence") {
    effectiveDate = candidate.resolvedAt ?? candidate.updatedAt;
  } else if (dataType === "promptEvents" && !candidate.processingStatus) {
    effectiveDate = candidate.updatedAt ?? candidate.createdAt;
  }
  const date = parseDate(effectiveDate);
  return date !== null && date < cutoff;
}

/**
 * Retention enforcement and deletion verification.
 *
 * This module adds a focused vertical slice on top of the pure eligibility
 * predicates above. It provides a data-source abstraction that can be backed by
 * any storage layer (SQL, KV, etc.) so retention can be enforced and each
 * deletion verified without being tied to a specific database client.
 *
 * Contracts:
 * - The existing exports (`getRetentionCutoff`, `isRetentionEligible`,
 *   `RETENTION_POLICIES`) are preserved unchanged.
 * - Enforcement is idempotent: running it twice on the same data is safe.
 * - Deletions are only considered successful after a read-back verification
 *   confirms the record is gone or archived-scrubbed.
 * - Authorization is enforced before any mutation occurs.
 */

export type RetentionAction =
  (typeof RETENTION_POLICIES)[RetentionDataType]["action"];

export interface RetentionRecord extends RetentionCandidate {
  id: string;
}

export interface RetentionDataSource {
  /** Return candidates for a data type. May return more than eligible. */
  listCandidates(type: RetentionDataType): Promise<RetentionRecord[]>;
  /** Archive and scrub a single record. Must be idempotent. */
  archiveAndScrub(type: RetentionDataType, id: string): Promise<void>;
  /** Read back a record by ID. Returns null when it no longer exists. */
  getById(type: RetentionDataType, id: string): Promise<RetentionRecord | null>;
}

export interface RetentionAuthorization {
  /** Returns true when the caller may enforce retention for this type. */
  isAuthorized(type: RetentionDataType): Promise<boolean>;
}

export class RetentionAuthorizationError extends Error {
  constructor(message = "Retention enforcement not authorized") {
    super(message);
    this.name = "RetentionAuthorizationError";
  }
}

export class RetentionVerificationError extends Error {
  constructor(
    readonly dataType: RetentionDataType,
    readonly recordId: string,
  ) {
    super(`Retention deletion not verified for ${dataType}/${recordId}`);
    this.name = "RetentionVerificationError";
  }
}

export interface RetentionEnforcementResult {
  dataType: RetentionDataType;
  cutoff: Date | null;
  scanned: number;
  eligible: number;
  archived: number;
  verified: number;
  skipped: number;
  failed: Array<{ id: string; error: string }>;
  verificationFailures: Array<{ id: string; reason: string }>;
}

export interface EnforceRetentionOptions {
  now?: Date;
  /** Maximum number of records to process per invocation. Defaults to 1000. */
  batchLimit?: number;
  /** Number of attempts for transient failures. Defaults to 2. */
  maxAttempts?: number;
  /** Base delay between retries in milliseconds. Defaults to 50. */
  retryDelayMs?: number;
}

const DEFAULT_BATCH_LIMIT = 1000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  retryDelayMs: number,
): Promise<T> {
  let lastError: unknown;
  const attempts = Math.max(1, maxAttempts);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(retryDelayMs * attempt);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Retention operation failed"));
}

/**
 * Verifies that a record has been deleted or archived-scrubbed.
 *
 * A deletion is considered verified when either:
 *   1. The record no longer exists (read-back returns null), or
 *   2. The record still exists but is marked as archived-scrubbed via
 *      `archivedAt` being set and the record no longer being retention
 *      eligible (e.g. scrubbed in place).
 *
 * Throws `RetentionVerificationError` when the record is still present
 * and still eligible, indicating the deletion did not take effect.
 */
export async function verifyDeletion(
  dataSource: RetentionDataSource,
  dataType: RetentionDataType,
  recordId: string,
  now = new Date(),
): Promise<void> {
  const remaining = await dataSource.getById(dataType, recordId);
  if (remaining === null) return;
  if (remaining.archivedAt != null) {
    // Archived in place: not eligible for further retention action.
    if (!isRetentionEligible(dataType, remaining, now)) return;
  }
  throw new RetentionVerificationError(dataType, recordId);
}

/**
 * Enforces retention for a single data type.
 *
 * Flow per record:
 *   1. Authorization is checked once up front; failure throws
 *      `RetentionAuthorizationError` and no mutations are performed.
 *   2. Eligibility is evaluated using the pure predicates above.
 *   3. Archive-scrub is attempted with bounded retries for transient failures.
 *   4. Deletion is verified via read-back. If verification fails, the
 *      record is reported in `verificationFailures` and the run continues
 *      (no silent success).
 *
 * Rollback / recovery:
 *   - If archive-scrub fails after retries, the record is left untouched
 *     and reported in `failed`. The next run re-evaluates it, so the
 *     operation is safe to repeat (idempotent).
 *   - Verification failures do not roll back the archive (archive is the
 *     safe state), but they are surfaced so operators can investigate.
 */
export async function enforceRetention(
  dataSource: RetentionDataSource,
  authorization: RetentionAuthorization,
  dataType: RetentionDataType,
  options: EnforceRetentionOptions = {},
): Promise<RetentionEnforcementResult> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const authorized = await authorization.isAuthorized(dataType);
  if (!authorized) {
    throw new RetentionAuthorizationError();
  }

  const cutoff = getRetentionCutoff(dataType, now);
  const result: RetentionEnforcementResult = {
    dataType,
    cutoff,
    scanned: 0,
    eligible: 0,
    archived: 0,
    verified: 0,
    skipped: 0,
    failed: [],
    verificationFailures: [],
  };

  // Preserve policies have no cutoff and no eligible statuses; nothing to do.
  if (cutoff === null) {
    return result;
  }

  const candidates = await dataSource.listCandidates(dataType);
  const limited = candidates.slice(0, Math.max(0, batchLimit));
  result.scanned = limited.length;

  for (const record of limited) {
    if (!isRetentionEligible(dataType, record, now)) {
      result.skipped += 1;
      continue;
    }
    result.eligible += 1;

    try {
      await withRetry(
        () => dataSource.archiveAndScrub(dataType, record.id),
        maxAttempts,
        retryDelayMs,
      );
      result.archived += 1;
    } catch (error) {
      result.failed.push({
        id: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    try {
      await withRetry(
        () => verifyDeletion(dataSource, dataType, record.id, now),
        maxAttempts,
        retryDelayMs,
      );
      result.verified += 1;
    } catch (error) {
      result.verificationFailures.push({
        id: record.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
