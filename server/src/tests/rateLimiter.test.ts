import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  rateLimit,
  publishLimiter,
  purchaseLimiter,
  reviewLimiter,
  reportLimiter,
  getBlockedRateLimitEvents,
  resetRateLimits,
  isLegitimateWebhook,
  isTrustedInternalCall,
  createOperationRateLimiter,
  hashLookupLimiter,
  unlockLimiter,
  HASH_LOOKUP_LIMITS,
  UNLOCK_LIMITS,
  emitRateLimitMetric,
  getRateLimitMetrics,
  clearRateLimitMetrics,
  hashSubjectIdentifier,
} from "../middleware/rateLimiter";

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" } as any,
    headers: {},
    path: "/api/test",
    originalUrl: "/api/test",
    method: "GET",
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function mockResponse(): Response {
  const res: any = {};
  res.headers = {} as Record<string, any>;
  res.setHeader = vi.fn((key: string, val: any) => {
    res.headers[key.toLowerCase()] = val;
    return res;
  });
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((data: any) => {
    res.body = data;
    return res;
  });
  return res as Response;
}

describe("Core Marketplace Action Rate Limiting (#Task1)", () => {
  beforeEach(() => {
    resetRateLimits();
    clearRateLimitMetrics();
  });

  it("handles burst attempts and returns 429 with Retry-After when limit is exceeded", () => {
    const limiter = rateLimit({
      actionName: "test_burst",
      windowMs: 60 * 1000,
      maxRequests: 3,
      message: "Too many requests.",
    });

    const req = mockRequest({ ip: "192.168.1.100" });
    const next = vi.fn();

    // 3 requests within limit
    for (let i = 0; i < 3; i++) {
      const res = mockResponse();
      limiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(i + 1);
    }

    // 4th request exceeds limit
    const res4 = mockResponse();
    limiter(req, res4, next);
    expect(next).toHaveBeenCalledTimes(3); // Not called 4th time
    expect(res4.status).toHaveBeenCalledWith(429);
    expect(res4.body).toMatchObject({
      error: "Rate limit exceeded.",
      code: "RATE_LIMIT_EXCEEDED",
      action: "test_burst",
      limit: 3,
    });
    expect(res4.body.retryAfter).toBeGreaterThan(0);
    expect(res4.headers["retry-after"]).toBeDefined();
  });

  it("records blocked actions for admin observability", () => {
    const limiter = rateLimit({
      actionName: "publish",
      windowMs: 60 * 1000,
      maxRequests: 1,
    });

    const req = mockRequest({ ip: "10.0.0.1", path: "/api/prompts/publish", originalUrl: "/api/prompts/publish" });
    const next = vi.fn();

    // 1st request ok
    limiter(req, mockResponse(), next);

    // 2nd request blocked
    limiter(req, mockResponse(), next);

    const observabilityData = getBlockedRateLimitEvents({ action: "publish" });
    expect(observabilityData.total).toBe(1);
    expect(observabilityData.events[0]).toMatchObject({
      action: "publish",
      path: "/api/prompts/publish",
      limit: 1,
    });
  });

  it("bypasses rate limits for legitimate webhooks", () => {
    const reqWebhook = mockRequest({
      path: "/api/webhooks",
      headers: { "x-webhook-signature": "sig_valid_123" },
    });

    expect(isLegitimateWebhook(reqWebhook)).toBe(true);

    const limiter = rateLimit({
      actionName: "purchase",
      windowMs: 60 * 1000,
      maxRequests: 1,
    });

    const next = vi.fn();
    // 5 requests with valid webhook header should all succeed
    for (let i = 0; i < 5; i++) {
      limiter(reqWebhook, mockResponse(), next);
    }

    expect(next).toHaveBeenCalledTimes(5);
  });

  it("enforces configured limits for core marketplace actions", () => {
    expect(publishLimiter).toBeDefined();
    expect(purchaseLimiter).toBeDefined();
    expect(reviewLimiter).toBeDefined();
    expect(reportLimiter).toBeDefined();
  });
});

