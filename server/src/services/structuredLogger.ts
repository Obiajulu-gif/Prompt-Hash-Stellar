type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = new Set([
  "prompt", "promptText", "content", "systemMessage", "userInput",
  "previewPrompt", "encryptedPrompt", "encryptionIv", "wrappedKey",
  "secret", "token", "signature", "privateKey", "mnemonic", "seed",
  "password", "apiKey", "authorization", "cookie", "walletAddress",
  "wallet", "buyerWallet", "address", "to", "from",
]);

const SENSITIVE_PATTERNS = [
  /wallet/i, /secret/i, /token/i, /key/i, /auth/i,
  /credential/i, /private/i, /mnemonic/i, /seed/i,
];

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;
  return SENSITIVE_PATTERNS.some(p => p.test(key));
}

function maskValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length <= 8) return "[REDACTED]";
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return "[REDACTED]";
  return "[REDACTED]";
}

export function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = maskValue(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = redact(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

interface LogContext {
  requestId?: string;
  userId?: string;
  action?: string;
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { context: redact(context) } : {}),
  };
  return JSON.stringify(entry);
}

class StructuredLogger {
  private minLevel: LogLevel;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(minLevel: LogLevel = "info") {
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.minLevel];
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog("debug")) {
      console.debug(formatLog("debug", message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog("info")) {
      console.info(formatLog("info", message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog("warn")) {
      console.warn(formatLog("warn", message, context));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog("error")) {
      console.error(formatLog("error", message, context));
    }
  }
}

const envLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
export const logger = new StructuredLogger(envLevel);
