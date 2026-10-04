import { sha256 } from "js-sha256";

export interface ProtectedValueOptions {
  maxLength?: number;
  hashIdentifier?: boolean;
}

const HIGH_CARDINALITY_KEYS = new Set([
  "userInput",
  "promptText",
  "rawPayload",
  "searchQuery",
  "customMetadata",
  "description",
  "bio",
  "signatureBlob",
  "userPayload",
  "rawInput",
  "query",
]);

const IDENTIFIER_KEYS = new Set([
  "userId",
  "userAddress",
  "email",
  "sessionId",
  "ipAddress",
]);

/**
 * Hash a high-cardinality identifier into a safe correlation token for logging.
 * Preserves debuggability without logging raw high-cardinality user values.
 */
export function hashUserIdentifier(identifier: string): string {
  if (!identifier) return "[EMPTY]";
  const hash = sha256(identifier).substring(0, 12);
  return `corr_${hash}`;
}

/**
 * Truncate long user-provided strings to prevent unbounded log storage.
 */
export function truncateValue(val: string, maxLength: number = 64): string {
  if (!val) return "";
  if (val.length <= maxLength) return val;
  return `${val.substring(0, maxLength)}...[truncated length=${val.length}]`;
}

/**
 * Classify payload sizes into low-cardinality metrics buckets.
 */
export function classifyPayloadSize(sizeInBytes: number): string {
  if (sizeInBytes <= 128) return "small_le_128b";
  if (sizeInBytes <= 1024) return "medium_le_1kb";
  if (sizeInBytes <= 10240) return "large_le_10kb";
  return "xlarge_gt_10kb";
}

/**
 * Recursively sanitize log context object to protect high-cardinality and sensitive user values.
 */
export function protectHighCardinalityPayload(
  obj: unknown,
  maxLength: number = 64
): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return truncateValue(obj, maxLength);
  }
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => protectHighCardinalityPayload(item, maxLength));
  }

  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (IDENTIFIER_KEYS.has(key) && typeof val === "string") {
      result[key] = hashUserIdentifier(val);
    } else if (HIGH_CARDINALITY_KEYS.has(key) && typeof val === "string") {
      result[key] = truncateValue(val, maxLength);
    } else if (typeof val === "object" && val !== null) {
      result[key] = protectHighCardinalityPayload(val, maxLength);
    } else if (typeof val === "string" && val.length > maxLength) {
      result[key] = truncateValue(val, maxLength);
    } else {
      result[key] = val;
    }
  }

  return result;
}
