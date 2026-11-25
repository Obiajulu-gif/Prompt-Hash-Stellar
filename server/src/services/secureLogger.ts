import { logger, redact } from "./structuredLogger.js";

export function redactLogFields<T>(obj: T): T {
  return redact(obj) as T;
}

export function safeLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: Record<string, any>
): void {
  const redactedMeta = meta ? (redact(meta) as Record<string, any>) : undefined;
  if (logger && typeof (logger as any)[level] === "function") {
    (logger as any)[level](message, redactedMeta);
  } else {
    console[level](message, redactedMeta);
  }
}
