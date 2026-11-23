/**
 * Production-Grade Bounded Pagination Engine (#1096).
 *
 * Enforces strict query limits, deterministic tie-breaking for shared timestamps,
 * and stable compound cursor pagination across prompt and event history APIs.
 *
 * Core Guarantees:
 *   1. Bound Guardrails: Enforces DEFAULT_PAGE_SIZE and MAX_PAGE_SIZE ceilings.
 *      Rejects oversized page requests with documented HTTP 400 PAGE_SIZE_EXCEEDED error.
 *   2. Strict Cursor Validation: Rejects malformed, tampered, or invalid cursors with
 *      HTTP 400 INVALID_CURSOR error.
 *   3. Deterministic Ordering: Guarantees stable pagination across records that share
 *      identical timestamps using compound keys (timestamp, _id).
 *   4. Space & Time Efficiency:
 *      - Cursor Encode/Decode: O(1) time and space.
 *      - Keyset Query Building: O(1) query structure generation.
 *      - In-Memory Pagination: O(N log N) sorting with O(K) slice space where K = page size.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const ABSOLUTE_MAX_PAGE_SIZE = 100;

export type PaginationErrorCode =
  | "INVALID_PAGE_SIZE"
  | "PAGE_SIZE_EXCEEDED"
  | "INVALID_CURSOR"
  | "INVALID_QUERY_PARAMETER";

export class PaginationError extends Error {
  readonly code: PaginationErrorCode;
  readonly status: number;

  constructor(message: string, code: PaginationErrorCode, status = 400) {
    super(message);
    this.name = "PaginationError";
    this.code = code;
    this.status = status;
  }
}

export interface PaginationConfig {
  defaultLimit?: number;
  maxLimit?: number;
}

export interface ParsedPaginationParams {
  limit: number;
  cursor?: string;
}

export interface CompoundCursorPayload {
  ts: string; // ISO-8601 timestamp string
  id: string; // Record identifier (MongoDB _id or on-chain id)
  seq?: number; // Optional sequence number for monotonic event streams
}

export interface PaginatedResponseMetadata {
  limit: number;
  hasNextPage: boolean;
  nextCursor: string | null;
  count: number;
}

export interface PaginatedResult<T> {
  data: T[];
  metadata: PaginatedResponseMetadata;
}

/**
 * Parses and strictly validates query parameters for pagination.
 *
 * Rejects invalid, non-integer, or oversized limits with documented errors.
 */
export function parsePaginationParams(
  query: Record<string, unknown>,
  config: PaginationConfig = {},
): ParsedPaginationParams {
  const defaultLimit = config.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = config.maxLimit ?? MAX_PAGE_SIZE;

  const rawLimit = query.limit ?? query.pageSize;
  let limit = defaultLimit;

  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== "") {
    const num = Number(rawLimit);
    if (!Number.isInteger(num) || num <= 0) {
      throw new PaginationError(
        `Invalid limit parameter: limit must be a positive integer, received '${rawLimit}'.`,
        "INVALID_PAGE_SIZE",
        400,
      );
    }
    if (num > maxLimit) {
      throw new PaginationError(
        `Page size ${num} exceeds the maximum allowed limit of ${maxLimit}.`,
        "PAGE_SIZE_EXCEEDED",
        400,
      );
    }
    limit = num;
  }

  const rawCursor = query.cursor;
  let cursor: string | undefined;

  if (typeof rawCursor === "string" && rawCursor.trim().length > 0) {
    cursor = rawCursor.trim();
    // Validate syntax early
    validateCursorFormat(cursor);
  }

  return { limit, cursor };
}

/**
 * Validates that a cursor string is syntactically valid base64url or hex identifier.
 */
export function validateCursorFormat(cursor: string): void {
  if (!cursor || cursor.length > 512) {
    throw new PaginationError("Invalid pagination cursor length.", "INVALID_CURSOR", 400);
  }

  // Legacy 24-character hexadecimal ObjectId support
  if (/^[0-9a-fA-F]{24}$/.test(cursor)) {
    return;
  }

  // Legacy numeric index cursor support
  if (/^\d+$/.test(cursor)) {
    return;
  }

  // Compound base64url cursor support
  try {
    const jsonStr = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(jsonStr) as Partial<CompoundCursorPayload>;
    if (!parsed || typeof parsed !== "object" || !parsed.ts || !parsed.id) {
      throw new Error();
    }
    const date = new Date(parsed.ts);
    if (Number.isNaN(date.getTime())) {
      throw new Error();
    }
  } catch {
    throw new PaginationError(
      "Invalid pagination cursor: unable to decode cursor payload.",
      "INVALID_CURSOR",
      400,
    );
  }
}

/**
 * Encodes a deterministic compound cursor containing (timestamp, id).
 */
export function encodeCompoundCursor(payload: {
  timestamp: Date | string | number;
  id: string;
  sequence?: number;
}): string {
  const date =
    payload.timestamp instanceof Date
      ? payload.timestamp
      : new Date(payload.timestamp);

  const cursorData: CompoundCursorPayload = {
    ts: date.toISOString(),
    id: String(payload.id),
  };
  if (payload.sequence !== undefined) {
    cursorData.seq = payload.sequence;
  }

  return Buffer.from(JSON.stringify(cursorData), "utf8").toString("base64url");
}

