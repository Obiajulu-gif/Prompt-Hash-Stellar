import { createHash } from "crypto";
import { getRedisClient } from "./redisClient";
import { LRUCache } from "lru-cache";

export interface IdempotencyRecord {
  requestHash: string;
  statusCode: number;
  responseData: unknown;
}

export interface IdempotencyCheckResult {
  status: "new" | "cached" | "conflict";
  statusCode?: number;
  responseData?: unknown;
}

const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

const fallbackCache = new LRUCache<string, IdempotencyRecord>({
  max: 5000,
  ttl: IDEMPOTENCY_TTL_MS,
});

/**
 * Compute a canonical hash of the unlock request fields (excluding the
 * idempotencyKey itself) so we can detect conflicting reuse.
 */
export function computeRequestHash(
  token: string,
  promptId: string,
  address: string,
  signedMessage: string,
): string {
  const canonical = `${token}:${promptId}:${address}:${signedMessage}`;
  return createHash("sha256").update(canonical).digest("hex");
}

async function redisCheck(
  idempotencyKey: string,
  requestHash: string,
): Promise<IdempotencyCheckResult | null> {
  const redis = await getRedisClient();
  if (!redis) return null;

  const key = `idempotent:${idempotencyKey}`;
  const raw = await redis.get(key);
  if (!raw) return null;

  let record: IdempotencyRecord;
  try {
    record = JSON.parse(raw) as IdempotencyRecord;
  } catch {
    return null;
  }

  if (record.requestHash === requestHash) {
    return { status: "cached", statusCode: record.statusCode, responseData: record.responseData };
  }
  return { status: "conflict" };
}

function inMemoryCheck(
  idempotencyKey: string,
  requestHash: string,
): IdempotencyCheckResult | null {
  const record = fallbackCache.get(idempotencyKey);
  if (!record) return null;

  if (record.requestHash === requestHash) {
    return { status: "cached", statusCode: record.statusCode, responseData: record.responseData };
  }
  return { status: "conflict" };
}

async function redisStore(
  idempotencyKey: string,
  record: IdempotencyRecord,
): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;

  const key = `idempotent:${idempotencyKey}`;
  const ttlSec = Math.ceil(IDEMPOTENCY_TTL_MS / 1000);
  await redis.setEx(key, ttlSec, JSON.stringify(record));
}

function inMemoryStore(
  idempotencyKey: string,
  record: IdempotencyRecord,
): void {
  fallbackCache.set(idempotencyKey, record);
}

/**
 * Check whether an idempotency key has been used before.
 *
 * Returns the check result — the caller should:
 * - `"new"`: proceed with processing and call `storeIdempotencyResult` on completion.
 * - `"cached"`: return the stored result immediately.
 * - `"conflict"`: reject with a 409 error.
 */
export async function checkIdempotency(
  idempotencyKey: string,
  token: string,
  promptId: string,
  address: string,
  signedMessage: string,
): Promise<IdempotencyCheckResult> {
  const requestHash = computeRequestHash(token, promptId, address, signedMessage);

  // Try Redis first, fall back to in-memory.
  const redisResult = await redisCheck(idempotencyKey, requestHash);
  if (redisResult) return redisResult;

  const memResult = inMemoryCheck(idempotencyKey, requestHash);
  if (memResult) return memResult;

  return { status: "new" };
}

/**
 * Store the result of an unlock request so that retries with the same
 * idempotency key return the cached response.
 */
export async function storeIdempotencyResult(
  idempotencyKey: string,
  token: string,
  promptId: string,
  address: string,
  signedMessage: string,
  statusCode: number,
  responseData: unknown,
): Promise<void> {
  const requestHash = computeRequestHash(token, promptId, address, signedMessage);
  const record: IdempotencyRecord = { requestHash, statusCode, responseData };

  await redisStore(idempotencyKey, record).catch(() => {});
  inMemoryStore(idempotencyKey, record);
}

/**
 * Clear the in-memory idempotency cache. Intended for test teardown.
 */
export function clearIdempotencyCache(): void {
  fallbackCache.clear();
}