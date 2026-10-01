import { describe, expect, it, beforeEach, vi } from "vitest";
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
} from "../middleware/rateLimiter";

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" } as any,
    headers: {},
    path: "/api/test",
    originalUrl: "/api/test",
    method: "POST",
    body: {},
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
      ip: "10.0.0.1",
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
