/**
 * Server-side preview sanitization — mirrors src/lib/preview/markdownPolicy.ts
 *
 * Keep this file in sync with `src/lib/preview/markdownPolicy.ts`.
 * Both define the same allowlist, protocols, and truncation rules so preview
 * output is consistent between server validation and client rendering.
 *
 * Server uses a maintained approach: when stored previews are indexed,
 * we validate with the allowlist and strip unsafe HTML before persisting.
 * Runtime markdown rendering still happens client-side via rehype-sanitize,
 * but server rejects obviously unsafe payloads early.
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
  ],
} as const;

export function isSafeUrl(url: string, allowList: readonly string[] = ALLOWED_PROTOCOLS): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();
    return (allowList as readonly string[]).includes(protocol);
  } catch {
    return false;
  }
}

export function isSafeImageUrl(url: string): boolean {
  return isSafeUrl(url, ALLOWED_IMAGE_PROTOCOLS);
}

export function isDangerousAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("on") || lower === "style" || lower === "xmlns" || lower === "formaction" || lower === "xlink:href";
}

export function truncatePreview(input: string, maxLength = MAX_PREVIEW_LENGTH, maxLines = MAX_PREVIEW_LINES): string {
  let out = input.slice(0, maxLength);
  const lines = out.split("\n");
  if (lines.length > maxLines) out = lines.slice(0, maxLines).join("\n");
  return out;
}

export function sanitizePreviewText(input: string): string {
  // Strip obvious XSS vectors at persistence time — client does full sanitization via rehype-sanitize
  // We keep this regex-free where possible, using simple string checks + URL validation.
  let out = truncatePreview(input);
  // Remove <script>, <style>, <iframe> blocks entirely (case-insensitive)
  out = out.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  out = out.replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, "");
  out = out.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  out = out.replace(/<\s*object[^>]*>[\s\S]*?<\s*\/\s*object\s*>/gi, "");
  out = out.replace(/<\s*embed[^>]*\/?>/gi, "");
  // Strip javascript:/data:/vbscript: in markdown links/images — replace with safe placeholder
  out = out.replace(/\[\s*([^\]]*)\s*\]\s*\(\s*javascript:[^)]*\)/gi, "[$1](#)");
  out = out.replace(/!\s*\[\s*([^\]]*)\s*\]\s*\(\s*data:[^)]*\)/gi, "![$1](https://example.invalid/blocked)");
  // Strip event handler attributes that may have been injected as raw HTML
  out = out.replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/\bstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return out;
}

export interface PreviewValidationResult {
  safeText: string;
  truncated: boolean;
  hadDangerousContent: boolean;
}

export function validateAndSanitizePreview(input: string): PreviewValidationResult {
  const truncated = input.length > MAX_PREVIEW_LENGTH || input.split("\n").length > MAX_PREVIEW_LINES;
  const safeText = sanitizePreviewText(input);
  const hadDangerousContent = safeText.length !== input.length || /<\s*(script|iframe|object|embed|style)/i.test(input) || /javascript:/i.test(input) || /\bon\w+\s*=/i.test(input);
  return { safeText, truncated, hadDangerousContent };
}
