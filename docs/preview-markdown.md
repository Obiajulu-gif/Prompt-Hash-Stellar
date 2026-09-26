# Preview Markdown Policy

Creator-provided preview content is rendered in the marketplace as sanitized markdown.
This document describes the supported subset, sanitization rules, and the server/client consistency guarantee.

## Supported markdown subset

| Construct | Example | Notes |
|-----------|---------|-------|
| Headings | `# H1` `## H2` `### H3` | `####`–`######` are visually downgraded to `h3` for layout stability |
| Paragraphs, breaks | blank line, `  ` + newline | CSS `break-words` prevents long tokens from breaking layout |
| Emphasis | `*italic*`, `**bold**` | `em`, `strong` |
| Inline code | `` `code` `` | `code` — no execution, styled inline |
| Code blocks | ```` ```js ... ``` ```` | `pre > code`, scrollable overflow |
| Blockquote | `> quote` | `blockquote` |
| Lists | `- item`, `1. item` | `ul`/`ol`/`li` |
| Horizontal rule | `---` | `hr` |
| Links | `[label](https://example.com)` | Only `http`/`https`; rendered `target="_blank" rel="noopener noreferrer"` with `↗` external indicator and `title` showing destination |
| Images | `![alt](https://example.com/img.png)` | Only `https`; `loading="lazy"`, constrained `max-w-full h-auto` |
| GFM tables | `| a | b |` | wrapped `overflow-x-auto` |
| Strikethrough | `~~text~~` | `del` |
| Task lists | `- [x] done` | rendered as static text |

## Not supported / stripped

- Raw HTML: `script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `button`, `select`, `textarea`, `link`, `meta`, `base`, `title`, `svg`, `math`, `canvas`, `frame`, `applet`, `audio`, `video`, etc. — stripped via `rehype-sanitize` strip list
- Event handler attributes (`onclick`, `onerror`, `onload`, …) and `style` — stripped
- Protocols other than `http`/`https` for `href` and `https` only for `img[src]` — `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` are blocked; unsafe links render as plain text, unsafe images as placeholder
- Relative URLs, anchors, protocol-relative URLs — treated as unsafe (prevents base-tag and open-redirect tricks)
- Embeds (YouTube, etc.) — show as plain link instead of iframe

## Sanitizer

A maintained sanitizer is used instead of ad-hoc regex:

- **Client:** `rehype-sanitize` (backed by `hast-util-sanitize`) with a restrictive allowlist in `src/lib/preview/markdownPolicy.ts`
- **Server:** `server/src/services/previewSanitize.ts` mirrors the same allowlist and applies an early server-side strip before persistence; client still does full sanitization at render time

Both define `ALLOWED_TAGS`, `ALLOWED_PROTOCOLS`, `ALLOWED_IMAGE_PROTOCOLS`, `MAX_PREVIEW_LENGTH`/`MAX_PREVIEW_LINES`, and strip lists. Any change must be applied to both files.

## Attributes

- `a`: `href`, `title`, `rel`, `target` only — `rel` forced to `noopener noreferrer`, `target` forced to `_blank`
- `img`: `src`, `alt`, `title`, `loading`, `width`, `height` only — `loading="lazy" decoding="async"`
- No global `style` or `on*` attributes are ever allowed

## Layout breakage mitigations

- Preview text truncated to `MAX_PREVIEW_LENGTH=20_000` chars and `MAX_PREVIEW_LINES=500` lines before render
- Container uses `break-words` and `[&_a]:break-words` so long URLs/tokens wrap
- Code blocks use `overflow-x-auto`, tables use `block overflow-x-auto whitespace-nowrap`
- Images use `max-w-full h-auto rounded-lg border`

## Validation steps

1. `vitest run src/lib/preview/sanitize.test.ts` — unit tests for XSS vectors
2. `vitest run src/components/MarkdownContent.test.tsx` — component-level render tests (scripts stripped, javascript: blocked, iframes stripped, external links have safe attrs, https image policy, truncation)
3. Manual visual check: render `MarkdownContent` with payloads from `src/lib/preview/__fixtures__/xssSamples.ts` (if present) and confirm no script execution, no iframe, no clickable `javascript:` links
4. Server: `validateAndSanitizePreview` is called in listing validation before persisting `content`/`description`; unsafe content is stripped, not rejected, so creators see their preview safely degraded

## Adding support for a new construct

1. Update `ALLOWED_TAGS` and `ALLOWED_ATTRIBUTES` in both `src/lib/preview/markdownPolicy.ts` and `server/src/services/previewSanitize.ts`
2. Add rendering logic in `src/components/MarkdownContent.tsx` `components` map if needed
3. Add unit + component tests covering safe and unsafe variants
4. Update this doc
