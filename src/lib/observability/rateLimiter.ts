import { LRUCache } from "lru-cache";
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
    unauthenticated: {
      max: Number(process.env.RATE_LIMIT_UNLOCK_IP_MAX) || 3,
      windowMs: Number(process.env.RATE_LIMIT_UNLOCK_IP_WINDOW_MS || process.env.RATE_LIMIT_UNLOCK_WINDOW_MS) || 60_000,
    },
    authenticated: {
      max: Number(process.env.RATE_LIMIT_UNLOCK_WALLET_MAX || process.env.RATE_LIMIT_UNLOCK_IDENTITY_MAX) || 5,
      windowMs: Number(process.env.RATE_LIMIT_UNLOCK_WALLET_WINDOW_MS || process.env.RATE_LIMIT_UNLOCK_WINDOW_MS) || 60_000,
    },
    classification: "security", // Unlock — payment-gated, must not be bypassed
  },
  hash_lookup: {
    unauthenticated: {
      max: Number(process.env.RATE_LIMIT_HASH_LOOKUP_IP_MAX) || 30,
      windowMs: Number(process.env.RATE_LIMIT_HASH_LOOKUP_IP_WINDOW_MS || process.env.RATE_LIMIT_HASH_LOOKUP_WINDOW_MS) || 60_000,
    },
    authenticated: {
      max: Number(process.env.RATE_LIMIT_HASH_LOOKUP_IDENTITY_MAX) || 60,
      windowMs: Number(process.env.RATE_LIMIT_HASH_LOOKUP_IDENTITY_WINDOW_MS || process.env.RATE_LIMIT_HASH_LOOKUP_WINDOW_MS) || 60_000,
    },
    classification: "best-effort",
  },
};

// In-memory LRU fallback for best-effort controls only.
const fallbackCaches = new Map<string, LRUCache<string, number>>();
const cooldownStore = new Map<string, number>();
const burstStore = new Map<string, { count: number; resetAt: number }>();

function getFallbackCache(key: string, config: RateLimitConfig) {
  if (!fallbackCaches.has(key)) {
    fallbackCaches.set(key, new LRUCache<string, number>({ max: 1000, ttl: config.windowMs }));
  }
  return fallbackCaches.get(key)!;
}

/**
 * Optional overrides for composite (buyer/prompt/failure) throttling,
 * burst control, cooldowns, and trusted internal calls (#1093).
 */
export interface ScopedRateLimitOptions {
  scope?: string;
  maxOverride?: number;
  windowOverride?: number;
  burstMax?: number;
  burstWindowMs?: number;
  cooldownMs?: number;
  isTrusted?: boolean;
}

export interface RateLimitCheckResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
  cooldownActive?: boolean;
  reason?: string;
}

export function resetRateLimits(key?: string): void {
  if (key) {
    cooldownStore.delete(key);
    burstStore.delete(key);
    fallbackCaches.delete(key);
  } else {
    cooldownStore.clear();
    burstStore.clear();
    fallbackCaches.clear();
  }
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
  type: "challenge" | "unlock" | "hash_lookup" | string,
  identifier: string,
  authenticated = false,
  options: ScopedRateLimitOptions = {},
): Promise<RateLimitCheckResult> {
  // 1. Trusted internal caller bypass (#1093)
  if (options.isTrusted === true) {
    return {
      success: true,
      limit: Infinity,
      remaining: Infinity,
      reset: 0,
    };
  }

  const entry = limits[type] ?? {
    authenticated: { max: 10, windowMs: 60_000 },
    unauthenticated: { max: 5, windowMs: 60_000 },
    classification: "best-effort" as ControlClassification,
  };
  const baseConfig = entry[authenticated ? "authenticated" : "unauthenticated"];

  const config: RateLimitConfig = {
    max: options.maxOverride ?? baseConfig.max,
    windowMs: options.windowOverride ?? baseConfig.windowMs,
  };
  const bucketKey = `${type}:${identifier}${options.scope ? `:${options.scope}` : ""}`;
  const now = Date.now();

  // 2. Cooldown check (#1093)
  const cooldownUntil = cooldownStore.get(bucketKey);
  if (cooldownUntil && now < cooldownUntil) {
    const remainingCooldown = cooldownUntil - now;
    return {
      success: false,
      limit: config.max,
      remaining: 0,
      reset: remainingCooldown,
      retryAfter: Math.ceil(remainingCooldown / 1000),
      cooldownActive: true,
      reason: "cooldown_active",
    };
  } else if (cooldownUntil) {
    cooldownStore.delete(bucketKey);
  }

  // 3. Burst limit check (#1093)
  if (options.burstMax && options.burstWindowMs) {
    const burstEntry = burstStore.get(bucketKey);
    if (!burstEntry || now > burstEntry.resetAt) {
      burstStore.set(bucketKey, { count: 1, resetAt: now + options.burstWindowMs });
    } else {
      burstEntry.count += 1;
      if (burstEntry.count > options.burstMax) {
        const cooldownMs = options.cooldownMs || options.burstWindowMs;
        cooldownStore.set(bucketKey, now + cooldownMs);
        return {
          success: false,
          limit: options.burstMax,
          remaining: 0,
          reset: cooldownMs,
          retryAfter: Math.ceil(cooldownMs / 1000),
          cooldownActive: true,
          reason: "burst_limit_exceeded",
        };
      }
    }
  }

  // 4. Standard window check
  let checkResult: { success: boolean; limit: number; remaining: number; reset: number };
  let redisAvailable = false;
  try {
    const redis = await getRedisClient();
    if (redis) {
      redisAvailable = true;
      checkResult = await redisCheck(redis, bucketKey, config);
    } else {
      checkResult = inMemoryCheck(bucketKey, config);
    }
  } catch {
    if (entry.classification === "security" && !redisAvailable) {
      checkResult = failClosedResult(type);
    } else {
      checkResult = inMemoryCheck(bucketKey, config);
    }
  }

  if (!checkResult.success) {
    if (options.cooldownMs && options.cooldownMs > 0) {
      cooldownStore.set(bucketKey, now + options.cooldownMs);
    }
    const retryAfter = Math.ceil(
      Math.max(checkResult.reset, options.cooldownMs ?? 0) / 1000,
    );
    return {
      ...checkResult,
      retryAfter,
      reason: "rate_limit_exceeded",
    };
  }

  return checkResult;
}
