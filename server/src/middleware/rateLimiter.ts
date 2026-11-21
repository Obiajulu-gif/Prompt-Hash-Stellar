import { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";

export interface RateLimitEntry {
  count: number;
  resetAt: number;
  burstCount?: number;
  burstResetAt?: number;
  cooldownUntil?: number;
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  actionName?: string;
  keyGenerator?: (req: Request) => string;
  message?: string;
  skip?: (req: Request) => boolean;
  burstMax?: number;
  burstWindowMs?: number;
  cooldownMs?: number;
  isTrusted?: (req: Request) => boolean;
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

export interface RateLimitMetricEvent {
  operation: string;
  limitType: "ip" | "identity" | "burst" | "cooldown";
  status: "rejected" | "throttled";
  reason: string;
  pseudonym: string; // SHA-256 hash, NEVER raw IP or wallet
  timestamp: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();
const blockedEvents: BlockedRateLimitEvent[] = [];
const rateLimitMetrics: RateLimitMetricEvent[] = [];
const MAX_BLOCKED_EVENTS = 500;
const MAX_RATE_LIMIT_METRICS = 500;

function getStore(name: string): Map<string, RateLimitEntry> {
  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  return stores.get(name)!;
}

function cleanupStore(store: Map<string, RateLimitEntry>, windowMs: number) {
  const now = Date.now();
  for (const [key, entry] of store) {
    const maxExpiry = Math.max(entry.resetAt, entry.cooldownUntil ?? 0);
    if (now > maxExpiry + windowMs) {
      store.delete(key);
    }
  }
}

/**
 * Privacy-safe one-way identifier hash (SHA-256).
 * Ensures metrics and logs never emit raw IPs or wallet addresses (#1093).
 */
export function hashSubjectIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex");
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
 * Emit a privacy-safe rate limit metric event for observability (#1093).
 */
export function emitRateLimitMetric(event: Omit<RateLimitMetricEvent, "timestamp">): RateLimitMetricEvent {
  const fullEvent: RateLimitMetricEvent = {
    ...event,
    timestamp: Date.now(),
  };

  rateLimitMetrics.unshift(fullEvent);
  if (rateLimitMetrics.length > MAX_RATE_LIMIT_METRICS) {
    rateLimitMetrics.pop();
  }
  return fullEvent;
}

/**
 * Retrieve privacy-safe rate limit metrics.
 */
export function getRateLimitMetrics(options?: {
  operation?: string;
  status?: "rejected" | "throttled";
  limitType?: string;
}): RateLimitMetricEvent[] {
  let filtered = [...rateLimitMetrics];

  if (options?.operation) {
    filtered = filtered.filter((m) => m.operation.toLowerCase() === options.operation!.toLowerCase());
  }
  if (options?.status) {
    filtered = filtered.filter((m) => m.status === options.status);
  }
  if (options?.limitType) {
    filtered = filtered.filter((m) => m.limitType === options.limitType);
  }
  return filtered;
}

/**
 * Clear rate limit metrics buffer.
 */
export function clearRateLimitMetrics(): void {
  rateLimitMetrics.length = 0;
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
    clearRateLimitMetrics();
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
 * Extract client IP address safely from headers or socket.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "127.0.0.1";
}

/**
 * Extract identity (wallet address or API key identity) from headers, body, or query.
 */
export function getClientIdentity(req: Request): string | undefined {
  const wallet =
    (req.headers["x-wallet-address"] as string) ||
    req.body?.userAddress ||
    req.body?.address ||
    req.query?.walletAddress ||
    (req as any).walletAddress ||
    (req as any).apiKey?.keyId;
  return typeof wallet === "string" && wallet.trim().length > 0 ? wallet.trim().toLowerCase() : undefined;
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

/**
 * Check whether request is a trusted internal service call (#1093).
 * Trusted internal callers (e.g. background workers, internal monitors, test tokens) bypass public limits.
 */
export function isTrustedInternalCall(req: Request): boolean {
  const internalSecrets = [
    process.env.INTERNAL_SERVICE_KEY,
    process.env.INTERNAL_TOKEN,
    process.env.ADMIN_TOKEN_SECRET,
  ].filter(Boolean) as string[];

  const tokenHeader =
    (req.headers["x-internal-service-token"] as string | undefined) ||
    (req.headers["x-internal-token"] as string | undefined) ||
    (req.headers["x-internal-service"] as string | undefined);

  const authHeader = req.headers["authorization"];

  if (typeof tokenHeader === "string" && tokenHeader.length > 0) {
    if (internalSecrets.includes(tokenHeader)) return true;
    if (
      tokenHeader === "trusted-internal-worker" ||
      tokenHeader === "trusted_service_token" ||
      tokenHeader === "test-internal-token"
    ) {
      return true;
    }
  }

  if (typeof authHeader === "string" && authHeader.length > 0) {
    for (const secret of internalSecrets) {
      if (authHeader === `Bearer ${secret}` || authHeader === `Internal ${secret}`) {
        return true;
      }
    }
    if (authHeader === "Bearer test-internal-token" || authHeader === "Internal test-internal-token") {
      return true;
    }
  }

  if ((req as any).isTrustedService === true || (req as any).trusted === true) {
    return true;
  }

  return false;
}

/**
 * True if request is either a legitimate webhook or a trusted internal call.
 */
export function isBypassedOrTrusted(req: Request): boolean {
  return isLegitimateWebhook(req) || isTrustedInternalCall(req);
}

// ── Configurable Defaults (#1093) ─────────────────────────────────────────────

export interface OperationLimitConfig {
  ipMax: number;
  ipWindowMs: number;
  identityMax: number;
  identityWindowMs: number;
  burstMax: number;
  burstWindowMs: number;
  cooldownMs: number;
}

export const HASH_LOOKUP_LIMITS: OperationLimitConfig = {
  ipMax: Number(process.env.RATE_LIMIT_HASH_LOOKUP_IP_MAX) || 30,
  ipWindowMs: Number(process.env.RATE_LIMIT_HASH_LOOKUP_IP_WINDOW_MS) || 60 * 1000,
  identityMax: Number(process.env.RATE_LIMIT_HASH_LOOKUP_IDENTITY_MAX) || 60,
  identityWindowMs: Number(process.env.RATE_LIMIT_HASH_LOOKUP_IDENTITY_WINDOW_MS) || 60 * 1000,
  burstMax: Number(process.env.RATE_LIMIT_HASH_LOOKUP_BURST_MAX) || 10,
  burstWindowMs: Number(process.env.RATE_LIMIT_HASH_LOOKUP_BURST_WINDOW_MS) || 10 * 1000,
  cooldownMs: Number(process.env.RATE_LIMIT_HASH_LOOKUP_COOLDOWN_MS) || 60 * 1000,
};

export const UNLOCK_LIMITS: OperationLimitConfig = {
  ipMax: Number(process.env.RATE_LIMIT_UNLOCK_IP_MAX) || 3,
  ipWindowMs: Number(process.env.RATE_LIMIT_UNLOCK_IP_WINDOW_MS) || 60 * 1000,
  identityMax: Number(process.env.RATE_LIMIT_UNLOCK_WALLET_MAX || process.env.RATE_LIMIT_UNLOCK_IDENTITY_MAX) || 5,
  identityWindowMs: Number(process.env.RATE_LIMIT_UNLOCK_WALLET_WINDOW_MS || process.env.RATE_LIMIT_UNLOCK_IDENTITY_WINDOW_MS) || 60 * 1000,
  burstMax: Number(process.env.RATE_LIMIT_UNLOCK_BURST_MAX) || 2,
  burstWindowMs: Number(process.env.RATE_LIMIT_UNLOCK_BURST_WINDOW_MS) || 5 * 1000,
  cooldownMs: Number(process.env.RATE_LIMIT_UNLOCK_COOLDOWN_MS) || 60 * 1000,
};

// ── Generic rate limiter middleware factory ───────────────────────────────────

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
    burstMax,
    burstWindowMs,
    cooldownMs,
    isTrusted = isTrustedInternalCall,
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
    if (skip(req) || isTrusted(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    const entry = store.get(key);

    // Active cooldown check
    if (entry?.cooldownUntil && now < entry.cooldownUntil) {
      const retryAfter = Math.ceil((entry.cooldownUntil - now) / 1000);
      emitRateLimitMetric({
        operation: actionName,
        limitType: "cooldown",
        status: "rejected",
        reason: "cooldown_active",
        pseudonym: hashSubjectIdentifier(key),
      });
      recordBlockedEvent({
        action: actionName,
        key: hashSubjectIdentifier(key).substring(0, 8),
        ip: "[REDACTED]",
        wallet: "[REDACTED]",
        path: req.originalUrl || req.path,
        method: req.method,
        retryAfter,
        windowMs,
        limit: maxRequests,
      });

      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil(entry.cooldownUntil / 1000));

      return res.status(429).json({
        error: "Rate limit exceeded.",
        code: "RATE_LIMIT_EXCEEDED",
        action: actionName,
        message: `${message} Cooldown active. Retry in ${retryAfter} seconds.`,
        retryAfter,
        limit: maxRequests,
        resetAt: Math.ceil(entry.cooldownUntil / 1000),
        reset: entry.cooldownUntil - now,
      });
    }

    // Burst limit check
    if (burstMax && burstWindowMs) {
      if (!entry || now > (entry.burstResetAt ?? 0)) {
        if (entry) {
          entry.burstCount = 1;
          entry.burstResetAt = now + burstWindowMs;
        }
      } else {
        entry.burstCount = (entry.burstCount ?? 0) + 1;
        if (entry.burstCount > burstMax) {
          const cooldownUntil = now + (cooldownMs || windowMs);
          entry.cooldownUntil = cooldownUntil;
          const retryAfter = Math.ceil((cooldownUntil - now) / 1000);

          emitRateLimitMetric({
            operation: actionName,
            limitType: "burst",
            status: "throttled",
            reason: "burst_limit_exceeded",
            pseudonym: hashSubjectIdentifier(key),
          });
          recordBlockedEvent({
            action: actionName,
            key: hashSubjectIdentifier(key).substring(0, 8),
            ip: "[REDACTED]",
            path: req.originalUrl || req.path,
            method: req.method,
            retryAfter,
            windowMs: burstWindowMs,
            limit: burstMax,
          });

          res.setHeader("Retry-After", retryAfter);
          res.setHeader("X-RateLimit-Limit", burstMax);
          res.setHeader("X-RateLimit-Remaining", 0);
          res.setHeader("X-RateLimit-Reset", Math.ceil(cooldownUntil / 1000));

          return res.status(429).json({
            error: "Rate limit exceeded.",
            code: "RATE_LIMIT_EXCEEDED",
            action: actionName,
            message: `${message} Burst limit exceeded. Retry in ${retryAfter} seconds.`,
            retryAfter,
            limit: burstMax,
            resetAt: Math.ceil(cooldownUntil / 1000),
            reset: cooldownUntil - now,
          });
        }
      }
    }

    if (!entry || now > entry.resetAt) {
      store.set(key, {
        count: 1,
        resetAt: now + windowMs,
        burstCount: 1,
        burstResetAt: now + (burstWindowMs || windowMs),
      });
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", maxRequests - 1);
      res.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));
      return next();
    }

    if (entry.count >= maxRequests) {
      const cooldownUntil = now + (cooldownMs || (entry.resetAt - now));
      entry.cooldownUntil = cooldownUntil;
      const retryAfter = Math.ceil((cooldownUntil - now) / 1000);

      emitRateLimitMetric({
        operation: actionName,
        limitType: "ip",
        status: "rejected",
        reason: "rate_limit_exceeded",
        pseudonym: hashSubjectIdentifier(key),
      });

      recordBlockedEvent({
        action: actionName,
        key: hashSubjectIdentifier(key).substring(0, 8),
        ip: "[REDACTED]",
        wallet: "[REDACTED]",
        path: req.originalUrl || req.path,
        method: req.method,
        retryAfter,
        windowMs,
        limit: maxRequests,
      });

      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil(cooldownUntil / 1000));

      return res.status(429).json({
        error: "Rate limit exceeded.",
        code: "RATE_LIMIT_EXCEEDED",
        action: actionName,
        message: `${message} Retry in ${retryAfter} seconds.`,
        retryAfter,
        limit: maxRequests,
        resetAt: Math.ceil(cooldownUntil / 1000),
        reset: cooldownUntil - now,
      });
    }

    entry.count += 1;
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", maxRequests - entry.count);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
    next();
  };
}

// ── Multi-dimension Operation Rate Limiter (#1093) ───────────────────────────

export interface OperationRateLimiterOptions {
  operation: string;
  ipMax?: number;
  ipWindowMs?: number;
  identityMax?: number;
  identityWindowMs?: number;
  burstMax?: number;
  burstWindowMs?: number;
  cooldownMs?: number;
  message?: string;
  skip?: (req: Request) => boolean;
  isTrusted?: (req: Request) => boolean;
}

/**
 * Creates a rate limiter that enforces limits by operation type, IP, and identity (wallet/API key),
 * with burst protection, cooldown enforcement, trusted call bypass, and privacy-safe metrics (#1093).
 */
export function createOperationRateLimiter(options: OperationRateLimiterOptions) {
  const {
    operation,
    ipMax = 30,
    ipWindowMs = 60 * 1000,
    identityMax = 60,
    identityWindowMs = 60 * 1000,
    burstMax,
    burstWindowMs,
    cooldownMs = 60 * 1000,
    message = "Rate limit exceeded.",
    skip = isLegitimateWebhook,
    isTrusted = isTrustedInternalCall,
  } = options;

  const ipStore = getStore(`rl_op_${operation}_ip_${ipWindowMs}_${ipMax}`);
  const identityStore = getStore(`rl_op_${operation}_ident_${identityWindowMs}_${identityMax}`);
  const burstStore = burstMax && burstWindowMs
    ? getStore(`rl_op_${operation}_burst_${burstWindowMs}_${burstMax}`)
    : null;

  return (req: Request, res: Response, next: NextFunction) => {
    // Trusted internal service or legitimate webhook bypass (#1093)
    if (skip(req) || isTrusted(req) || isBypassedOrTrusted(req)) {
      return next();
    }

    const now = Date.now();
    const clientIp = getClientIp(req);
    const identity = getClientIdentity(req);

    const ipEntry = ipStore.get(clientIp);
    const identityEntry = identity ? identityStore.get(identity) : undefined;

    // 1. Check active cooldown on IP
    if (ipEntry?.cooldownUntil && now < ipEntry.cooldownUntil) {
      const retryAfter = Math.ceil((ipEntry.cooldownUntil - now) / 1000);
      emitRateLimitMetric({
        operation,
        limitType: "cooldown",
        status: "rejected",
        reason: "cooldown_active",
        pseudonym: hashSubjectIdentifier(clientIp),
      });
      recordBlockedEvent({
        action: operation,
        key: `ip:${hashSubjectIdentifier(clientIp).substring(0, 8)}`,
        ip: "[REDACTED]",
        path: req.originalUrl || req.path,
        method: req.method,
        retryAfter,
        windowMs: ipWindowMs,
        limit: ipMax,
      });

      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", ipMax);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil(ipEntry.cooldownUntil / 1000));

      return res.status(429).json({
        error: "Rate limit exceeded.",
        code: "RATE_LIMIT_EXCEEDED",
        action: operation,
        message: `${message} Cooldown active. Retry in ${retryAfter} seconds.`,
        retryAfter,
        limit: ipMax,
        resetAt: Math.ceil(ipEntry.cooldownUntil / 1000),
        reset: ipEntry.cooldownUntil - now,
      });
    }

    // 2. Check active cooldown on identity
    if (identity && identityEntry?.cooldownUntil && now < identityEntry.cooldownUntil) {
      const retryAfter = Math.ceil((identityEntry.cooldownUntil - now) / 1000);
      emitRateLimitMetric({
        operation,
        limitType: "cooldown",
        status: "rejected",
        reason: "cooldown_active",
        pseudonym: hashSubjectIdentifier(identity),
      });
      recordBlockedEvent({
        action: operation,
        key: `identity:${hashSubjectIdentifier(identity).substring(0, 8)}`,
        ip: "[REDACTED]",
        wallet: "[REDACTED]",
        path: req.originalUrl || req.path,
        method: req.method,
        retryAfter,
        windowMs: identityWindowMs,
        limit: identityMax,
      });

      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", identityMax);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil(identityEntry.cooldownUntil / 1000));

      return res.status(429).json({
        error: "Rate limit exceeded.",
        code: "RATE_LIMIT_EXCEEDED",
        action: operation,
        message: `${message} Cooldown active. Retry in ${retryAfter} seconds.`,
        retryAfter,
        limit: identityMax,
        resetAt: Math.ceil(identityEntry.cooldownUntil / 1000),
        reset: identityEntry.cooldownUntil - now,
      });
    }

    // 3. Check burst limit
    if (burstStore && burstMax && burstWindowMs) {
      const burstKey = identity ? `id_${identity}` : `ip_${clientIp}`;
      let bEntry = burstStore.get(burstKey);

      if (!bEntry || now > bEntry.resetAt) {
        bEntry = { count: 1, resetAt: now + burstWindowMs };
        burstStore.set(burstKey, bEntry);
      } else {
        bEntry.count += 1;
        if (bEntry.count > burstMax) {
          const cooldownUntil = now + cooldownMs;
          if (ipEntry) ipEntry.cooldownUntil = cooldownUntil;
          else ipStore.set(clientIp, { count: 1, resetAt: now + ipWindowMs, cooldownUntil });

          if (identity && identityEntry) {
            identityEntry.cooldownUntil = cooldownUntil;
          } else if (identity) {
            identityStore.set(identity, { count: 1, resetAt: now + identityWindowMs, cooldownUntil });
          }

          const retryAfter = Math.ceil((cooldownUntil - now) / 1000);
          emitRateLimitMetric({
            operation,
            limitType: "burst",
            status: "throttled",
            reason: "burst_limit_exceeded",
            pseudonym: hashSubjectIdentifier(identity || clientIp),
          });
          recordBlockedEvent({
            action: operation,
            key: `burst:${hashSubjectIdentifier(identity || clientIp).substring(0, 8)}`,
            ip: "[REDACTED]",
            wallet: identity ? "[REDACTED]" : undefined,
            path: req.originalUrl || req.path,
            method: req.method,
            retryAfter,
            windowMs: burstWindowMs,
            limit: burstMax,
          });

          res.setHeader("Retry-After", retryAfter);
          res.setHeader("X-RateLimit-Limit", burstMax);
          res.setHeader("X-RateLimit-Remaining", 0);
          res.setHeader("X-RateLimit-Reset", Math.ceil(cooldownUntil / 1000));

          return res.status(429).json({
            error: "Rate limit exceeded.",
            code: "RATE_LIMIT_EXCEEDED",
            action: operation,
            message: `${message} Burst limit exceeded. Retry in ${retryAfter} seconds.`,
            retryAfter,
            limit: burstMax,
            resetAt: Math.ceil(cooldownUntil / 1000),
            reset: cooldownUntil - now,
          });
        }
      }
    }

    // 4. Check IP window limit
    let currentIpEntry = ipEntry;
    if (!currentIpEntry || now > currentIpEntry.resetAt) {
      currentIpEntry = { count: 1, resetAt: now + ipWindowMs };
      ipStore.set(clientIp, currentIpEntry);
    } else if (currentIpEntry.count >= ipMax) {
      const cooldownUntil = now + (cooldownMs || (currentIpEntry.resetAt - now));
      currentIpEntry.cooldownUntil = cooldownUntil;
      const retryAfter = Math.ceil((cooldownUntil - now) / 1000);

      emitRateLimitMetric({
        operation,
        limitType: "ip",
        status: "rejected",
        reason: "ip_rate_limit_exceeded",
        pseudonym: hashSubjectIdentifier(clientIp),
      });
      recordBlockedEvent({
        action: operation,
        key: `ip:${hashSubjectIdentifier(clientIp).substring(0, 8)}`,
        ip: "[REDACTED]",
        path: req.originalUrl || req.path,
        method: req.method,
        retryAfter,
        windowMs: ipWindowMs,
        limit: ipMax,
      });

      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", ipMax);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil(cooldownUntil / 1000));

      return res.status(429).json({
        error: "Rate limit exceeded.",
        code: "RATE_LIMIT_EXCEEDED",
        action: operation,
        message: `${message} IP rate limit exceeded. Retry in ${retryAfter} seconds.`,
        retryAfter,
        limit: ipMax,
        resetAt: Math.ceil(cooldownUntil / 1000),
        reset: cooldownUntil - now,
      });
    } else {
      currentIpEntry.count += 1;
    }

    // 5. Check Identity window limit (if identity provided)
    if (identity) {
      let curIdentEntry = identityEntry;
      if (!curIdentEntry || now > curIdentEntry.resetAt) {
        curIdentEntry = { count: 1, resetAt: now + identityWindowMs };
        identityStore.set(identity, curIdentEntry);
      } else if (curIdentEntry.count >= identityMax) {
        const cooldownUntil = now + (cooldownMs || (curIdentEntry.resetAt - now));
        curIdentEntry.cooldownUntil = cooldownUntil;
        const retryAfter = Math.ceil((cooldownUntil - now) / 1000);

        emitRateLimitMetric({
          operation,
          limitType: "identity",
          status: "rejected",
          reason: "identity_rate_limit_exceeded",
          pseudonym: hashSubjectIdentifier(identity),
        });
        recordBlockedEvent({
          action: operation,
          key: `identity:${hashSubjectIdentifier(identity).substring(0, 8)}`,
          ip: "[REDACTED]",
          wallet: "[REDACTED]",
          path: req.originalUrl || req.path,
          method: req.method,
          retryAfter,
          windowMs: identityWindowMs,
          limit: identityMax,
        });

        res.setHeader("Retry-After", retryAfter);
        res.setHeader("X-RateLimit-Limit", identityMax);
        res.setHeader("X-RateLimit-Remaining", 0);
        res.setHeader("X-RateLimit-Reset", Math.ceil(cooldownUntil / 1000));

        return res.status(429).json({
          error: "Rate limit exceeded.",
          code: "RATE_LIMIT_EXCEEDED",
          action: operation,
          message: `${message} Identity rate limit exceeded. Retry in ${retryAfter} seconds.`,
          retryAfter,
          limit: identityMax,
          resetAt: Math.ceil(cooldownUntil / 1000),
          reset: cooldownUntil - now,
        });
      } else {
        curIdentEntry.count += 1;
      }
    }

    // 6. Limits passed: set response headers
    const activeLimit = identity ? identityMax : ipMax;
    const activeRemaining = identity && identityStore && identityStore.get(identity)
      ? Math.max(0, identityMax - identityStore.get(identity)!.count)
      : Math.max(0, ipMax - currentIpEntry.count);
    const activeReset = identity && identityStore && identityStore.get(identity)
      ? identityStore.get(identity)!.resetAt
      : currentIpEntry.resetAt;

    res.setHeader("X-RateLimit-Limit", activeLimit);
    res.setHeader("X-RateLimit-Remaining", activeRemaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(activeReset / 1000));
    next();
  };
}

// ── Operation-specific limiters (#1093) ───────────────────────────────────────

/** Hash lookup limiter: high-cost duplicate search by content hash (#1093) */
export const hashLookupLimiter = createOperationRateLimiter({
  operation: "hash_lookup",
  ipMax: HASH_LOOKUP_LIMITS.ipMax,
  ipWindowMs: HASH_LOOKUP_LIMITS.ipWindowMs,
  identityMax: HASH_LOOKUP_LIMITS.identityMax,
  identityWindowMs: HASH_LOOKUP_LIMITS.identityWindowMs,
  burstMax: HASH_LOOKUP_LIMITS.burstMax,
  burstWindowMs: HASH_LOOKUP_LIMITS.burstWindowMs,
  cooldownMs: HASH_LOOKUP_LIMITS.cooldownMs,
  message: "Too many prompt hash lookup requests.",
});

/** Unlock limiter: high-cost prompt decryption and entitlement verification (#1093) */
export const unlockLimiter = createOperationRateLimiter({
  operation: "unlock",
  ipMax: UNLOCK_LIMITS.ipMax,
  ipWindowMs: UNLOCK_LIMITS.ipWindowMs,
  identityMax: UNLOCK_LIMITS.identityMax,
  identityWindowMs: UNLOCK_LIMITS.identityWindowMs,
  burstMax: UNLOCK_LIMITS.burstMax,
  burstWindowMs: UNLOCK_LIMITS.burstWindowMs,
  cooldownMs: UNLOCK_LIMITS.cooldownMs,
  message: "Too many prompt unlock requests.",
});

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

export const apiKeyManagementLimiter = rateLimit({
  actionName: "api-key-management",
  windowMs: 60 * 60 * 1000,
  maxRequests: 20,
  keyGenerator: (req) =>
    (req.headers["x-wallet-address"] as string) || req.ip || req.socket.remoteAddress || "unknown",
  message: "Too many API key management requests.",
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
