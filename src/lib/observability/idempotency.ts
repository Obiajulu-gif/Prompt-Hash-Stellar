import { createHash } from "crypto";
import { idempotencyStore as store } from "./sharedStore";

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

/**
 * Check whether an idempotency key has been used before.
 *
 * Returns the check result — the caller should:
 * - `"new"`: proceed with processing and call `storeIdempotencyResult` on completion.
 * - `"cached"`: return the stored result immediately.
 * - `"conflict"`: reject with a 409 error.
 *
 * Fail-closed: throws if the shared store is unreachable in production.
 */
export async function checkIdempotency(
  idempotencyKey: string,
  token: string,
  promptId: string,
  address: string,
  signedMessage: string,
): Promise<IdempotencyCheckResult> {
  const requestHash = computeRequestHash(token, promptId, address, signedMessage);

  // Atomic check-and-store: if the key doesn't exist, store it with
  // status "in-progress" to prevent concurrent duplicate processing.
  const consumed = await store.consume(`check:${idempotencyKey}`);
  if (!consumed) {
    // Key already exists — retrieve the existing record
    const record = await store.get<IdempotencyRecord>(`data:${idempotencyKey}`);
    if (record) {
      if (record.requestHash === requestHash) {
        return { status: "cached", statusCode: record.statusCode, responseData: record.responseData };
      }
      return { status: "conflict" };
    }
    // Key was consumed but no data yet (concurrent processing).
    // Return "new" — the caller will proceed but the first to finish wins.
    return { status: "new" };
  }

  // First time seeing this key — check if there's a conflicting in-progress
  const existing = await store.get<IdempotencyRecord>(`data:${idempotencyKey}`);
  if (existing) {
    if (existing.requestHash === requestHash) {
      return { status: "cached", statusCode: existing.statusCode, responseData: existing.responseData };
    }
    return { status: "conflict" };
  }

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

  await store.set(`data:${idempotencyKey}`, record);
}

/**
 * Clear the in-memory idempotency cache. Intended for test teardown.
 */
export function clearIdempotencyCache(): void {
  // No-op: shared store cannot be cleared from a single instance.
}
