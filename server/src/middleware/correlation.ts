import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Structured logging with centralized secret redaction.
 *
 * Severity levels: "debug" | "info" | "warn" | "error".
 * Request log fields: timestamp, level, event, correlationId, method,
 *   path, statusCode, durationMs, route, userId, transactionId.
 * Permitted identifiers: correlationId, userId, transactionId, route, method,
 *   statusCode, durationMs, and coarse path templates. Never log prompts,
 *   tokens, keys, signed payloads, authorization headers, cookies, or PII (email, phone, name, address).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RequestLogFields {
  timestamp: string;
  level: LogLevel;
  event: "request.start" | "request.end";
  correlationId: string;
  method: string;
  path: string;
  statusCode?: number;
  durationMs?: number;
  route?: string;
  userId?: string;
  transactionId?: string;
}

const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * Keys whose values must always be redacted regardless of content.
 * Matched case-insensitively against normalized key names.
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /password/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /apikey/i,
  /accesskey/i,
  /privatekey/i,
  /session/i,
  /cookie/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /signature/i,
  /signed/i,
  /payload/i,
  /prompt/i,
  /completion/i,
  /message/i,
  /content/i,
  /email/i,
  /phone/i,
  /ssn/i,
  /ipb/i,
  /address/i,
];

/**
 * Value patterns that look like secrets even when the key is innocuous.
 */
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9-_.+~\/=]{8,}/,
  /\bBasic\s+[A-Za-z0-9-_.+~\/=]{8,}/,
  /\bAKIA[A-Z0-9]{16,}/,
  /\bsk[A-Za-z0-9]{16,}/,
  /\bsk_[A-Za-z0-9]{16,}/,
  /\bghp_[A-Za-z0-9]{16,}/,
  /\xox[0-9a-f]{16,}/i,
  /\beyJ[a-zA-Z0-9]+\.[A-Za-z0-9]+\.[a-zA-Z0-9_-]+/,
  /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/,
  /\b[A-Za-z0-9_\-]{20}\.[A-Za-z0-9_\-]{20}\.[a-zA-Z0-9_\-]{20}/,
];

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/g, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function containsSensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function redactString(value: string): string {
  if (containsSensitiveValue(value)) {
    return REDACTED_PLACEHOLDER;
  }
  return value;
}

/**
 * Recursively redacts sensitive keys and values from any object before it is
 * serialized into a log line. Handles cycles and depth limits safely.
 */
export function redactSensitive(
  input: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth > 8) {
    return REDACTED_PLACEHOLDER;
  }
  if (input == null) {
    return input;
  }
  if (typeof input === "string") {
    return redactString(input);
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return input;
  }
  if (typeof input === "bigint") {
    return input.toString();
  }
  if (input instanceof Error) {
    return {
      name: input.name,
      message: redactString(input.message),
    };
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitive(item, seen, depth + 1));
  }
  if (typeof input === "object") {
    const obj = input as object;
    if (seen.has(obj)) {
      return "[CIRCULAR]";
    }
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED_PLACEHOLDER;
        continue;
      }
      out[key] = redactSensitive(value, seen, depth + 1);
    }
    return out;
  }
  return REDACTED_PLACEHOLDER;
}

/**
 * Serializes a structured log entry after redaction. Exposed for tests that
 * assert secrets never appear in serialized log output.
 */
export function serializeLogEntry(entry: Record<string, unknown>): string {
  return JSON.stringify(redactSensitive(entry));
}

function emitLog(level: LogLevel, fields: Record<string, unknown>): void {
  const payload = serializeLogEntry({
    timestamp: new Date().toISOString(),
    level,
    ...fields,
  });
  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.log(payload);
  }
}

/**
 * Returns a safe path for logging: strips query string and fragment to avoid
 * leaking tokens or PII that are commonly passed in URLs.
 */
export function safePath(originalUrl: string): string {
  if (!originalUrl) {
    return "/";
  }
  const queryIndex = originalUrl.indexOf("?");
  const fragmentIndex = originalUrl.indexOf("#");
  let end = originalUrl.length;
  if (queryIndex >= 0) end = Math.min(end, queryIndex);
  if (fragmentIndex >= 0) end = Math.min(end, fragmentIndex);
  const path = originalUrl.slice(0, end) || "/";
  return path;
}

function safeRoute(req: Request): string | undefined {
  const route = (req as Request & { route?: { path?: string } }).route;
  if (route && typeof route.path === "string") {
    return route.path;
  }
  return undefined;
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingId = req.headers["x-correlation-id"] || req.headers["x-request-id"];
  const correlationId = (typeof incomingId === "string" && incomingId)
    ? incomingId
    : crypto.randomUUId();

  req.correlationId = correlationId;
  res.setHeader("X-Correlation-ID", correlationId);

  // Wrap res.json to automatically inject correlationId into error/unsuccessful payloads
  const originalJson = res.json;
  res.json = function (body: any) {
    if (body && typeof body === "object" && !body.correlationId) {
      if (body.error || res.statusCode >= 400) {
        body.correlationId = correlationId;
      }
    }
    return originalJson.call(this, body);
  };

  const started = process.hrtime.bigint();
  const path = safePath(req.originalUrl);
  const userId = req.headers["x-user-id"];
  const transactionId = req.headers["x-transaction-id"];

  emitLog("info", {
    event: "request.start",
    correlationId,
    method: req.method,
    path,
    route: safeRoute(req),
    userId: typeof userId === "string" ? userId : undefined,
    transactionId: typeof transactionId === "string" ? transactionId : undefined,
  });

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1000000;
    const level: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    emitLog(level, {
      event: "request.end",
      correlationId,
      method: req.method,
      path,
      statusCode: res.statusCode,
      durationMs,
      route: safeRoute(req),
      userId: typeof userId === "string" ? userId : undefined,
      transactionId: typeof transactionId === "string" ? transactionId : undefined,
    });
  });

  next();
}
