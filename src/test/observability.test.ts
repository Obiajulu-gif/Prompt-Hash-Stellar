import { describe, it, expect, vi } from "vitest";
import { checkRateLimit } from "../lib/observability/rateLimiter";
import { logger } from "../lib/observability/logger";

// Deterministic in-memory Redis fake so the limiter exercises the redisCheck
// path (the same code path used in production) without needing a live server.
vi.mock("../lib/observability/redisClient", () => {
  const store = new Map<string, number>();
  const fakeRedis = {
    multi() {
      let incrKey = "";
      const api: any = {
        _ops: [] as Array<() => void>,
        incr: (k: string) => {
          incrKey = k;
          api._ops.push(() => store.set(k, (store.get(k) ?? 0) + 1));
          return api;
        },
        expire: () => {
          api._ops.push(() => undefined);
          return api;
        },
        exec: async () => {
          api._ops.forEach((op: () => void) => op());
          const count = store.get(incrKey) ?? 0;
          return [count];
        },
        ttl: async () => -1,
      };
      return api;
    },
    ttl: async () => -1,
  };
  return {
    getRedisClient: vi.fn().mockResolvedValue(fakeRedis),
    closeRedisClient: vi.fn(),
  };
});

describe("Observability Utilities", () => {
  describe("Rate Limiter", () => {
    it("should allow requests within limit", async () => {
      const result = await checkRateLimit("challenge", "test-ip-1", false);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(4); // max (5) - 1
    });

    it("should block requests exceeding limit", async () => {
      // Send 5 requests to consume the limit
      for (let i = 0; i < 5; i++) {
        await checkRateLimit("challenge", "test-ip-2", false);
      }
      const result = await checkRateLimit("challenge", "test-ip-2", false);
      expect(result.success).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("rate limits by IP (unauthenticated unlock bucket)", async () => {
      for (let i = 0; i < 3; i++) {
        await checkRateLimit("unlock", "ip-1", false);
      }
      const result = await checkRateLimit("unlock", "ip-1", false);
      expect(result.success).toBe(false);
    });

    it("rate limits by wallet (authenticated unlock bucket)", async () => {
      for (let i = 0; i < 5; i++) {
        await checkRateLimit("unlock", "wallet-1", true);
      }
      const result = await checkRateLimit("unlock", "wallet-1", true);
      expect(result.success).toBe(false);
    });

    describe("issue #700 composite (buyer/prompt/failure) throttling", () => {
      it("treats distinct prompt scopes as independent buckets", async () => {
        const a = await checkRateLimit("unlock", "buyer-x", true, { scope: "prompt:1" });
        const b = await checkRateLimit("unlock", "buyer-x", true, { scope: "prompt:2" });
        expect(a.success).toBe(true);
        expect(b.success).toBe(true);
      });

      it("applies maxOverride to a composite buyer+prompt bucket", async () => {
        const first = await checkRateLimit("unlock", "buyer-y", true, {
          scope: "prompt:9",
          maxOverride: 1,
          windowOverride: 60_000,
        });
        expect(first.success).toBe(true);
        const second = await checkRateLimit("unlock", "buyer-y", true, {
          scope: "prompt:9",
          maxOverride: 1,
          windowOverride: 60_000,
        });
        expect(second.success).toBe(false);
        expect(second.remaining).toBe(0);
      });

      it("throttles failure reasons independently for the same prompt", async () => {
        const noAccess = await checkRateLimit("unlock", "buyer-z", true, {
          scope: "prompt:5:reason:no_access",
          maxOverride: 2,
          windowOverride: 60_000,
        });
        const ledger = await checkRateLimit("unlock", "buyer-z", true, {
          scope: "prompt:5:reason:ledger_verification_failed",
          maxOverride: 2,
          windowOverride: 60_000,
        });
        expect(noAccess.success).toBe(true);
        expect(ledger.success).toBe(true);
      });
    });
  });

  describe("Logger", () => {
    it("should be configured with correct level", () => {
      expect(logger.level).toBe("silent"); // Since we set NODE_ENV=test
    });
  });
});
