/**
 * Preview sanitization helpers — shared by client and documented for server parity.
 *
 * Uses a maintained allowlist (see markdownPolicy.ts) rather than ad-hoc regex.
 * For string-level sanitization outside of React (e.g. previewCount, truncate),
 * use `sanitizePreviewText`. The React path goes through rehype-sanitize.
 */
import {
  isSafeUrl,
  isSafeImageUrl,
  isDangerousAttribute,
  MAX_PREVIEW_LENGTH,
  MAX_PREVIEW_LINES,
} from "./markdownPolicy";

/**
 * Truncate preview text to prevent layout breakage / DoS via huge payloads.
 * Keeps line count and character count bounded.
 */
export function truncatePreview(input: string, maxLength = MAX_PREVIEW_LENGTH, maxLines = MAX_PREVIEW_LINES): string {
  let out = input.slice(0, maxLength);
  const lines = out.split("\n");
  if (lines.length > maxLines) {
    out = lines.slice(0, maxLines).join("\n");
  }
  return out;
}

/**
 * Very small, deterministic text-only escape for cases where markdown is
 * not rendered (e.g. title attribute, meta). This is NOT the main sanitizer —
 * rehype-sanitize is — but it prevents accidental HTML injection in text contexts.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Validate and normalize a link href for preview rendering.
 * Returns null if unsafe to render as <a>.
 */
export function sanitizeLinkHref(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  // Block javascript:, data:, vbscript:, etc.
  if (/^\s*javascript:/i.test(trimmed)) return null;
  if (/^\s*data:/i.test(trimmed)) return null;
  if (/^\s*vbscript:/i.test(trimmed)) return null;
  if (!isSafeUrl(trimmed)) return null;
  // Block URLs with embedded newlines or control chars that may bypass checks
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Validate image src. Only https is allowed for marketplace previews.
 */
export function sanitizeImageSrc(src: string | undefined): string | null {
  if (!src) return null;
  const trimmed = src.trim();
  if (!isSafeImageUrl(trimmed)) return null;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Attributes that must never appear in preview DOM.
 */
export function filterAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (isDangerousAttribute(key)) continue;
    // Allow only string-ish values, drop objects/functions
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    out[key] = value;
  }
  return out;
}

/**
 * Server/client parity helper: produce a normalized preview plan.
 * Used for visual testing and to assert both layers behave the same.
 */
export interface SanitizedPreviewInfo {
  originalLength: number;
  truncatedLength: number;
  truncated: boolean;
  lineCount: number;
}

export function analyzePreview(input: string): SanitizedPreviewInfo {
  const originalLength = input.length;
  const truncated = truncatePreview(input);
  return {
    originalLength,
    truncatedLength: truncated.length,
    truncated: truncated.length < originalLength,
    lineCount: truncated.split("\n").length,
  };
}
