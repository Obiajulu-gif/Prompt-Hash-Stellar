/**
 * Server-side preview & untrusted content sanitization — mirrors src/lib/preview/markdownPolicy.ts
 *
 * Keep this file in sync with `src/lib/preview/markdownPolicy.ts`.
 * Both define the same allowlist, protocols, and truncation rules so preview
 * output is consistent between server validation and client rendering (#808).
 *
 * Server uses a maintained approach: when stored previews or external links
 * are indexed/persisted, we validate against the allowlist and strip unsafe
 * HTML, protocol abuse, and credential injection.
 */

export const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "p",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "em",
  "strong",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "del",
  "span",
  "div",
] as const;

export const ALLOWED_PROTOCOLS = ["http", "https"] as const;
export const ALLOWED_IMAGE_PROTOCOLS = ["https"] as const;
export const MAX_PREVIEW_LENGTH = 20_000;
export const MAX_PREVIEW_LINES = 500;
export const MAX_METADATA_STRING_LENGTH = 2_000;

export const PREVIEW_SANITIZE_SCHEMA = {
  tagNames: [...ALLOWED_TAGS],
  protocols: {
    href: [...ALLOWED_PROTOCOLS],
    src: [...ALLOWED_IMAGE_PROTOCOLS],
  },
  strip: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "link",
    "meta",
    "base",
    "title",
    "svg",
    "math",
    "canvas",
    "frame",
    "frameset",
    "applet",
    "audio",
    "video",
    "source",
    "track",
    "picture",
    "map",
    "area",
    "details",
    "dialog",
  ],
} as const;

/**
 * Normalizes and decodes obfuscated characters to check for protocol evasion.
 */
function normalizeObfuscatedUrl(raw: string): string {
  // Strip null bytes and control characters
  let normalized = raw.replace(/[\x00-\x1f\x7f]/g, "").trim();

  // Decode common HTML entity evasion (e.g. &#x6a;avascript: or &#58;)
  normalized = normalized.replace(/&#x([0-9a-fA-F]+);?/gi, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return "";
    }
  });
  normalized = normalized.replace(/&#([0-9]+);?/g, (_, dec) => {
    try {
      return String.fromCharCode(parseInt(dec, 10));
    } catch {
      return "";
    }
  });

  return normalized;
}

/**
 * Validates whether a URL is safe for external links or redirects.
 * Disallows javascript:, data:, vbscript:, file:, blob:, embedded credentials,
 * and relative path traversal.
 */
export function isSafeUrl(
  url: string,
  allowList: readonly string[] = ALLOWED_PROTOCOLS,
): boolean {
  if (!url || typeof url !== "string") return false;

  const normalized = normalizeObfuscatedUrl(url);
  if (!normalized) return false;

  // Block relative paths and anchor jumps if external URLs are expected
  if (
    normalized.startsWith("#") ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    return false;
  }

  // Detect whitespace/tab injection before or within scheme (e.g. 'jav\tascript:')
  const schemeCandidate = normalized.split(":")[0];
  if (/[\s\r\n\t]/.test(schemeCandidate)) {
    return false;
  }

  // Pre-filter forbidden protocol patterns
  if (
    /^(javascript|vbscript|data|file|blob|about|filesystem):/i.test(
      normalized.replace(/\s+/g, ""),
    )
  ) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();

    // Reject URLs with embedded credentials (e.g. https://user:pass@victim.com)
    if (parsed.username || parsed.password) {
      return false;
    }

    // Hostname must be non-empty and valid
    if (!parsed.hostname || parsed.hostname.trim() === "") {
      return false;
    }

    return (allowList as readonly string[]).includes(protocol);
  } catch {
    return false;
  }
}

/**
 * Stricter check for images — only https is permitted to prevent mixed content and data leaks.
 */
export function isSafeImageUrl(url: string): boolean {
  return isSafeUrl(url, ALLOWED_IMAGE_PROTOCOLS);
}

/**
 * Validates and returns a sanitized external URL string, or null if unsafe.
 */
export function sanitizeExternalUrl(
  url: string | null | undefined,
  allowList: readonly string[] = ALLOWED_PROTOCOLS,
): string | null {
  if (!url) return null;
  const clean = normalizeObfuscatedUrl(url);
  return isSafeUrl(clean, allowList) ? clean : null;
}

export function isDangerousAttribute(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return (
    lower.startsWith("on") ||
    lower === "style" ||
    lower === "xmlns" ||
    lower === "formaction" ||
    lower === "xlink:href" ||
    lower.startsWith("data-")
  );
}

export function truncatePreview(
  input: string,
  maxLength = MAX_PREVIEW_LENGTH,
  maxLines = MAX_PREVIEW_LINES,
): string {
  let out = input.slice(0, maxLength);
  const lines = out.split("\n");
  if (lines.length > maxLines) out = lines.slice(0, maxLines).join("\n");
  return out;
}

/**
 * Sanitizes markdown preview content by stripping dangerous HTML elements,
 * event handlers, style attributes, and protocol-abusing link targets.
 */
export function sanitizePreviewText(input: string): string {
  let out = truncatePreview(input);

  // 1. Remove dangerous HTML block elements and script containers entirely
  const dangerousTags = [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "form",
    "input",
    "button",
    "applet",
    "meta",
    "link",
    "base",
    "dialog",
  ];

  for (const tag of dangerousTags) {
    const blockRegex = new RegExp(
      `<\\s*${tag}[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`,
      "gi",
    );
    out = out.replace(blockRegex, "");
    const selfClosingRegex = new RegExp(`<\\s*${tag}[^>]*\\/?>`, "gi");
    out = out.replace(selfClosingRegex, "");
  }

  // 2. Strip event handler attributes (e.g. onerror="...", onclick=...)
  out = out.replace(/\bon[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 3. Strip inline style attributes
  out = out.replace(/\bstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 4. Neutralize dangerous image protocols (before general markdown links)
  out = out.replace(
    /!\s*\[\s*([^\]]*)\s*\]\s*\(\s*(?:javascript|data|vbscript|file|blob|http):[^)]*\)/gi,
    "![$1](https://example.invalid/blocked)",
  );

  // 5. Neutralize dangerous link protocols in markdown link formats (not preceded by !)
  out = out.replace(
    /(^|[^!])\[\s*([^\]]*)\s*\]\s*\(\s*(?:javascript|data|vbscript|file|blob):[^)]*\)/gi,
    "$1[$2](#)",
  );

  return out;
}

/**
 * Sanitizes untrusted plain text metadata (titles, tags, biographies) by escaping
 * HTML characters and constraining length.
 */
export function sanitizePlainMetadata(
  input: string,
  maxLength = MAX_METADATA_STRING_LENGTH,
): string {
  if (!input || typeof input !== "string") return "";

  const truncated = input.slice(0, maxLength);
  return truncated
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

export interface PreviewValidationResult {
  safeText: string;
  truncated: boolean;
  hadDangerousContent: boolean;
}

export function validateAndSanitizePreview(
  input: string,
): PreviewValidationResult {
  const truncated =
    input.length > MAX_PREVIEW_LENGTH ||
    input.split("\n").length > MAX_PREVIEW_LINES;
  const safeText = sanitizePreviewText(input);
  const hadDangerousContent =
    safeText.length !== input.length ||
    /<\s*(script|iframe|object|embed|style|svg|math)/i.test(input) ||
    /javascript:/i.test(input) ||
    /\bon[a-z0-9_-]+\s*=/i.test(input);

  return { safeText, truncated, hadDangerousContent };
}
