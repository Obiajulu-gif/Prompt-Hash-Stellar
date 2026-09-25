# Marketplace SEO & discovery (#791)

This document describes how public marketplace content becomes discoverable:
the sitemap, robots rules, and the structured metadata embedded in pages.

## Sitemap (`/api/sitemap.xml`)

Generated on request by the Vercel function `api/sitemap.xml.ts` and cached at
the CDN (`Cache-Control: public, max-age=3600, s-maxage=86400`), so public
listing changes are reflected within the cache window.

### What is listed

- `/` and `/browse` (static, high priority)
- `/prompts/<id>` for every **publicly visible** prompt
- `/sellers/<walletAddress>` for every creator with at least one public listing

### Inclusion / exclusion rules

A prompt appears only when **all** of the following hold. The rules are
enforced in the Mongo query *and* re-checked by the pure helper
`buildSitemapXml` in `src/lib/seo/sitemap.ts` (defense in depth):

| Field | Requirement |
|---|---|
| `active` | must be true (on-chain listing live) |
| `status` | must not be Draft / Paused / Retired / Restricted / Suspended |
| `similarityFlag` | must not be `highly_similar` (plagiarism screen) |
| `integrityStatus` | must not be `corrupted` / `missing` / `unreachable` |
| `moderationStatus` | must be `none` (safety-scanner queue/rejected are hidden, #758) |

The visibility contract deliberately matches the public marketplace query in
`api/prompts/index.ts` (`buildMarketplaceQuery`): the sitemap can never
advertise a page the marketplace itself would hide.

### Privacy

Only buyer-visible fields are selected from the database
(`onChainId`, `title`, `updatedAt`, `owner.walletAddress`, `category`).
Hidden payload fields — `encryptedPrompt`, `encryptionIv`, `wrappedKey`,
`contentHash`, full descriptions — are never loaded and can therefore never
leak into the feed. The `SitemapPromptInput` type in
`src/lib/seo/sitemap.ts` omits them on purpose.

### Canonical URLs & categories

- Prompt URLs are canonical `/prompts/<onChainId>` (falling back to the Mongo
  `_id` only for legacy rows without an on-chain id).
- Category browsing is served by `/browse` (filters are query parameters, not
  separate URLs), so there are no duplicate category URLs to canonicalize or
  redirect.

## robots.txt

`public/robots.txt` allows crawling of marketplace pages, disallows `/api/`
and `/admin`, and advertises the sitemap at `/api/sitemap.xml`.

## Structured metadata on prompt pages

`src/pages/prompts/PromptDetailPage.tsx` embeds schema.org **Product**
JSON-LD (built by `buildProductJsonLd` in `src/lib/seo/sitemap.ts`) with:

- `name`, `description` (preview text only — never the hidden payload),
- `image` (cover art or the site fallback),
- `seller` (creator wallet),
- `offers` with `price` (XLM), `priceCurrency`, `url` and `availability`
  (`InStock` / `OutOfStock` derived from the listing state),
- `aggregateRating` derived from sales count.

Open Graph / Twitter card tags are driven by the existing `usePageMeta` hook.

## Tests

- `src/test/seo/sitemap.test.ts` covers inclusion/exclusion rules (inactive,
  suspended, plagiarized, corrupted listings excluded), XML escaping,
  creator-entry rules, robots body, and JSON-LD shape.
