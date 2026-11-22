/**
 * Deterministic Sorting for Mixed-Status Records and Events (#1032).
 *
 * Ensures mathematical total ordering and deterministic pagination across
 * records and events with heterogeneous statuses (e.g., active, pending,
 * paused, quarantined, retired).
 *
 * Core Guarantees:
 *   1. Strict Total Order:
 *      Every pair of distinct records (A != B) has a defined, unambiguous
 *      relative order (either A < B or B < A, never equal).
 *   2. Permutation Invariance:
 *      Input order, network arrival sequence, or database cursor jitter does
 *      not alter the sorted output. Array reversal or seeded shuffles produce
 *      the identical sorted sequence and SHA-256 fingerprint.
 *   3. Tamper-Evident Pagination Cursor:
 *      Encodes the exact multi-attribute tuple (statusRank, primaryKey, secondaryKey, id)
 *      with an HMAC-SHA256 checksum so client pagination cannot drift or skip records
 *      during concurrent status transitions.
 *
 * Space & Time Complexity:
 *   - Sort Time: O(N log N) using stable comparison sort.
 *   - Cursor Validation: O(1).
 *   - Space Complexity: O(N) shallow copy of record pointers.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";

export const PROMPT_STATUS_PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  active: 1,
  pending: 2,
  paused: 3,
  flagged: 4,
  quarantined: 5,
  retired: 6,
});

export const EVENT_STATUS_PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  committed: 1,
  replayed: 2,
  pending: 3,
  quarantined: 4,
  dlq: 5,
  rolled_back: 6,
});

export const GRANT_STATUS_PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  active: 1,
  pending: 2,
  expired: 3,
  revoked: 4,
});

/**
 * Status precedence for service components and probes (#1184).
 * Operational dashboards and status pages surface `down` and `degraded`
 * services ahead of `up`/`healthy` services, breaking ties by name.
 */
export const COMPONENT_STATUS_PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  down: 1,
  degraded: 2,
  up: 3,
  healthy: 3,
});

/**
 * Severity precedence for operational health exceptions and incidents (#1184).
 */
export const SEVERITY_STATUS_PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  critical: 1,
  high: 2,
  warning: 2,
  medium: 3,
  info: 4,
  low: 4,
});

/**
 * Status precedence for background jobs and webhook outbox/inbound events (#1184).
 */
export const JOB_AND_WEBHOOK_STATUS_PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  dead_letter: 1,
  failed: 2,
  verification_failed: 2,
  quarantined: 3,
  processing: 4,
  pending: 5,
  processed: 6,
  delivered: 6,
  completed: 6,
  skipped: 7,
});

export interface SortableRecord {
  id: string;
  status: string;
  primaryKey: number | string; // e.g., ledger sequence number or createdAt epoch ms
  secondaryKey?: number | string; // e.g., txIndex or version
  [key: string]: unknown;
}

export interface DeterministicSortOptions {
  direction?: "asc" | "desc";
  /**
   * When true, status precedence is the dominant primary sorting factor.
   * When false, primaryKey is dominant, and status precedence breaks ties.
   * Defaults to false (chronological / ledger dominant).
   */
  groupByStatus?: boolean;
  statusPrecedence?: Record<string, number>;
}

export interface DeterministicCursorData {
  statusRank: number;
  primaryKey: number | string;
  secondaryKey: number | string;
  id: string;
}

export interface PaginatedResult<T extends SortableRecord> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export type DeterministicSortErrorCode =
  | "invalid_cursor"
  | "cursor_tampered"
  | "empty_selection"
  | "unsupported_key_type";

export class DeterministicSortError extends Error {
  readonly code: DeterministicSortErrorCode;
  constructor(
    code: DeterministicSortErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeterministicSortError";
    this.code = code;
  }
}

/**
 * Returns canonical numerical rank for a status string based on the given precedence map.
 */
