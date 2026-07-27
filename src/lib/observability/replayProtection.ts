import { getRedisClient } from "./redisClient";
import { LRUCache } from "lru-cache";

interface ReplayCheckConfig {
  ttlMs: number;
}

const defaultConfig: ReplayCheckConfig = {
  ttlMs: 10 * 60 * 1000,
};

const fallbackCache = new LRUCache<string, boolean>({
  max: 10000,
  ttl: defaultConfig.ttlMs,
});

function computeSignatureHash(token: string, signedMessage: string): string {
  return `${token}:${signedMessage}`;
}

async function redisCheckAndStore(
  redis: Awaited<ReturnType<typeof getRedisClient>>,
  signatureHash: string,
  config: ReplayCheckConfig,
): Promise<boolean> {
  const key = `replay:${signatureHash}`;
  const ttlSec = Math.ceil(config.ttlMs / 1000);

  const multi = redis!.multi();
  multi.setNX(key, "1");
  multi.expire(key, ttlSec, "NX");
  const [wasSet] = (await multi.exec()) as [number, ...unknown[]];

  return wasSet === 1;
}

function inMemoryCheckAndStore(
  signatureHash: string,
  _config: ReplayCheckConfig,
): boolean {
  if (fallbackCache.has(signatureHash)) {
    return false;
  }
  fallbackCache.set(signatureHash, true);
  return true;
}

export async function checkReplayProtection(
  token: string,
  signedMessage: string,
  config: Partial<ReplayCheckConfig> = {},
): Promise<{ valid: boolean; reason?: string }> {
  const finalConfig = { ...defaultConfig, ...config };
  const signatureHash = computeSignatureHash(token, signedMessage);

  try {
    const redis = await getRedisClient();
    if (redis) {
      const isValid = await redisCheckAndStore(redis, signatureHash, finalConfig);
      if (!isValid) {
        return { valid: false, reason: "replay_detected" };
      }
      return { valid: true };
    }
  } catch {
    // Redis unavailable — fall back to in-memory.
  }

  const isValid = inMemoryCheckAndStore(signatureHash, finalConfig);
  if (!isValid) {
    return { valid: false, reason: "replay_detected" };
  }
  return { valid: true };
}
