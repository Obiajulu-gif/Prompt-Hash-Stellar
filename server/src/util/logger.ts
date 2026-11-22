/**
 * Compatibility logger for legacy services that import `../util/logger`.
 * Delegates to the structured logger so every line keeps the same redaction
 * and JSON envelope as the rest of the server.
 */
import { logger as structuredLogger } from "../services/structuredLogger";

type Meta = unknown;

function messageOf(message: unknown): string {
  return typeof message === "string" ? message : String(message);
}

function metaOf(meta: Meta): Record<string, unknown> | undefined {
  if (meta === undefined || meta === null) return undefined;
  if (typeof meta === "object" && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return { details: meta };
}

export const logger = {
  debug(message: unknown, meta?: Meta): void {
    structuredLogger.debug(messageOf(message), metaOf(meta));
  },
  info(message: unknown, meta?: Meta): void {
    structuredLogger.info(messageOf(message), metaOf(meta));
  },
  warn(message: unknown, meta?: Meta): void {
    structuredLogger.warn(messageOf(message), metaOf(meta));
  },
  error(message: unknown, meta?: Meta): void {
    structuredLogger.error(messageOf(message), metaOf(meta));
  },
};
