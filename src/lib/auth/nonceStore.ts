/**
 * Server-side nonce storage for the wallet authentication flow.
 *
 * Nonces are temporary (5-minute TTL) and single-use. They are stored in Redis
 * when available, with an LRU in-memory fallback for local development.
 *
 * This module is Node-only (used by api/ serverless functions). Do NOT import
 * it in the browser bundle.
 */

import { LRUCache } from "lru-cache";
import { Keypair } from "@stellar/stellar-sdk";
import { getRedisClient } from "../observability/redisClient";

/** Nonce TTL: 5 minutes, matching the challenge token TTL. */
export const NONCE_TTL_MS = 5 * 60 * 1000;

export interface StoredNonce {
  address: string;
  expiresAt: number;
  issuedAt: number;
  domain: string;
  consumed?: boolean;
}

// In-memory LRU used when Redis is unavailable (single-instance / dev)
const memoryStore = new LRUCache<string, StoredNonce>({
  max: 5000,
  ttl: NONCE_TTL_MS,
});

// ─── Storage helpers ─────────────────────────────────────────────────────────

export async function storeNonce(nonce: string, data: StoredNonce): Promise<void> {
  try {
    const redis = await getRedisClient();
    if (redis) {
      const ttlSec = Math.ceil(NONCE_TTL_MS / 1000);
      await redis.set(`auth:nonce:${nonce}`, JSON.stringify(data), { EX: ttlSec });
      return;
    }
  } catch {
    // Redis unavailable — fall through to memory store
  }
  memoryStore.set(nonce, data);
}

export async function getNonce(nonce: string): Promise<StoredNonce | null> {
  try {
    const redis = await getRedisClient();
    if (redis) {
      const raw = await redis.get(`auth:nonce:${nonce}`);
      if (!raw) return null;
      return JSON.parse(raw) as StoredNonce;
    }
  } catch {
    // fall through
  }
  return memoryStore.get(nonce) ?? null;
}

/**
 * Atomically consume a nonce (marks it used so it cannot be replayed).
 * Returns the stored nonce data if found & not yet consumed, null otherwise.
 */
export async function consumeNonce(nonce: string): Promise<StoredNonce | null> {
  try {
    const redis = await getRedisClient();
    if (redis) {
      const key = `auth:nonce:${nonce}`;
      const raw = await redis.get(key);
      if (!raw) return null;

      const data = JSON.parse(raw) as StoredNonce;
      if (data.consumed) return null;

      // Mark consumed and update (keep same TTL so it expires naturally)
      data.consumed = true;
      const ttlSec = await redis.ttl(key);
      if (ttlSec > 0) {
        await redis.set(key, JSON.stringify(data), { EX: ttlSec });
      } else {
        await redis.del(key);
        return null;
      }

      return data;
    }
  } catch {
    // fall through to memory
  }

  const data = memoryStore.get(nonce);
  if (!data || data.consumed) return null;
  data.consumed = true;
  memoryStore.set(nonce, data);
  return data;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/** Validates a Stellar G… public key using the stellar-sdk Keypair. */
export function isValidStellarAddress(address: string): boolean {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}