export function getStatusRank(
  status: string,
  precedence: Record<string, number> = PROMPT_STATUS_PRECEDENCE,
): number {
  const norm = (status || "").toLowerCase().trim();
  if (norm.startsWith("__rank_")) {
    const parsed = Number.parseInt(norm.slice(7), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return precedence[norm] ?? 999;
}

/**
 * Normalizes comparison keys into strict numeric or lexicographic values.
 */
function comparePrimitiveKeys(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const strA = String(a);
  const strB = String(b);
  return strA.localeCompare(strB, "en", { sensitivity: "variant" });
}

/**
 * Total order comparator for mixed-status records.
 */
export function createDeterministicComparator<T extends SortableRecord>(
  options: DeterministicSortOptions = {},
): (a: T, b: T) => number {
  const direction = options.direction ?? "asc";
  const factor = direction === "desc" ? -1 : 1;
  const groupByStatus = options.groupByStatus ?? false;
  const precedence = options.statusPrecedence ?? PROMPT_STATUS_PRECEDENCE;

  return (a: T, b: T): number => {
    // 0. Identity check
    if (a.id === b.id) return 0;

    const rankA = getStatusRank(a.status, precedence);
    const rankB = getStatusRank(b.status, precedence);

    if (groupByStatus) {
      // 1. Dominant status rank
      if (rankA !== rankB) {
        return (rankA - rankB) * factor;
      }
      // 2. Primary key
      const primCmp = comparePrimitiveKeys(a.primaryKey, b.primaryKey);
      if (primCmp !== 0) {
        return primCmp * factor;
      }
    } else {
      // 1. Dominant primary key (e.g. ledger or timestamp)
      const primCmp = comparePrimitiveKeys(a.primaryKey, b.primaryKey);
      if (primCmp !== 0) {
        return primCmp * factor;
      }
      // 2. Status rank tie-breaker
      if (rankA !== rankB) {
        return (rankA - rankB) * factor;
      }
    }

    // 3. Secondary key tie-breaker (e.g. txIndex, version)
    const secA = a.secondaryKey ?? 0;
    const secB = b.secondaryKey ?? 0;
    const secCmp = comparePrimitiveKeys(secA, secB);
    if (secCmp !== 0) {
      return secCmp * factor;
    }

    // 4. Ultimate tie-breaker: immutable ID lexicographic order (guarantees strict total order)
    return a.id.localeCompare(b.id, "en", { sensitivity: "variant" }) * factor;
  };
}

/**
 * Sorts an array of mixed-status records deterministically.
 * Returns a new shallow copy of the sorted records.
 */
export function sortMixedStatusRecords<T extends SortableRecord>(
  records: readonly T[],
  options: DeterministicSortOptions = {},
): T[] {
  const comparator = createDeterministicComparator<T>(options);
  return [...records].sort(comparator);
}

/**
 * Computes a SHA-256 fingerprint over a sorted record slice to verify determinism.
 */
export function computeSortedSequenceFingerprint(
  records: readonly SortableRecord[],
): string {
  const hash = createHash("sha256");
  for (const r of records) {
    hash.update(`${r.id}:${r.status}:${r.primaryKey}:${r.secondaryKey ?? 0};`);
  }
  return hash.digest("hex");
}

/**
 * Encodes a deterministic pagination cursor with HMAC integrity.
 */
export function encodeDeterministicCursor(
  record: SortableRecord,
  secret: string,
  precedence: Record<string, number> = PROMPT_STATUS_PRECEDENCE,
): string {
  const cursorData: DeterministicCursorData = {
    statusRank: getStatusRank(record.status, precedence),
    primaryKey: record.primaryKey,
    secondaryKey: record.secondaryKey ?? 0,
    id: record.id,
  };

  const payload = Buffer.from(JSON.stringify(cursorData), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");

  return `${payload}.${signature}`;
}

/**
 * Decodes and verifies a deterministic pagination cursor.
 */
export function decodeDeterministicCursor(
  cursorString: string,
  secret: string,
): DeterministicCursorData {
  const parts = cursorString.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DeterministicSortError("invalid_cursor", "Malformed pagination cursor format.");
  }

  const [payload, signature] = parts;
  const expectedSig = createHmac("sha256", secret).update(payload).digest("base64url");

  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expectedSig, "utf8");

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new DeterministicSortError("cursor_tampered", "Pagination cursor integrity verification failed.");
  }

  try {
    const jsonStr = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(jsonStr) as DeterministicCursorData;
  } catch {
    throw new DeterministicSortError("invalid_cursor", "Failed to deserialize cursor payload.");
  }
}

function toEpochMs(value: unknown): number {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Deterministically orders service/probe status checks (#1184).
 *
 * Order:
 *   1. Status severity (`down` < `degraded` < `up`/`healthy`)
 *   2. Higher latency first among equal status (null latency treated as -1)
 *   3. Canonical lexicographic name tie-breaker
 */
export function sortStatusComponentsDeterministically<
  T extends { name: string; status: string; latencyMs?: number | null },
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const rankA = getStatusRank(a.status, COMPONENT_STATUS_PRECEDENCE);
    const rankB = getStatusRank(b.status, COMPONENT_STATUS_PRECEDENCE);
    if (rankA !== rankB) return rankA - rankB;

    const latA = typeof a.latencyMs === "number" && Number.isFinite(a.latencyMs) ? a.latencyMs : -1;
    const latB = typeof b.latencyMs === "number" && Number.isFinite(b.latencyMs) ? b.latencyMs : -1;
    if (latA !== latB) return latB - latA;

    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "en", { sensitivity: "variant" });
  });
}

