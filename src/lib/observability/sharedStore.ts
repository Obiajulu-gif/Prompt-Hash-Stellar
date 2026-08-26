import { createHash } from "crypto";
import { getRedisClient } from "./redisClient";

const PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Atomic shared storage for nonces and idempotency records.
 *
 * Uses Redis SETNX with TTL for atomic consume-if-absent semantics.
 * In production, fails CLOSED — if Redis is unreachable, the operation
 * is rejected rather than falling back to in-memory storage.
 */
export class SharedStore {
  private readonly prefix: string;
  private readonly defaultTtlMs: number;

  constructor(prefix: string, defaultTtlMs: number) {
    this.prefix = prefix;
    this.defaultTtlMs = defaultTtlMs;
  }

  private key(suffix: string): string {
    return `${this.prefix}:${suffix}`;
  }

  /**
   * Atomically consume a value if it has not been seen before (SETNX).
   *
   * Returns `true` if the value was successfully consumed (first time).
   * Returns `false` if the value was already consumed.
   *
   * In production, throws if Redis is unavailable (fail-closed).
   * In development/test, falls back to in-memory for convenience.
   */
  async consume(keySuffix: string, ttlMs?: number): Promise<boolean> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const ttlSec = Math.ceil(ttl / 1000);

    try {
      const redis = await getRedisClient();
      if (!redis) {
        if (PRODUCTION) {
          throw new Error(
            `[SharedStore] Redis unavailable in production — rejecting request (prefix=${this.prefix})`
          );
        }
        return this.fallbackConsume(keySuffix, ttl);
      }

      const multi = redis.multi();
      multi.setNX(this.key(keySuffix), "1");
      multi.expire(this.key(keySuffix), ttlSec, "NX");
      const [wasSet] = (await multi.exec()) as [number, ...unknown[]];
      return wasSet === 1;
    } catch (err) {
      if (PRODUCTION) {
        throw err;
      }
      return this.fallbackConsume(keySuffix, ttl);
    }
  }

  /**
   * Check if a key has been consumed, without consuming it.
   */
  async isConsumed(keySuffix: string): Promise<boolean> {
    try {
      const redis = await getRedisClient();
      if (!redis) {
        if (PRODUCTION) {
          throw new Error(
            `[SharedStore] Redis unavailable in production — rejecting request (prefix=${this.prefix})`
          );
        }
        return this.fallbackCache.has(keySuffix);
      }

      const exists = await redis.exists(this.key(keySuffix));
      return exists === 1;
    } catch (err) {
      if (PRODUCTION) {
        throw err;
      }
      return this.fallbackCache.has(keySuffix);
    }
  }

  /**
   * Read a stored value from the shared store.
   */
  async get<T>(keySuffix: string): Promise<T | null> {
    try {
      const redis = await getRedisClient();
      if (!redis) {
        if (PRODUCTION) {
          throw new Error(
            `[SharedStore] Redis unavailable in production — rejecting request (prefix=${this.prefix})`
          );
        }
        const val = this.fallbackValues.get(keySuffix);
        return val ? (JSON.parse(val) as T) : null;
      }

      const raw = await redis.get(this.key(keySuffix));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      if (PRODUCTION) {
        throw err;
      }
      const val = this.fallbackValues.get(keySuffix);
      return val ? (JSON.parse(val) as T) : null;
    }
  }

  /**
   * Store a value in the shared store with a TTL.
   */
  async set<T>(keySuffix: string, value: T): Promise<void> {
    const ttlSec = Math.ceil(this.defaultTtlMs / 1000);

    try {
      const redis = await getRedisClient();
      if (!redis) {
        if (PRODUCTION) {
          throw new Error(
            `[SharedStore] Redis unavailable in production — rejecting request (prefix=${this.prefix})`
          );
        }
        this.fallbackValues.set(keySuffix, JSON.stringify(value));
        return;
      }

      await redis.setEx(this.key(keySuffix), ttlSec, JSON.stringify(value));
    } catch (err) {
      if (PRODUCTION) {
        throw err;
      }
      this.fallbackValues.set(keySuffix, JSON.stringify(value));
    }
  }

  /**
   * Delete a key from the shared store.
   */
  async del(keySuffix: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.del(this.key(keySuffix));
      }
    } catch {
      // Silently ignore in development
    }
    this.fallbackValues.delete(keySuffix);
    this.fallbackCache.delete(keySuffix);
  }

  // ── In-memory fallback (dev/test only) ──────────────────────────────────────
  private readonly fallbackCache = new Set<string>();
  private readonly fallbackValues = new Map<string, string>();
  private readonly fallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private fallbackConsume(keySuffix: string, ttlMs: number): boolean {
    if (this.fallbackCache.has(keySuffix)) {
      return false;
    }
    this.fallbackCache.add(keySuffix);

    // Auto-evict after TTL
    const timer = setTimeout(() => {
      this.fallbackCache.delete(keySuffix);
      this.fallbackValues.delete(keySuffix);
      this.fallbackTimers.delete(keySuffix);
    }, ttlMs);
    if (timer.unref) timer.unref();
    this.fallbackTimers.set(keySuffix, timer);

    return true;
  }

  clear(): void {
    this.fallbackCache.clear();
    this.fallbackValues.clear();
    for (const timer of this.fallbackTimers.values()) {
      clearTimeout(timer);
    }
    this.fallbackTimers.clear();
  }
}

export function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Singleton stores
export const nonceStore = new SharedStore("nonce", 10 * 60 * 1000);
export const idempotencyStore = new SharedStore("idempotent", 60 * 60 * 1000);
export const replayStore = new SharedStore("replay", 10 * 60 * 1000);