describe("Hash Lookup and Unlock Rate Limiting and Abuse Controls (#1093)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetRateLimits();
    clearRateLimitMetrics();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Bursts", () => {
    it("permits requests within burst limit and throttles subsequent burst requests with 429", () => {
      const limiter = createOperationRateLimiter({
        operation: "hash_lookup",
        ipMax: 20,
        ipWindowMs: 60 * 1000,
        burstMax: 3,
        burstWindowMs: 5 * 1000,
        cooldownMs: 30 * 1000,
      });

      const req = mockRequest({ ip: "198.51.100.1" });
      const next = vi.fn();

      // 3 requests within burst limit succeed
      for (let i = 0; i < 3; i++) {
        const res = mockResponse();
        limiter(req, res, next);
        expect(next).toHaveBeenCalledTimes(i + 1);
        expect(res.headers["x-ratelimit-limit"]).toBe(20);
      }

      // 4th request exceeds burst limit (3)
      const resThrottled = mockResponse();
      limiter(req, resThrottled, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(resThrottled.status).toHaveBeenCalledWith(429);
      expect(resThrottled.body).toMatchObject({
        error: "Rate limit exceeded.",
        code: "RATE_LIMIT_EXCEEDED",
        action: "hash_lookup",
        limit: 3,
      });
      expect(resThrottled.headers["retry-after"]).toBeDefined();
      expect(resThrottled.headers["x-ratelimit-remaining"]).toBe(0);
    });

    it("enforces burst limits for unlock operation", () => {
      const limiter = createOperationRateLimiter({
        operation: "unlock",
        ipMax: 5,
        ipWindowMs: 60 * 1000,
        burstMax: 2,
        burstWindowMs: 5 * 1000,
        cooldownMs: 30 * 1000,
      });

      const req = mockRequest({ ip: "198.51.100.2" });
      const next = vi.fn();

      limiter(req, mockResponse(), next);
      limiter(req, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(2);

      const resBurst = mockResponse();
      limiter(req, resBurst, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(resBurst.status).toHaveBeenCalledWith(429);
      expect(resBurst.body.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(resBurst.body.action).toBe("unlock");
    });
  });

  describe("Cooldowns", () => {
    it("activates cooldown upon limit violation and rejects further requests while cooldown is active", () => {
      vi.useFakeTimers();
      const startTime = 1_700_000_000_000;
      vi.setSystemTime(startTime);

      const limiter = createOperationRateLimiter({
        operation: "hash_lookup",
        ipMax: 2,
        ipWindowMs: 60 * 1000,
        cooldownMs: 45 * 1000,
      });

      const req = mockRequest({ ip: "198.51.100.10" });
      const next = vi.fn();

      // Request 1 and 2 pass
      limiter(req, mockResponse(), next);
      limiter(req, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(2);

      // Request 3 hits limit, triggers 45s cooldown
      const resLimit = mockResponse();
      limiter(req, resLimit, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(resLimit.status).toHaveBeenCalledWith(429);
      expect(resLimit.headers["retry-after"]).toBe(45);

      // Advance 20 seconds (still within cooldown)
      vi.advanceTimersByTime(20 * 1000);

      const resCooldown = mockResponse();
      limiter(req, resCooldown, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(resCooldown.status).toHaveBeenCalledWith(429);
      expect(resCooldown.body.message).toContain("Cooldown active");
      expect(resCooldown.headers["retry-after"]).toBe(25); // 45 - 20 = 25s remaining
    });
  });

  describe("Retries", () => {
    it("permits request retry after cooldown and window duration have elapsed", () => {
      vi.useFakeTimers();
      const startTime = 1_700_000_000_000;
      vi.setSystemTime(startTime);

      const limiter = createOperationRateLimiter({
        operation: "unlock",
        ipMax: 1,
        ipWindowMs: 60 * 1000,
        cooldownMs: 30 * 1000,
      });

      const req = mockRequest({ ip: "198.51.100.20" });
      const next = vi.fn();

      // Request 1 ok
      limiter(req, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(1);

      // Request 2 blocked with 429
      const resBlocked = mockResponse();
      limiter(req, resBlocked, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(resBlocked.status).toHaveBeenCalledWith(429);

      // Advance past window and cooldown (61 seconds)
      vi.advanceTimersByTime(61 * 1000);

      // Retried request succeeds
      const resRetry = mockResponse();
      limiter(req, resRetry, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(resRetry.headers["x-ratelimit-remaining"]).toBe(0);
    });
  });

  describe("Trusted Internal Calls", () => {
    it("bypasses rate limits when trusted internal service headers are supplied", () => {
      const originalSecret = process.env.INTERNAL_SERVICE_KEY;
      process.env.INTERNAL_SERVICE_KEY = "sec-internal-service-key-999";

      try {
        const limiter = createOperationRateLimiter({
          operation: "hash_lookup",
          ipMax: 2,
          ipWindowMs: 60 * 1000,
          burstMax: 2,
          burstWindowMs: 10 * 1000,
        });

        const trustedReq = mockRequest({
          ip: "198.51.100.99",
          headers: {
            "x-internal-service-token": "sec-internal-service-key-999",
          },
        });

        expect(isTrustedInternalCall(trustedReq)).toBe(true);

        const next = vi.fn();
        // Send 10 consecutive requests (far exceeding both burst and max)
        for (let i = 0; i < 10; i++) {
          const res = mockResponse();
          limiter(trustedReq, res, next);
        }

        // All 10 requests were allowed through without blocking
        expect(next).toHaveBeenCalledTimes(10);
      } finally {
        process.env.INTERNAL_SERVICE_KEY = originalSecret;
      }
    });

    it("bypasses rate limits with internal Bearer authorization token", () => {
      const originalSecret = process.env.ADMIN_TOKEN_SECRET;
      process.env.ADMIN_TOKEN_SECRET = "sec-admin-token-secret-xyz";

      try {
        const limiter = createOperationRateLimiter({
          operation: "unlock",
          ipMax: 1,
        });

        const trustedReq = mockRequest({
          ip: "198.51.100.101",
          headers: {
            authorization: "Bearer sec-admin-token-secret-xyz",
          },
        });

        expect(isTrustedInternalCall(trustedReq)).toBe(true);

        const next = vi.fn();
        for (let i = 0; i < 5; i++) {
          limiter(trustedReq, mockResponse(), next);
        }
        expect(next).toHaveBeenCalledTimes(5);
      } finally {
        process.env.ADMIN_TOKEN_SECRET = originalSecret;
      }
    });

    it("bypasses rate limits when isTrustedService flag is set on request", () => {
      const limiter = createOperationRateLimiter({
        operation: "hash_lookup",
        ipMax: 1,
      });

      const trustedReq = mockRequest({
        ip: "198.51.100.102",
      });
      (trustedReq as any).isTrustedService = true;

      const next = vi.fn();
      limiter(trustedReq, mockResponse(), next);
      limiter(trustedReq, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe("Limits by Identity, IP, and Operation Type", () => {
    it("enforces IP limits independently even if identity rotates (Sybil protection)", () => {
      const limiter = createOperationRateLimiter({
        operation: "hash_lookup",
        ipMax: 2,
        ipWindowMs: 60 * 1000,
        identityMax: 10,
        identityWindowMs: 60 * 1000,
      });

      const next = vi.fn();
      const ip = "203.0.113.1";

      // Call 1 from IP with wallet A
      const req1 = mockRequest({ ip, headers: { "x-wallet-address": "GAWALLET_A" } });
      limiter(req1, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(1);

      // Call 2 from IP with wallet B
      const req2 = mockRequest({ ip, headers: { "x-wallet-address": "GBWALLET_B" } });
      limiter(req2, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(2);

      // Call 3 from same IP with wallet C (exceeds IP limit of 2)
      const req3 = mockRequest({ ip, headers: { "x-wallet-address": "GCWALLET_C" } });
      const res3 = mockResponse();
      limiter(req3, res3, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(res3.status).toHaveBeenCalledWith(429);
      expect(res3.body.message).toContain("IP rate limit exceeded");
    });

    it("enforces identity limits independently even if IP rotates", () => {
      const limiter = createOperationRateLimiter({
        operation: "unlock",
        ipMax: 10,
        ipWindowMs: 60 * 1000,
        identityMax: 2,
        identityWindowMs: 60 * 1000,
      });

      const next = vi.fn();
      const wallet = "G_TARGET_BUYER_WALLET";

      // Call 1 from IP 1
      const req1 = mockRequest({ ip: "198.51.100.1", headers: { "x-wallet-address": wallet } });
      limiter(req1, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(1);

      // Call 2 from IP 2
      const req2 = mockRequest({ ip: "198.51.100.2", headers: { "x-wallet-address": wallet } });
      limiter(req2, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(2);

      // Call 3 from IP 3 (same wallet, exceeds identity limit of 2)
      const req3 = mockRequest({ ip: "198.51.100.3", headers: { "x-wallet-address": wallet } });
      const res3 = mockResponse();
      limiter(req3, res3, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(res3.status).toHaveBeenCalledWith(429);
      expect(res3.body.message).toContain("Identity rate limit exceeded");
    });

    it("maintains independent buckets for distinct operation types", () => {
      const hashLimiter = createOperationRateLimiter({
        operation: "hash_lookup",
        ipMax: 1,
      });
      const unlockLim = createOperationRateLimiter({
        operation: "unlock",
        ipMax: 1,
      });

      const req = mockRequest({ ip: "198.51.100.50" });
      const next = vi.fn();

      // Exhaust hash_lookup limit
      hashLimiter(req, mockResponse(), next);
      expect(next).toHaveBeenCalledTimes(1);

      // Next hash_lookup call is blocked
      const resHashBlocked = mockResponse();
      hashLimiter(req, resHashBlocked, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(resHashBlocked.status).toHaveBeenCalledWith(429);

      // Unlock endpoint for same client is still allowed!
      const resUnlock = mockResponse();
      unlockLim(req, resUnlock, next);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it("exports configurable defaults for hash lookup and unlock", () => {
      expect(HASH_LOOKUP_LIMITS.ipMax).toBeGreaterThan(0);
      expect(HASH_LOOKUP_LIMITS.identityMax).toBeGreaterThan(0);
      expect(HASH_LOOKUP_LIMITS.burstMax).toBeGreaterThan(0);
      expect(UNLOCK_LIMITS.ipMax).toBeGreaterThan(0);
      expect(UNLOCK_LIMITS.identityMax).toBeGreaterThan(0);
      expect(UNLOCK_LIMITS.burstMax).toBeGreaterThan(0);
      expect(hashLookupLimiter).toBeDefined();
      expect(unlockLimiter).toBeDefined();
    });
  });

  describe("Privacy-Safe Metrics", () => {
    it("emits metrics with pseudonymized hashes and no raw IP or wallet", () => {
      const rawIp = "192.0.2.145";
      const rawWallet = "GDGAMPWOKF4V7E3N37VLE33G2Z22YTRN2LMYC5N2S4V2263K7K4N5M6L";

      const limiter = createOperationRateLimiter({
        operation: "hash_lookup",
        ipMax: 1,
      });

      const req = mockRequest({
        ip: rawIp,
        headers: { "x-wallet-address": rawWallet },
      });

      // 1st passes
      limiter(req, mockResponse(), vi.fn());

      // 2nd rejected
      limiter(req, mockResponse(), vi.fn());

      const metrics = getRateLimitMetrics({ operation: "hash_lookup" });
      expect(metrics.length).toBeGreaterThan(0);

      const metric = metrics[0];
      expect(metric.operation).toBe("hash_lookup");
      expect(metric.status).toMatch(/rejected|throttled/);
      expect(metric.limitType).toBeDefined();

      // Crucial privacy requirement: never emit raw IP or raw wallet in metrics
      const metricString = JSON.stringify(metric);
      expect(metricString).not.toContain(rawIp);
      expect(metricString).not.toContain(rawWallet);

      // Must be a valid SHA-256 hex string pseudonym
      expect(metric.pseudonym).toMatch(/^[a-f0-9]{64}$/);
      expect(metric.pseudonym).toBe(hashSubjectIdentifier(rawIp));
    });

    it("hashSubjectIdentifier produces deterministic SHA-256 hex strings", () => {
      const hash1 = hashSubjectIdentifier("GDGAMPWOKF4V7E3N37VLE33G2Z22YTRN2LMYC5N2S4V2263K7K4N5M6L");
      const hash2 = hashSubjectIdentifier("gdgampwokf4v7e3n37vle33g2z22ytrn2lmyc5n2s4v2263k7k4n5m6l");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe("Stable Documented Response Shape", () => {
    it("returns standard headers and RFC/API-compliant JSON body on rate limit", () => {
      const limiter = createOperationRateLimiter({
        operation: "hash_lookup",
        ipMax: 1,
        ipWindowMs: 60 * 1000,
        cooldownMs: 30 * 1000,
      });

      const req = mockRequest({ ip: "192.0.2.200", originalUrl: "/api/prompts/hash/abcdef" });
      limiter(req, mockResponse(), vi.fn());

      const resBlocked = mockResponse();
      limiter(req, resBlocked, vi.fn());

      expect(resBlocked.status).toHaveBeenCalledWith(429);
      expect(resBlocked.headers["retry-after"]).toBeDefined();
      expect(resBlocked.headers["x-ratelimit-limit"]).toBe(1);
      expect(resBlocked.headers["x-ratelimit-remaining"]).toBe(0);
      expect(resBlocked.headers["x-ratelimit-reset"]).toBeDefined();

      expect(resBlocked.body).toEqual(
        expect.objectContaining({
          error: "Rate limit exceeded.",
          code: "RATE_LIMIT_EXCEEDED",
          action: "hash_lookup",
          retryAfter: expect.any(Number),
          limit: 1,
          resetAt: expect.any(Number),
          reset: expect.any(Number),
        }),
      );
    });
  });
});