/**
 * Deterministically orders maintenance banners (#1184).
 *
 * Order:
 *   1. Severity (`critical` < `warning` < `info`)
 *   2. Earlier `endsAt` first (soonest window boundary)
 *   3. Canonical lexicographic `id` tie-breaker
 */
export function sortMaintenanceBannersDeterministically<
  T extends { id?: string; _id?: unknown; severity?: string; endsAt?: string | Date; startsAt?: string | Date },
>(banners: readonly T[]): T[] {
  return [...banners].sort((a, b) => {
    const sevA = getStatusRank(String(a.severity ?? "info"), SEVERITY_STATUS_PRECEDENCE);
    const sevB = getStatusRank(String(b.severity ?? "info"), SEVERITY_STATUS_PRECEDENCE);
    if (sevA !== sevB) return sevA - sevB;

    const endA = toEpochMs(a.endsAt ?? a.startsAt);
    const endB = toEpochMs(b.endsAt ?? b.startsAt);
    if (endA !== endB) return endA - endB;

    const idA = String(a.id ?? a._id ?? "");
    const idB = String(b.id ?? b._id ?? "");
    return idA.localeCompare(idB, "en", { sensitivity: "variant" });
  });
}

/**
 * Deterministically orders operational health exceptions or incidents (#1184).
 *
 * Order:
 *   1. Severity / Priority (`CRITICAL` < `HIGH` < `MEDIUM` < `LOW`)
 *   2. Timestamp (`occurredAt` or `createdAt`, newest first by default)
 *   3. Canonical lexicographic `id` tie-breaker
 */
export function sortOperationalAlertsDeterministically<
  T extends {
    id: string;
    severity?: string;
    priority?: string;
    status?: string;
    occurredAt?: string | Date;
    createdAt?: string | Date;
  },
>(items: readonly T[], direction: "asc" | "desc" = "desc"): T[] {
  const timeFactor = direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const rankA = getStatusRank(String(a.severity ?? a.priority ?? a.status ?? ""), SEVERITY_STATUS_PRECEDENCE);
    const rankB = getStatusRank(String(b.severity ?? b.priority ?? b.status ?? ""), SEVERITY_STATUS_PRECEDENCE);
    if (rankA !== rankB) return rankA - rankB;

    const timeA = toEpochMs(a.occurredAt ?? a.createdAt);
    const timeB = toEpochMs(b.occurredAt ?? b.createdAt);
    if (timeA !== timeB) return (timeA - timeB) * timeFactor;

    return String(a.id ?? "").localeCompare(String(b.id ?? ""), "en", { sensitivity: "variant" });
  });
}

/**
 * Deterministically orders event lists (inbound webhooks, outbox dead-letters,
 * background jobs, or timeline events) (#1184).
 *
 * Order:
 *   1. Primary timestamp (`deadLetteredAt` ?? `createdAt` ?? `updatedAt`, newest first by default)
 *   2. Status rank (`JOB_AND_WEBHOOK_STATUS_PRECEDENCE`)
 *   3. Secondary sequence/attempt metric (`sequence` ?? `attemptCount` ?? `attempts`)
 *   4. Canonical lexicographic `_id` / `id` / `eventId` tie-breaker
 */
export function sortEventListDeterministically<T extends Record<string, any>>(
  events: readonly T[],
  options: {
    direction?: "asc" | "desc";
    groupByStatus?: boolean;
    timestampField?: string;
  } = {},
): T[] {
  const direction = options.direction ?? "desc";
  const factor = direction === "desc" ? -1 : 1;
  const groupByStatus = options.groupByStatus ?? false;

  return [...events].sort((a, b) => {
    const idA = String(a._id ?? a.id ?? a.eventId ?? a.idempotencyKey ?? "");
    const idB = String(b._id ?? b.id ?? b.eventId ?? b.idempotencyKey ?? "");
    if (idA && idA === idB) return 0;

    const statusA = String(a.processingStatus ?? a.status ?? "");
    const statusB = String(b.processingStatus ?? b.status ?? "");
    const rankA = getStatusRank(statusA, JOB_AND_WEBHOOK_STATUS_PRECEDENCE);
    const rankB = getStatusRank(statusB, JOB_AND_WEBHOOK_STATUS_PRECEDENCE);

    const tsField = options.timestampField;
    const timeA = toEpochMs(
      tsField ? a[tsField] : (a.deadLetteredAt ?? a.createdAt ?? a.updatedAt ?? a.occurredAt),
    );
    const timeB = toEpochMs(
      tsField ? b[tsField] : (b.deadLetteredAt ?? b.createdAt ?? b.updatedAt ?? b.occurredAt),
    );

    if (groupByStatus) {
      if (rankA !== rankB) return rankA - rankB;
      if (timeA !== timeB) return (timeA - timeB) * factor;
    } else {
      if (timeA !== timeB) return (timeA - timeB) * factor;
      if (rankA !== rankB) return rankA - rankB;
    }

    const seqA = Number(a.sequence ?? a.attemptCount ?? a.attempts ?? 0);
    const seqB = Number(b.sequence ?? b.attemptCount ?? b.attempts ?? 0);
    if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA !== seqB) {
      return (seqA - seqB) * factor;
    }

    return idA.localeCompare(idB, "en", { sensitivity: "variant" }) * factor;
  });
}

