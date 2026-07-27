import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (_req: Request) => string;
  message?: string;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

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

export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => req.ip || req.socket.remoteAddress || "unknown",
    message = "Too many requests, please try again later.",
  } = options;

  const storeName = `rl_${windowMs}_${maxRequests}`;
  const store = getStore(storeName);

  const cleanupInterval = setInterval(() => {
    cleanupStore(store, windowMs);
  }, windowMs);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction) => {
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
      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
      return res.status(429).json({ error: message });
    }

    entry.count += 1;
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", maxRequests - entry.count);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
    next();
  };
}

// Pre-configured limiters for common use cases
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  message: "Too many requests from this IP, please try again later.",
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: "Too many authentication attempts, please try again later.",
});

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Rate limit exceeded for this endpoint.",
});

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: "Too many chat requests, please slow down.",
});
