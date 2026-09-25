import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { MARKDOWN_SANITIZE_SCHEMA, ALLOWED_PROTOCOLS, ALLOWED_IMAGE_PROTOCOLS } from "@/lib/preview/markdownPolicy";
import { sanitizeImageSrc, sanitizeLinkHref, truncatePreview } from "@/lib/preview/sanitize";

/**
 * Marketplace preview markdown renderer — hardened.
 *
 * Security:
 * - Uses `rehype-sanitize` with a restrictive allowlist (see markdownPolicy.ts) — a
 *   maintained sanitizer, not ad-hoc regex.
 * - Blocks javascript:/data:/vbscript:, strips event handlers and style attrs,
 *   strips script/style/iframe/object/embed/form/input/button/svg/math etc.
 * - Keeps preview output consistent between server and client (both import the
 *   same policy shape; server mirrors in `server/src/services/previewSanitize.ts`).
 *
 * UX:
 * - External links use target="_blank" rel="noopener noreferrer" and show a
 *   small external indicator with an accessible label so users have clear
 *   expectations before navigation.
 * - Images are https-only, lazy-loaded, constrained to prevent layout breakage.
 * - Long content is truncated and CSS word-broken so a single huge token
 *   does not break marketplace layout.
 *
 * Supported markdown subset is documented in `src/lib/preview/markdownPolicy.ts`
 * and `docs/preview-markdown.md`.
 */
interface MarkdownContentProps {
  children: string;
  className?: string;
  /** Optional: disable truncation for full-article views */
  disableTruncate?: boolean;
}

// Merge our restrictive tagNames/attributes with defaultSchema's protocol lists.
// We explicitly build a sanitizer schema that mirrors MARKDOWN_SANITIZE_SCHEMA.
// rehype-sanitize expects `tagNames`, `attributes`, `protocols`, `strip`
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...MARKDOWN_SANITIZE_SCHEMA.tagNames],
  attributes: {
    ...defaultSchema.attributes,
    // override with our allowlist — disallow style, on*, etc.
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      // we enforce only our list; filter later
    ].filter((a: string) => ["href", "title", "rel", "target"].includes(a)),
    img: ["src", "alt", "title", "loading", "width", "height"],
    code: ["className"],
    pre: ["className"],
    span: ["className"],
    div: ["className"],
    th: ["align"],
    td: ["align"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...ALLOWED_PROTOCOLS],
    src: [...ALLOWED_IMAGE_PROTOCOLS],
  },
  strip: [...MARKDOWN_SANITIZE_SCHEMA.strip],
} as unknown as Parameters<typeof rehypeSanitize>[0];

function isExternalHref(href: string): boolean {
  try {
    const u = new URL(href);
    if (typeof window !== "undefined" && window.location?.origin) {
      return u.origin !== window.location.origin;
    }
    return true;
  } catch {
    return false;
  }
}

export function MarkdownContent({ children, className = "", disableTruncate = false }: MarkdownContentProps) {
  const safeChildren = disableTruncate ? children : truncatePreview(children);
  return (
    <div
      className={[
        "prose prose-invert prose-sm max-w-none break-words",
        "[&_a]:break-words [&_p]:break-words [&_li]:break-words",
        "prose-headings:text-slate-100 prose-headings:font-semibold",
        "prose-p:text-slate-300 prose-p:leading-relaxed",
        "prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline",
        "prose-strong:text-slate-100",
        "prose-code:text-emerald-300 prose-code:bg-slate-800/60 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-slate-800/60 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-lg prose-pre:overflow-x-auto",
        "prose-blockquote:border-l-emerald-500/50 prose-blockquote:text-slate-400",
        "prose-ul:text-slate-300 prose-ol:text-slate-300",
        "prose-hr:border-white/10",
        "prose-img:rounded-lg prose-img:max-w-full prose-img:h-auto prose-img:border prose-img:border-white/10",
        "prose-table:block prose-table:overflow-x-auto prose-table:whitespace-nowrap",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="markdown-content"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          a: ({ node, href, children: linkChildren, ...props }) => {
            const safeHref = sanitizeLinkHref(href);
            if (!safeHref) {
              // Unsafe link: render as plain text, not clickable
              return <span className="text-slate-400" title="Link removed for safety">{linkChildren}</span>;
            }
            const external = isExternalHref(safeHref);
            return (
              <a
                {...props}
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                title={external ? `${safeHref} (opens in new tab)` : safeHref}
                aria-label={external ? `${typeof linkChildren === "string" ? linkChildren : "External link"} (opens in new tab)` : undefined}
                className="inline-flex items-center gap-1"
              >
                {linkChildren}
                {external && (
                  <span aria-hidden="true" className="text-[0.7em] opacity-60">↗</span>
                )}
              </a>
            );
          },
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          img: ({ node, src, alt, ...props }) => {
            const safeSrc = sanitizeImageSrc(src);
            if (!safeSrc) {
              return <span className="text-xs italic text-slate-500">[image removed — only https images are allowed]</span>;
            }
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                {...props}
                src={safeSrc}
                alt={alt ?? ""}
                loading="lazy"
                decoding="async"
                className="max-w-full h-auto rounded-lg border border-white/10"
              />
            );
          },
          // Downgrade h4–h6 to h3 visual to keep layout stable
          h4: ({ node, ...props }) => <h3 {...props} className="text-base font-semibold text-slate-100" />,
          h5: ({ node, ...props }) => <h3 {...props} className="text-base font-semibold text-slate-100" />,
          h6: ({ node, ...props }) => <h3 {...props} className="text-sm font-semibold text-slate-100" />,
        }}
      >
        {safeChildren}
      </ReactMarkdown>
    </div>
  );
}