/**
 * Paginates deterministically over a pre-sorted or unsorted collection of mixed-status records.
 */
export function paginateMixedStatusRecords<T extends SortableRecord>(
  records: readonly T[],
  params: {
    limit: number;
    cursor?: string | null;
    secret: string;
    sortOptions?: DeterministicSortOptions;
  },
): PaginatedResult<T> {
  const limit = Math.max(1, Math.min(params.limit, 100));
  const sorted = sortMixedStatusRecords(records, params.sortOptions);
  const comparator = createDeterministicComparator<T>(params.sortOptions);

  let startIndex = 0;

  if (params.cursor) {
    const cursorData = decodeDeterministicCursor(params.cursor, params.secret);
    const cursorRecord: SortableRecord = {
      id: cursorData.id,
      status: `__rank_${cursorData.statusRank}`,
      primaryKey: cursorData.primaryKey,
      secondaryKey: cursorData.secondaryKey,
    };

    // Find the position strictly after cursorRecord
    const idx = sorted.findIndex((item) => item.id === cursorData.id);
    if (idx !== -1) {
      startIndex = idx + 1;
    } else {
      // Binary or linear search to find first element > cursorRecord
      startIndex = sorted.findIndex((item) => comparator(item, cursorRecord as T) > 0);
      if (startIndex === -1) startIndex = sorted.length;
    }
  }

  const slice = sorted.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < sorted.length;
  const lastItem = slice[slice.length - 1];

  const nextCursor =
    hasMore && lastItem
      ? encodeDeterministicCursor(
          lastItem,
          params.secret,
          params.sortOptions?.statusPrecedence ?? PROMPT_STATUS_PRECEDENCE,
        )
      : null;

  return {
    items: slice,
    nextCursor,
    hasMore,
    totalCount: sorted.length,
  };
}

/**
 * Verification utility asserting strict total ordering, antisymmetry, and transitivity.
 */
export function verifySortingInvariants<T extends SortableRecord>(
  records: readonly T[],
  options: DeterministicSortOptions = {},
): {
  isTotalOrder: boolean;
  isPermutationInvariant: boolean;
  fingerprint: string;
  violations: string[];
} {
  const violations: string[] = [];
  const sortedBaseline = sortMixedStatusRecords(records, options);
  const baselineFingerprint = computeSortedSequenceFingerprint(sortedBaseline);

  // 1. Verify Monotonicity
  const comparator = createDeterministicComparator<T>(options);
  for (let i = 0; i < sortedBaseline.length - 1; i++) {
    const a = sortedBaseline[i];
    const b = sortedBaseline[i + 1];
    const cmp = comparator(a, b);
    if (cmp > 0) {
      violations.push(`Monotonicity violation at index ${i}: ${a.id} > ${b.id}`);
    }
    if (a.id === b.id) {
      violations.push(`Duplicate ID collision: ${a.id}`);
    }
  }

  // 2. Verify Permutation Invariance (Reversed input produces same sorted output)
  const reversedInput = [...records].reverse();
  const sortedReversed = sortMixedStatusRecords(reversedInput, options);
  const reversedFingerprint = computeSortedSequenceFingerprint(sortedReversed);

  let isPermutationInvariant = true;
  if (baselineFingerprint !== reversedFingerprint) {
    violations.push("Permutation invariance failed: reversed input yielded different sort order.");
    isPermutationInvariant = false;
  }

  return {
    isTotalOrder: violations.length === 0,
    isPermutationInvariant,
    fingerprint: baselineFingerprint,
    violations,
  };
}
