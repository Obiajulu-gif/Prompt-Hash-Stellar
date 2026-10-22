/**
 * Sensitive-content boundaries for outbound surfaces (#sensitive-content).
 *
 * Central place for the escaping/redaction primitives every outbound boundary
 * (CSV downloads, webhook payloads, exports) must use:
 *
 *   - `escapeCsvField` / `toCsvRow` / `buildCsv` — RFC4180 escaping plus
 *     spreadsheet formula-injection neutralization, so a crafted prompt title
 *     or buyer address can never execute in a reviewer's spreadsheet.
 *   - `sanitizeAttachmentFilename` / `contentDispositionValue` — strips CR/LF,
 *     quotes, path separators, and control characters so a route parameter can
 *     never inject a header or traverse a path in a download response.
 *   - `redactSensitiveFields` — deep deny-list redaction for anything that
 *     ships off-box (webhook payloads, exports) with depth/entry/string
 *     bounds so hostile nesting can't cause unbounded work.
 *   - `projectAllowedFields` — strict allow-list projection for exports.
 */

import { createHash } from "node:crypto";

// ── CSV / spreadsheet safety ─────────────────────────────────────────────────

/** Leading characters spreadsheets treat as the start of a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

const MAX_CSV_FIELD_LENGTH = 32_768;

/**
 * Neutralize spreadsheet formula triggers by prefixing a `'` when a value
 * would otherwise start a formula. Used both by the always-quoted escaper and
 * by writers that reproduce the historical unquoted format for controlled
 * enum/number cells.
 */
export function neutralizeCsvFormula(value: unknown): string {
  const text = String(value ?? "");
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

/**
 * Quote + escape a cell without changing the historical quoting style: quote
 * doubling and formula neutralization, always surrounded by quotes.
 */
export function escapeQuotedCsvField(value: unknown): string {
  return `"${neutralizeCsvFormula(value).replace(/"/g, '""')}"`;
}

/**
 * Escape a single value for inclusion in a CSV cell.
 * - neutralizes formula-leading characters for strings (`'` prefix),
 * - doubles embedded quotes,
 * - always quotes the field so embedded commas/newlines cannot break columns.
 * Finite numbers bypass formula neutralization (a negative amount is data,
 * not a formula) but are still quoted for determinism.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '""';

  const isNumber = typeof value === "number" && Number.isFinite(value);
  const text = String(value).slice(0, MAX_CSV_FIELD_LENGTH);
  if (isNumber) {
    return `"${text}"`;
  }
  return escapeQuotedCsvField(text);
}

export function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsvField).join(",");
}

export function buildCsv(header: string[], rows: unknown[][]): string {
  return [toCsvRow(header), ...rows.map(toCsvRow)].join("\n");
}

// ── Download / attachment headers ────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f"\\/:*?<>|]/g;

/**
 * Reduce an arbitrary string (typically a route parameter) to a safe
 * attachment filename: no control characters, no CR/LF (header injection), no
 * quotes/backslashes (header corruption), no path separators (traversal), and
 * a bounded length.
 */
export function sanitizeAttachmentFilename(
  filename: string,
  fallback = "download",
): string {
  const cleaned = String(filename ?? "")
    .replace(UNSAFE_FILENAME_CHARS, "_")
    .replace(/\.\./g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  // Input that consisted only of unsafe/whitespace characters is a miss, not
  // a filename made of underscores.
  if (!cleaned || /^[_\s]+$/.test(cleaned)) return fallback;
  return cleaned;
}

/**
 * Build a `Content-Disposition` value with a sanitized filename. Use
 * `res.setHeader("Content-Disposition", contentDispositionValue(name))`.
 */
export function contentDispositionValue(
  filename: string,
  fallback = "download",
): string {
  return `attachment; filename="${sanitizeAttachmentFilename(filename, fallback)}"`;
}

// ── Deep redaction for outbound payloads ────────────────────────────────────

const SENSITIVE_KEY_PATTERN =
  /(secret|private[_-]?key|privatekey|mnemonic|seed[_-]?phrase|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|bearer|encrypted[_-]?prompt|plaintext|ciphertext|signing[_-]?secret|challenge[_-]?secret|salt|nonce)/i;

export interface RedactionOptions {
  /** Maximum object depth to walk (default 6). Deeper values become "[TRUNCATED]". */
  maxDepth?: number;
  /** Maximum sibling entries to keep per object/array (default 100). */
  maxEntries?: number;
  /** Maximum string length kept per value (default 4096). */
  maxStringLength?: number;
  /** Replacement marker for redacted values. */
  marker?: string;
}

function redactValue(
  value: unknown,
  depth: number,
  opts: Required<RedactionOptions>,
): unknown {
  if (depth > opts.maxDepth) return "[TRUNCATED]";

  if (typeof value === "string") {
    return value.length > opts.maxStringLength
      ? `${value.slice(0, opts.maxStringLength)}…[truncated:${value.length}]`
      : value;
  }
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value
      .slice(0, opts.maxEntries)
      .map((entry) => redactValue(entry, depth + 1, opts));
  }

  const result: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (kept >= opts.maxEntries) break;
    kept += 1;
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? opts.marker
      : redactValue(entry, depth + 1, opts);
  }
  return result;
}

/**
 * Deep-copy `value`, replacing values whose key matches the sensitive
 * deny-list with `[REDACTED]`. Also bounds depth, sibling count, and string
 * length so adversarial payloads cannot blow up storage or logs.
 */
export function redactSensitiveFields<T = unknown>(
  value: T,
  options: RedactionOptions = {},
): T {
  const opts: Required<RedactionOptions> = {
    maxDepth: options.maxDepth ?? 6,
    maxEntries: options.maxEntries ?? 100,
    maxStringLength: options.maxStringLength ?? 4096,
    marker: options.marker ?? "[REDACTED]",
  };
  return redactValue(value, 0, opts) as T;
}

// ── Allow-list projection for exports ───────────────────────────────────────

/**
 * Return a new object containing only `allowList` keys. Exports use this so
 * adding a private field to a model can never silently leak it into a
 * download — the projection must be extended deliberately.
 */
export function projectAllowedFields<T extends Record<string, unknown>>(
  record: T,
  allowList: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowList) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      result[key] = record[key];
    }
  }
  return result;
}

/** Stable, non-reversible reference for untrusted identifiers in reports. */
export function opaqueRef(value: string): string {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}
