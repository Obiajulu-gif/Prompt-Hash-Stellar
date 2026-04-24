import LRUCache from "lru-cache";

interface RateLimitConfig {
  max: number;      // Maximum requests in the window
  windowMs: number; // Time window in milliseconds
}

const defaultLimits: Record<string, RateLimitConfig> = {
  challenge: { max: 10, windowMs: 60 * 1000 }, // 10 requests per minute
  unlock: { max: 5, windowMs: 60 * 1000 },    // 5 requests per minute
};

const caches = new Map<string, LRUCache<string, number>>();

function getCache(key: string, config: RateLimitConfig) {
  if (!caches.has(key)) {
    caches.set(
      key,
      new LRUCache<string, number>({
        max: 1000, // Max unique keys (IPs/Wallets) to track
        ttl: config.windowMs,
      })
    );
  }
  return caches.get(key)!;
}

export function checkRateLimit(
  type: "challenge" | "unlock",
  identifier: string,
  configOverrides?: Partial<RateLimitConfig>
): { success: boolean; limit: number; remaining: number; reset: number } {
  const config = { ...defaultLimits[type], ...configOverrides };
  const cache = getCache(type, config);

  const current = cache.get(identifier) || 0;
  const remaining = Math.max(0, config.max - (current + 1));

  if (current >= config.max) {
    return {
      success: false,
      limit: config.max,
      remaining: 0,
      reset: config.windowMs, // Rough estimate
    };
  }

  cache.set(identifier, current + 1);

  return {
    success: true,
    limit: config.max,
    remaining,
    reset: config.windowMs,
  };
}
