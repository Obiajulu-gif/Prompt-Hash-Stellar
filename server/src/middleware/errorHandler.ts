import { Request, Response, NextFunction } from "express";
import mapFailureToRejection, { REJECTION_EXPLANATIONS, type RejectionCode } from "../services/rejectionExplanations";

/**
 * Structured logging with centralized secret redaction.
 *
 * Purpose: operational logs must be useful for debugging without emitting
 * prompts, tokens, keys, signed payloads, or personal data.
 *
 * Permitted identifiers (considered safe to log):
 *   - correlationId (opaque request correlation identifier)
 *   - requestId (opaque request identifier)
 *   - transactionId (opaque transaction identifier)
 *   - route / method / statusCode / durationMs
 *   - error code (e.g. VALIDATION_ERROR)
 *   - actorId (an internal opaque user identifier, never email/nickname)
 *
 * Safe troubleshooting procedures:
 *   1. Correlate by correlationId/transactionId, do not ask for raw prompts.
 *   2. Inspect error codes and status codes from structured logs.
 *   3. Reproduce with synthetic payloads in a sandbox environment.
 *   4. Never paste credentials, signed payloads, or prompt bodies into tickets.
 */

export type LogSeverity = "debug" | "info" | "warn" | "error" | "fatal";

export interface RequestLogFields {
  correlationId?: string;
  requestId?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  actorId?: string;
}

export interface TransactionLogFields {
  correlationId?: string;
  transactionId?: string;
  actorId?: string;
  operation?: string;
  status?: string;
  durationMs?: number;
  errorCode?: string;
}

export interface StructuredLogEntry {
  timestamp: string;
  severity: LogSeverity;
  event: string;
  message?: string;
  fields: Record<string, unknown>;
}

const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * Keys whose values are always sensitive regardless of content.
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
  /credential/i,
  /authorization/i,
  /cookie/i,
  /sessionid/i,
  /signature/i,
  /signed/i,
  /payload/i,
  /prompt/i,
  /completion/i,
  /email/i,
  /phone/i,
  /ssn/i,
  /creditcard/i,
  /cardnumber/i,
];

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\beyJ[a-zA-Z0-9]+\.[A-Za-z0-9_]+\.[a-zA-Z0-9_-]+\b/, // JWT-like
  /^sk_(?:live|test)_[A-Za-z0-9]{16,}$/, // API key-like
  /^ghp_[A-Za-z0-9]{20,}$/, // GitHub token
  /^AKIA[0-9A-Z]{16,}$/, // AWS access key id
  /^Bearer\s+[A-Za-z0-9._-]+/i, // Bearer token
  /^\*\*\*\s*[A-Za-z0-9]+/, // Masked credential leak
];

function normalizeKey(key: string): string {
  return key.replace(/[^\w]/g, "").toLowerCase();
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isSensitiveValue(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Recursively redact sensitive keys and values from an object graph.
 * Handles circular references and bounds depth.
 */
export function redactSensitiveData(
  input: unknown,
  options: { maxDepth?: number } = {},
): unknown {
  const maxDepth = options.maxDepth ?? 6;
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number, keyHint?: string): unknown => {
    if (keyHint !== undefined && isSensitiveKey(keyHint)) {
      return REDACTED_PLACEHOLDER;
    }

    if (typeof value === "string") {
      return isSensitiveValue(value) ? REDACTED_PLACEHOLDER : value;
    }

    if (value === null || typeof value !== "object") {
      return value;
    }

    if (depth >= maxDepth) {
      return "[TRUNCATED]";
    }

    if (seen.has(value as object)) {
      return "[CIRCULAR]";
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => walk(item, depth + 1));
    }

    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      output[key] = walk(val, depth + 1, key);
    }
    return output;
  };

  return walk(input, 0);
}

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveData(fields) as Record<string, unknown>;
}

export function formatStructuredLog(entry: StructuredLogEntry): string {
  const safe: StructuredLogEntry = {
    timestamp: entry.timestamp,
    severity: entry.severity,
    event: entry.event,
    message: entry.message ? String(redactSensitiveData(entry.message)) : undefined,
    fields: sanitizeLogFields(entry.fields || {}),
  };
  return JSON.stringify(safe);
}

export function logRequest(
  severity: LogSeverity,
  event: string,
  fields: RequestLogFields,
  message?: string,
): void {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    severity,
    event,
    message,
    fields: fields as Record<string, unknown>,
  };
  const line = formatStructuredLog(entry);
  if (severity === "error" || severity === "fatal") {
    console.error(line);
  } else if (severity === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logTransaction(
  severity: LogSeverity,
  event: string,
  fields: TransactionLogFields,
  message?: string,
): void {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    severity,
    event,
    message,
    fields: fields as Record<string, unknown>,
  };
  const line = formatStructuredLog(entry);
  if (severity === "error" || severity === "fatal") {
    console.error(line);
  } else if (severity === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Standardized error response middleware.
 * Wraps route handler errors into consistent rejection explanation format.
 * Ensures all errors return: status code, error code, user-friendly message, and recovery hint.
 */
export function errorHandlerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Capture the original send method
  const originalSend = res.send;

  // Override res.send to intercept error responses
  res.send = function (body: any) {
    // If this is an error response (status >= 400) and body is an Error object
    if (res.statusCode >= 400 && body instanceof Error) {
      const explanation = mapFailureToRejection(body);
      logRequest(
        explanation.status >= 500 ? "error" : "warn",
        "request.error",
        {
          correlationId: req.correlationId,
          method: req.method,
          route: req.originalUrl || req.url,
          statusCode: explanation.status,
        },
        explanation.message
      );
      res.status(explanation.status).json({
        error: explanation.reason,
        code: explanation.code,
        message: explanation.message,
        hint: explanation.hint,
        recoveryPath: explanation.recoveryPath,
        correlationId: req.correlationId,
      });
    } else {
      // Pass through normally
      originalSend.call(this, body);
    }
  };

  next();
}

/**
 * Async error wrapper for route handlers.
 * Catches async errors and maps them to standardized rejection explanations.
 */
export function asyncWrapper(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req, res, next);
    } catch (err) {
      const error = err as Error & {
        code?: string;
        status?: number;
        rejectionCode?: RejectionCode;
      };

      // If the error already has a rejectionCode, use it directly
      if (error.rejectionCode) {
        const explanation = REJECTION_EXPLANATIONS[error.rejectionCode] || REJECTION_EXPLANATIONS.not_found;
        const status = error.status || explanation.status;
        logRequest(
          status >= 500 ? "error" : "warn",
          "request.rejection",
          {
            correlationId: req.correlationId,
            method: req.method,
            route: req.originalUrl || req.url,
            statusCode: status,
          },
          explanation.message
        );
        res.status(status).json({
          error: explanation.reason,
          code: explanation.code,
          message: explanation.message,
          hint: explanation.hint,
          recoveryPath: explanation.recoveryPath,
          correlationId: req.correlationId,
        });
        return;
      }

      // Otherwise, map the error to a rejection explanation
      const explanation = mapFailureToRejection(error);

      // Preserve any additional error context
      const response: Record<string, unknown> = {
        error: explanation.reason,
        code: explanation.code,
        message: explanation.message,
        hint: explanation.hint,
        recoveryPath: explanation.recoveryPath,
        correlationId: req.correlationId,
      };

      logRequest(
        explanation.status >= 500 ? "error" : "warn",
        "request.error",
        {
          correlationId: req.correlationId,
          method: req.method,
          route: req.originalUrl || req.url,
          statusCode: explanation.status,
        },
        explanation.message
      );
      res.status(explanation.status).json(response);
    }
  };
}
