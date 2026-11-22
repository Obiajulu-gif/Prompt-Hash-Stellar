import { logger } from "./structuredLogger";

type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured logger that never receives raw wallet keys or signatures.
 * Callers pass an allow-listed field set; redaction is applied before output.
 */
export function redactLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...fields };
  for (const key of Object.keys(redacted)) {
    if (/secret|signature|token|private|key/i.test(key)) {
      redacted[key] = "[redacted]";
    }
  }
  return redacted;
}

export function safeLog(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  logger[level](message, redactLogFields(fields));
}

export default { safeLog, redactLogFields };
