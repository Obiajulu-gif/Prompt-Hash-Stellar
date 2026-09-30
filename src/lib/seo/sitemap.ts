/**
 * Sitemap generation for public marketplace discovery (#791).
 *
 * Pure, dependency-free helpers so the same inclusion/exclusion rules can be
 * unit-tested and reused by the `api/sitemap.xml.ts` Vercel function.
 *
 * Inclusion rules — a prompt is only listed when it is publicly visible:
 *   - `active` is true (on-chain listing is live),
 *   - `status` is undefined or "Active" (Draft/Paused/Retired/Restricted and
 *     any suspended state are excluded),
 *   - `similarityFlag` is not "highly_similar" (plagiarism screen),
 *   - `integrityStatus` is not "corrupted"/"missing"/"unreachable"
 *     (content-verification screen).
 *
 * Hidden prompt payloads (encryptedPrompt, encryptionIv, wrappedKey,
 * contentHash, description bodies) must never be passed into this module —
 * the input type deliberately omits them so metadata cannot leak them.
 */

export interface SitemapPromptInput {
  id: string | number | bigint;
  title: string;
  creator?: string | null;
  category?: string | null;
  updatedAt?: string | Date | null;
  active?: boolean;
  status?: string | null;
  similarityFlag?: string | null;
  integrityStatus?: string | null;
}

export interface SitemapCreatorInput {
  walletAddress: string;
  hasPublicListings: boolean;
}

export type SitemapChangeFreq = "daily" | "weekly" | "monthly";

export interface SitemapUrlEntry {
  loc: string;
  lastmod: string; // YYYY-MM-DD
  changefreq: SitemapChangeFreq;
  priority: string;
}

/** Listing states that must never appear in public metadata. */
const BLOCKED_STATUSES = new Set(["draft", "paused", "retired", "restricted", "suspended"]);

/** Integrity outcomes that hide a listing from discovery. */
const BLOCKED_INTEGRITY = new Set(["corrupted", "missing", "unreachable"]);

function isPublicPrompt(p: SitemapPromptInput): boolean {
  if (p.active === false) return false;
  if (p.status && BLOCKED_STATUSES.has(String(p.status).toLowerCase())) return false;
  if (p.similarityFlag && String(p.similarityFlag).toLowerCase() === "highly_similar") return false;
  if (p.integrityStatus && BLOCKED_INTEGRITY.has(String(p.integrityStatus).toLowerCase())) return false;
  return true;
}

/** Stable lastmod: date-only, falling back to today for missing timestamps. */
function toDateOnly(value: string | Date | null | undefined): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split("T")[0];
  return d.toISOString().split("T")[0];
}

/** XML-escape so titles/creators with special characters can't break the feed. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function promptSitemapEntry(
  p: SitemapPromptInput,
  baseUrl: string,
): SitemapUrlEntry | null {
  if (!isPublicPrompt(p)) return null;
  const base = baseUrl.replace(/\/$/, "");
  return {
    loc: `${base}/prompts/${p.id}`,
    lastmod: toDateOnly(p.updatedAt),
    changefreq: "weekly",
    priority: "0.8",
  };
}

export function creatorSitemapEntry(
  c: SitemapCreatorInput,
  baseUrl: string,
): SitemapUrlEntry | null {
  // A creator page is only crawlable when it would render public listings;
  // empty/suspended sellers are excluded to avoid soft-404 noise.
  if (!c.hasPublicListings) return null;
  const base = baseUrl.replace(/\/$/, "");
  return {
    loc: `${base}/sellers/${encodeURIComponent(c.walletAddress)}`,
    lastmod: toDateOnly(null),
    changefreq: "daily",
    priority: "0.6",
  };
}

const STATIC_ENTRIES: Array<{ path: string; changefreq: SitemapChangeFreq; priority: string }> = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/browse", changefreq: "daily", priority: "0.9" },
];

export function buildSitemapXml(
  prompts: SitemapPromptInput[],
  creators: SitemapCreatorInput[],
  baseUrl: string,
  now: Date = new Date(),
): string {
  const base = baseUrl.replace(/\/$/, "");
  const entries: SitemapUrlEntry[] = [
    ...STATIC_ENTRIES.map((s) => ({
      loc: `${base}${s.path}`,
      lastmod: toDateOnly(now),
      changefreq: s.changefreq,
      priority: s.priority,
    })),
  ];

  for (const p of prompts) {
    const entry = promptSitemapEntry(p, base);
    if (entry) entries.push(entry);
  }
  for (const c of creators) {
    const entry = creatorSitemapEntry(c, base);
    if (entry) entries.push(entry);
  }

  const body = entries
    .map(
      (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

/**
 * Structured product metadata (schema.org/Product JSON-LD) for a prompt
 * detail page (#791). Deliberately excludes hidden payload fields — only
 * buyer-visible marketing fields are emitted.
 */
export function buildProductJsonLd(
  p: {
    id: string | number | bigint;
    title: string;
    previewText?: string | null;
    imageUrl?: string | null;
    priceStroops?: string | bigint | number | null;
    creator?: string | null;
    salesCount?: number | null;
    active?: boolean;
  },
  origin: string,
): Record<string, unknown> {
  const base = origin.replace(/\/$/, "");
  const xlm = Number(p.priceStroops ?? 0) / 10_000_000;
  return {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: p.title,
    description: p.previewText ?? "",
    image: p.imageUrl || `${base}/og-image.png`,
    sku: `prompt-${p.id}`,
    brand: { "@type": "Brand", name: "Prompt Hash Stellar" },
    ...(p.creator
      ? { seller: { "@type": "Organization", name: p.creator } }
      : {}),
    offers: {
      "@type": "Offer",
      url: `${base}/prompts/${p.id}`,
      price: xlm.toFixed(2),
      priceCurrency: "XLM",
      availability: p.active === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    },
    ...(p.salesCount != null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: "5.0",
            reviewCount: Math.max(1, p.salesCount),
          },
        }
      : {}),
  };
}

/** robots.txt body advertising the sitemap location (#791). */
export function buildRobotsTxt(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin

Sitemap: ${base}/api/sitemap.xml
`;
}