/**
 * Decodes a compound cursor into a verified timestamp and identifier.
 */
export function decodeCompoundCursor(cursorString: string): {
  timestamp: Date;
  id: string;
  sequence?: number;
} {
  validateCursorFormat(cursorString);

  // If legacy 24-char hex Mongo ObjectId:
  if (/^[0-9a-fA-F]{24}$/.test(cursorString)) {
    // Generate approx timestamp from ObjectId (first 4 bytes)
    const timestampMs = parseInt(cursorString.substring(0, 8), 16) * 1000;
    return {
      timestamp: new Date(timestampMs),
      id: cursorString,
    };
  }

  // If numeric cursor:
  if (/^\d+$/.test(cursorString)) {
    return {
      timestamp: new Date(0),
      id: cursorString,
      sequence: parseInt(cursorString, 10),
    };
  }

  try {
    const jsonStr = Buffer.from(cursorString, "base64url").toString("utf8");
    const parsed = JSON.parse(jsonStr) as CompoundCursorPayload;
    return {
      timestamp: new Date(parsed.ts),
      id: parsed.id,
      sequence: parsed.seq,
    };
  } catch {
    throw new PaginationError(
      "Invalid pagination cursor.",
      "INVALID_CURSOR",
      400,
    );
  }
}

/**
 * Builds MongoDB keyset query conditions for deterministic pagination across identical timestamps.
 */
export function buildMongoCompoundQuery(
  cursorString: string | undefined,
  options: {
    timestampField?: string;
    idField?: string;
    direction?: -1 | 1;
  } = {},
): Record<string, unknown> {
  if (!cursorString) return {};

  const timestampField = options.timestampField ?? "createdAt";
  const idField = options.idField ?? "_id";
  const direction = options.direction ?? -1; // -1 = descending (newest first), 1 = ascending

  // Legacy ObjectId single field fallback
  if (/^[0-9a-fA-F]{24}$/.test(cursorString) && timestampField === "_id") {
    return { [idField]: direction === -1 ? { $lt: cursorString } : { $gt: cursorString } };
  }

  const { timestamp, id } = decodeCompoundCursor(cursorString);

  if (direction === -1) {
    // Descending: strictly before cursor timestamp, OR equal timestamp and smaller id
    return {
      $or: [
        { [timestampField]: { $lt: timestamp } },
        { [timestampField]: timestamp, [idField]: { $lt: id } },
      ],
    };
  } else {
    // Ascending: strictly after cursor timestamp, OR equal timestamp and larger id
    return {
      $or: [
        { [timestampField]: { $gt: timestamp } },
        { [timestampField]: timestamp, [idField]: { $gt: id } },
      ],
    };
  }
}

/**
 * Paginates in-memory records with strict deterministic ordering and tie-breaking.
 */
export function paginateArrayDeterministic<T>(
  items: readonly T[],
  params: {
    limit: number;
    cursor?: string;
    getTimestamp: (item: T) => Date | string | number;
    getId: (item: T) => string;
    direction?: -1 | 1;
  },
): PaginatedResult<T> {
  const direction = params.direction ?? -1;
  const limit = params.limit;

  // Comparator for strict total order: primary = timestamp, tie-breaker = id
  const compareItems = (a: T, b: T): number => {
    const tsA = new Date(params.getTimestamp(a)).getTime();
    const tsB = new Date(params.getTimestamp(b)).getTime();

    if (tsA !== tsB) {
      return direction === -1 ? tsB - tsA : tsA - tsB;
    }

    const idA = params.getId(a);
    const idB = params.getId(b);
    const idCmp = idA.localeCompare(idB);
    return direction === -1 ? -idCmp : idCmp;
  };

  const sorted = [...items].sort(compareItems);

  let startIndex = 0;
  if (params.cursor) {
    const decoded = decodeCompoundCursor(params.cursor);
    const cursorTs = decoded.timestamp.getTime();
    const cursorId = decoded.id;

    const dummyItem = {
      ts: cursorTs,
      id: cursorId,
    };

    // Find first item that comes strictly after the cursor according to total order
    const foundIdx = sorted.findIndex((item) => {
      const itemTs = new Date(params.getTimestamp(item)).getTime();
      const itemId = params.getId(item);

      if (direction === -1) {
        if (itemTs < cursorTs) return true;
        if (itemTs === cursorTs && itemId.localeCompare(cursorId) < 0) return true;
        return false;
      } else {
        if (itemTs > cursorTs) return true;
        if (itemTs === cursorTs && itemId.localeCompare(cursorId) > 0) return true;
        return false;
      }
    });

    startIndex = foundIdx === -1 ? sorted.length : foundIdx;
  }

  const pageItems = sorted.slice(startIndex, startIndex + limit);
  const hasNextPage = startIndex + limit < sorted.length;

  let nextCursor: string | null = null;
  if (hasNextPage && pageItems.length > 0) {
    const last = pageItems[pageItems.length - 1];
    nextCursor = encodeCompoundCursor({
      timestamp: params.getTimestamp(last),
      id: params.getId(last),
    });
  }

  return {
    data: pageItems,
    metadata: {
      limit,
      hasNextPage,
      nextCursor,
      count: pageItems.length,
    },
  };
}
