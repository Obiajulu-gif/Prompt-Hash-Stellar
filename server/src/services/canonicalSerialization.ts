/**
 * Canonical Serialization for Signed & Hashed Data
 *
 * Ensures equivalent inputs produce consistent signatures and hashes
 * by normalizing whitespace, field ordering, numeric precision, and casing.
 */

export interface CanonicalOptions {
  /** Normalize whitespace (trim, remove extra spaces) */
  normalizeWhitespace?: boolean;
  /** Sort object keys alphabetically */
  sortKeys?: boolean;
  /** Normalize numeric values to fixed precision */
  numericPrecision?: number;
  /** Lowercase string values for case-insensitive comparison */
  lowerCase?: boolean;
}

const DEFAULT_OPTIONS: CanonicalOptions = {
  normalizeWhitespace: true,
  sortKeys: true,
  numericPrecision: 18, // For financial/blockchain values
  lowerCase: false,
};

/**
 * Canonicalize a value for signing/hashing.
 * Handles objects, arrays, primitives, and dates.
 */
export function canonicalize(
  value: unknown,
  options: CanonicalOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return JSON.stringify(canonicalizeValue(value, opts));
}

function canonicalizeValue(value: unknown, opts: CanonicalOptions): unknown {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle primitives
  if (typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && opts.numericPrecision !== undefined) {
      // Normalize numeric precision to prevent floating-point inconsistencies
      return parseFloat(value.toFixed(opts.numericPrecision));
    }
    return value;
  }

  if (typeof value === "string") {
    let result = value;
    if (opts.normalizeWhitespace) {
      result = result.trim().replace(/\s+/g, " ");
    }
    if (opts.lowerCase) {
      result = result.toLowerCase();
    }
    return result;
  }

  // Handle dates - convert to ISO string
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle arrays - canonicalize each element
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item, opts));
  }

  // Handle objects - sort keys and canonicalize values
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    const keys = Object.keys(obj);
    const sortedKeys = opts.sortKeys ? keys.sort() : keys;

    for (const key of sortedKeys) {
      if (obj.hasOwnProperty(key)) {
        result[key] = canonicalizeValue(obj[key], opts);
      }
    }

    return result;
  }

  return value;
}

/**
 * Hash a value using canonical serialization.
 * Returns hex-encoded SHA-256 hash.
 */
export async function canonicalHash(
  value: unknown,
  options?: CanonicalOptions
): Promise<string> {
  const canonical = canonicalize(value, options);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify that a value, when canonicalized, matches an expected hash.
 */
export async function verifyCanonicalHash(
  value: unknown,
  expectedHash: string,
  options?: CanonicalOptions
): Promise<boolean> {
  const actualHash = await canonicalHash(value, options);
  return actualHash === expectedHash;
}

/**
 * Normalize input for comparison without serializing to JSON.
 * Useful for pre-validation before hashing.
 */
export function normalizeInput(
  value: unknown,
  options: CanonicalOptions = {}
): unknown {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return canonicalizeValue(value, opts);
}

/**
 * Test compatibility: check if legacy and new formats serialize to the same canonical form.
 */
export function isCanonicallyEquivalent(
  legacyValue: unknown,
  newValue: unknown,
  options?: CanonicalOptions
): boolean {
  return (
    canonicalize(legacyValue, options) === canonicalize(newValue, options)
  );
}
