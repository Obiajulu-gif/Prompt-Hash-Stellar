import { logger, redact } from "./structuredLogger.js";

export type SecureLogLevel = "debug" | "info" | "warn" | "error";

/**
 * Redact sensitive values from a log context before it is written.
 * Delegates to the central structured logger redaction so every server log
 * path shares one allow-list.
 */
export function redactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redact(fields) as Record<string, unknown>;
}

/**
 * Log a wallet-session event with secrets redacted.
 */
export function safeLog(
  level: SecureLogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  logger[level](event, redactLogFields(fields));
}
