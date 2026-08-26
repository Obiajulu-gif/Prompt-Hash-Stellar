import LRUCache from "lru-cache";
import { getRedisClient } from "./redisClient";

interface RateLimitConfig {
  max: number;
  windowMs: number;
}

/**
 * Classification: 'security' controls fail closed when Redis is unavailable.
 * 'best-effort' controls degrade to in-memory.
 */
type ControlClassification = "security" | "best-effort";

const limits: Record<
  string,
  {
    authenticated: RateLimitConfig;
    unauthenticated: RateLimitConfig;
    classification: ControlClassification;
  }
> = {
  challenge: {
    unauthenticated: { max: 5, windowMs: 60_000 },
    authenticated: { max: 10, windowMs: 60_000 },
    classification: "security", // Challenge tokens — replay protection is security-critical
  },
  unlock: {
    unauthenticated: { max: 3, windowMs: 60_000 },
    authenticated: { max: 5, windowMs: 60_000 },
    classification: "security", // Unlock — payment-gated, must not be bypassed
  },
};

// In-memory LRU fallback for best-effort controls only.
const fallbackCaches = new Map<string, LRUCache<string, number>>();

function getFallbackCache(key: string, config: RateLimitConfig) {
  if (!fallbackCaches.has(key)) {
    fallbackCaches.set(key, new LRUCache<string, number>({ max: 1000, ttl: config.windowMs }));
  }
  return fallbackCaches.get(key)!;
}

function inMemoryCheck(
  bucketKey: string,
  config: RateLimitConfig,
): { success: boolean; limit: number; remaining: number; reset: number } {
  const cache = getFallbackCache(bucketKey, config);
  const current = cache.get(bucketKey) ?? 0;
  const remaining = Math.max(0, config.max - (current + 1));
  if (current >= config.max) {
    return { success: false, limit: config.max, remaining: 0, reset: config.windowMs };
  }
  cache.set(bucketKey, current + 1);
  return { success: true, limit: config.max, remaining, reset: config.windowMs };
}

async function redisCheck(
  redis: Awaited<ReturnType<typeof getRedisClient>>,
  bucketKey: string,
  config: RateLimitConfig,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const key = `rl:${bucketKey}`;
  const windowSec = Math.ceil(config.windowMs / 1000);

  const multi = redis!.multi();
  multi.incr(key);
  multi.expire(key, windowSec, "NX");
  const [count] = (await multi.exec()) as [number, ...unknown[]];

  const ttlSec = await redis!.ttl(key);
  const reset = ttlSec > 0 ? ttlSec * 1000 : config.windowMs;

  if (count > config.max) {
    return { success: false, limit: config.max, remaining: 0, reset };
  }
  return { success: true, limit: config.max, remaining: Math.max(0, config.max - count), reset };
}

function failClosedResult(type: string): {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
} {
  console.warn(
    `[rateLimiter] Redis unavailable for security-critical control "${type}" — failing closed`,
  );
  return { success: false, limit: 0, remaining: 0, reset: 0 };
}

export async function checkRateLimit(
  type: "challenge" | "unlock",
  identifier: string,
  authenticated = false,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const entry = limits[type];
  const config = entry[authenticated ? "authenticated" : "unauthenticated"];
  const bucketKey = `${type}:${identifier}`;

  let redisAvailable = false;
  try {
    const redis = await getRedisClient();
    if (redis) {
      redisAvailable = true;
      return await redisCheck(redis, bucketKey, config);
    }
  } catch {
    // Redis connection error
  }

  // Redis unavailable
  if (entry.classification === "security") {
    return failClosedResult(type);
  }
  return inMemoryCheck(bucketKey, config);
}
