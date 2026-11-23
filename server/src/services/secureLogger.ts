import { logger, redact } from "./structuredLogger";

export type SafeLogLevel = "debug" | "info" | "warn" | "error";

/**
 * Redact deny-listed fields before they reach the log sink. Kept as a named
 * export because security-sensitive call sites (wallet sessions) import it
 * directly.
 */
export function redactLogFields(payload: unknown): unknown {
  return redact(payload);
}

/** Emit a structured log line with secret redaction applied to its metadata. */
export function safeLog(
  level: SafeLogLevel,
  event: string,
  meta: Record<string, unknown> = {},
): void {
  const redacted = redactLogFields(meta);
  logger[level](
    event,
    redacted && typeof redacted === "object"
      ? (redacted as Record<string, unknown>)
      : {},
  );
}
