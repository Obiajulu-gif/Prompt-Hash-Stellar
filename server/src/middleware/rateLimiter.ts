import { Request, Response, NextFunction } from "express";

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  actionName?: string;
  keyGenerator?: (req: Request) => string;
  message?: string;
  skip?: (req: Request) => boolean;
}

export interface BlockedRateLimitEvent {
  id: string;
  action: string;
  key: string;
  ip: string;
  wallet?: string;
  path: string;
  method: string;
  timestamp: number;
  retryAfter: number;
  windowMs: number;
  limit: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();
const blockedEvents: BlockedRateLimitEvent[] = [];
const MAX_BLOCKED_EVENTS = 500;

function getStore(name: string): Map<string, RateLimitEntry> {
  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  return stores.get(name)!;
}

function cleanupStore(store: Map<string, RateLimitEntry>, windowMs: number) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt + windowMs) {
      store.delete(key);
    }
  }
}

/**
 * Record a blocked rate limit event for admin observability.
 */
export function recordBlockedEvent(event: Omit<BlockedRateLimitEvent, "id" | "timestamp">) {
  const fullEvent: BlockedRateLimitEvent = {
    ...event,
    id: `rl_evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
  };

  blockedEvents.unshift(fullEvent);
  if (blockedEvents.length > MAX_BLOCKED_EVENTS) {
    blockedEvents.pop();
  }
}

/**
 * Retrieve blocked rate limit events for admin monitoring.
 */
export function getBlockedRateLimitEvents(options?: {
  action?: string;
  limit?: number;
  sinceMs?: number;
}): { events: BlockedRateLimitEvent[]; total: number; summary: Record<string, number> } {
  let filtered = [...blockedEvents];

  if (options?.action) {
    filtered = filtered.filter((e) => e.action.toLowerCase() === options.action!.toLowerCase());
  }

  if (options?.sinceMs) {
    const cutoff = Date.now() - options.sinceMs;
    filtered = filtered.filter((e) => e.timestamp >= cutoff);
  }

  const summary: Record<string, number> = {};
  for (const evt of filtered) {
    summary[evt.action] = (summary[evt.action] || 0) + 1;
  }

  const max = options?.limit || 100;
  return {
    events: filtered.slice(0, max),
    total: filtered.length,
    summary,
  };
}

/**
 * Clear rate limit counters (admin operation or testing).
 */
export function resetRateLimits(actionOrStoreName?: string, key?: string) {
  if (!actionOrStoreName) {
    stores.clear();
    blockedEvents.length = 0;
    return;
  }

  for (const [storeName, store] of stores.entries()) {
    if (storeName.includes(actionOrStoreName)) {
      if (key) {
        store.delete(key);
      } else {
        store.clear();
      }
    }
  }
}

/**
 * Check whether request is a legitimate webhook attempt that should bypass rate limits.
 */
export function isLegitimateWebhook(req: Request): boolean {
  const path = req.path || req.originalUrl || "";
  const isWebhookPath = path.includes("/api/webhooks") || path.includes("/webhook");
  const hasWebhookSecret =
    Boolean(req.headers["x-webhook-signature"]) ||
    Boolean(req.headers["x-webhook-secret"]) ||
    Boolean(req.headers["authorization"]?.includes("Webhook"));

  return isWebhookPath && hasWebhookSecret;
}

export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    actionName = "default",
    keyGenerator = (req) =>
      (req.headers["x-wallet-address"] as string) ||
      (req.body?.userAddress as string) ||
      (req.body?.address as string) ||
      req.ip ||
      req.socket.remoteAddress ||
      "unknown",
    message = "Too many requests, please try again later.",
    skip = isLegitimateWebhook,
  } = options;

  const storeName = `rl_${actionName}_${windowMs}_${maxRequests}`;
  const store = getStore(storeName);

  const cleanupInterval = setInterval(() => {
    cleanupStore(store, windowMs);
  }, windowMs);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", maxRequests - 1);
      res.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));
      return next();
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

      recordBlockedEvent({
        action: actionName,
        key,
        ip: req.ip || req.socket.remoteAddress || "unknown",
        wallet: (req.headers["x-wallet-address"] as string) || req.body?.userAddress || req.body?.address,
        path: req.originalUrl || req.path,
        method: req.method,
        retryAfter,
        windowMs,
        limit: maxRequests,
      });

      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

      return res.status(429).json({
        error: "Rate limit exceeded.",
        code: "RATE_LIMIT_EXCEEDED",
        action: actionName,
        message: `${message} Retry in ${retryAfter} seconds.`,
        retryAfter,
        limit: maxRequests,
        resetAt: Math.ceil(entry.resetAt / 1000),
      });
    }

    entry.count += 1;
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", maxRequests - entry.count);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
    next();
  };
}

// ── Per-action limiters for core marketplace actions ──────────────────────────

/** Publishing limiter: 5 requests per 15 minutes */
export const publishLimiter = rateLimit({
  actionName: "publish",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many prompt publishing attempts.",
});

/** Purchasing limiter: 10 requests per 1 minute */
export const purchaseLimiter = rateLimit({
  actionName: "purchase",
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Too many purchase attempts.",
});

/** Reviewing limiter: 5 requests per 1 minute */
export const reviewLimiter = rateLimit({
  actionName: "review",
  windowMs: 60 * 1000,
  maxRequests: 5,
  message: "Too many review submissions.",
});

/** Reporting limiter: 5 requests per 1 minute */
export const reportLimiter = rateLimit({
  actionName: "report",
  windowMs: 60 * 1000,
  maxRequests: 5,
  message: "Too many report submissions.",
});

export const globalLimiter = rateLimit({
  actionName: "global",
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  message: "Too many requests from this client.",
});

export const authLimiter = rateLimit({
  actionName: "auth",
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: "Too many authentication attempts.",
});

export const strictLimiter = rateLimit({
  actionName: "strict",
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Rate limit exceeded for this endpoint.",
});

export const chatLimiter = rateLimit({
  actionName: "chat",
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: "Too many chat requests.",
});
