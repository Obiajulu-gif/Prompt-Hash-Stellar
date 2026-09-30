/**
 * Marketplace preview markdown policy — Issue: Preview XSS hardening
 *
 * This module is the single source of truth for what markdown is supported
 * in creator-provided previews and how it is rendered safely.
 *
 * Server and client MUST stay in sync: see `server/src/services/previewSanitize.ts`
 * which mirrors this policy. Any change here must be mirrored there and
 * documented below.
 *
 * ## Supported markdown subset
 *
 * Allowed block/inline constructs (via remark-gfm):
 * - Headings h1–h3 (h4–h6 are downgraded to h3 for layout stability)
 * - Paragraphs, line breaks
 * - Strong, emphasis, inline code
 * - Code blocks (fenced, no language execution)
 * - Blockquote
 * - Unordered and ordered lists
 * - Horizontal rule
 * - Links `[label](https://...)` — only http/https, rendered with
 *   target="_blank" rel="noopener noreferrer" and external indicator
 * - Images `![alt](https://...)` — only https, no data: or blob:, lazy-loaded,
 *   with constrained dimensions to prevent layout breakage
 * - GFM tables, strikethrough, task lists (rendered as static, no inputs)
 *
 * Not supported (stripped or escaped):
 * - Raw HTML: script, style, iframe, object, embed, form, input, button,
 *   svg, math, canvas, link, meta, base, title, etc. — stripped
 * - Event handlers: any `on*` attribute (onclick, onerror, onload …) — stripped
 * - Style attributes and javascript: URLs — stripped / blocked
 * - Auto-embedded iframes / embeds (YouTube, etc.) — not allowed; show
 *   plain link instead
 * - Footnotes, definition lists, custom containers — stripped
 *
 * ## Sanitization
 *
 * Uses a maintained sanitizer (rehype-sanitize / hast-util-sanitize) with a
 * restrictive allowlist instead of ad-hoc regex. Configuration is in
 * `MARKDOWN_SANITIZE_SCHEMA` and `isSafeUrl`.
 *
 * Layout breakage mitigations:
 * - Long words/URLs are CSS word-broken (prose container)
 * - Images are constrained (max-w-full, height auto, rounded)
 * - Code blocks are scrollable, not expanding layout
 * - Tables are wrapped in overflow-x-auto (via prose)
 */

/** Tags we intentionally allow. Everything else is stripped. */
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

export type AllowedTag = (typeof ALLOWED_TAGS)[number];

/** Attributes allowed per tag. No `style`, no `on*`. */
export const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title", "rel", "target"],
  img: ["src", "alt", "title", "loading", "width", "height"],
  code: ["className"],
  pre: ["className"],
  span: ["className"],
  div: ["className"],
  th: ["align"],
  td: ["align"],
};

/** Only these protocols are allowed in href/src */
export const ALLOWED_PROTOCOLS = ["http", "https"] as const;

/** For images we are stricter: only https to avoid mixed-content and data exfiltration */
export const ALLOWED_IMAGE_PROTOCOLS = ["https"] as const;

export const MAX_PREVIEW_LENGTH = 20_000;
export const MAX_PREVIEW_LINES = 500;

/**
 * hast-util-sanitize schema consumed by rehype-sanitize.
 * Keep in sync with server/src/services/previewSanitize.ts `PREVIEW_SANITIZE_SCHEMA`.
 */
export const MARKDOWN_SANITIZE_SCHEMA = {
  tagNames: [...ALLOWED_TAGS],
  attributes: {
    ...ALLOWED_ATTRIBUTES,
    // rehype-sanitize expects `tagName: [attr, ...]` including global allowance
    // we keep it explicit — no global `*` attributes except what we list
  },
  // Strip comments, do not allow unknown protocols
  protocols: {
    href: [...ALLOWED_PROTOCOLS],
    src: [...ALLOWED_IMAGE_PROTOCOLS],
    cite: [...ALLOWED_PROTOCOLS],
  },
  // Explicitly strip these even if they slip in via markdown HTML
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
  ],
  // Clobber any attribute that looks like an event handler or style
  // hast-util-sanitize v11 supports `strip` but we also enforce via transform
  // in the React component level (see sanitize.ts)
} as const;

/**
 * Normalizes and decodes obfuscated characters to check for protocol evasion.
 */
function normalizeObfuscatedUrl(raw: string): string {
  let normalized = raw.replace(/[\x00-\x1f\x7f]/g, "").trim();

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
 * Check whether a URL string uses an allowed protocol.
 * Returns false for javascript:, data:, vbscript:, file:, blob:, embedded credentials, etc.
 */
export function isSafeUrl(url: string, allowList: readonly string[] = ALLOWED_PROTOCOLS): boolean {
  if (!url || typeof url !== "string") return false;

  const normalized = normalizeObfuscatedUrl(url);
  if (!normalized) return false;

  // Relative URLs and anchors are treated as unsafe in previews — force absolute
  // to prevent open-redirect or base-tag tricks.
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

export function isSafeImageUrl(url: string): boolean {
  return isSafeUrl(url, ALLOWED_IMAGE_PROTOCOLS);
}

/**
 * Extra guard: detect event-handler-like attribute names.
 */
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

export const SUPPORTED_MARKDOWN_DOC = `
Supported preview markdown:
- headings (#, ##, ###), paragraphs, bold/italic, inline code, code blocks
- blockquote (>), lists (- / 1.), horizontal rule (---)
- links [label](https://example.com) — https only, opens in new tab with indicator
- images ![alt](https://example.com/img.png) — https only, constrained
- GFM: tables, strikethrough (~~text~~), task lists (- [x])
Not supported: raw HTML, scripts, iframes, embeds, style attributes, event handlers, javascript: URLs.
`.trim();
