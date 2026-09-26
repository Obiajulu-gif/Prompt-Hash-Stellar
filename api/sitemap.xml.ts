import type { VercelRequest, VercelResponse } from "@vercel/node";
import connectDb from "../server/src/db/connectDb";
import Prompt from "../server/src/models/Prompt";
import { buildSitemapXml, type SitemapPromptInput } from "../src/lib/seo/sitemap";

/**
 * Crawlable sitemap for public marketplace discovery (#791).
 *
 * Lists the marketplace home, /browse, every public prompt detail page and
 * every creator (seller) page that currently has at least one public listing.
 *
 * Exclusion rules (enforced twice: in the Mongo query below and again in
 * `buildSitemapXml` as a defensive pure-logic screen):
 *   - inactive listings, Draft/Paused/Retired/Restricted (suspended) statuses,
 *   - `similarityFlag: highly_similar` (plagiarism screen),
 *   - `integrityStatus` corrupted/missing/unreachable (content verification),
 *   - moderated prompts (`moderationStatus` pending/rejected — #758).
 *
 * Only buyer-visible fields are selected; hidden prompt payloads
 * (encryptedPrompt, encryptionIv, wrappedKey, contentHash) are never loaded.
 *
 * Generation process: the sitemap is computed per-request and cached at the
 * CDN (`Cache-Control: public, max-age=3600, s-maxage=86400`), so it reflects
 * public listing changes within the cache window without hammering the DB.
 * See docs/seo-discovery.md for the full process documentation.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await connectDb();

    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = process.env.VERCEL_URL || req.headers.host || "localhost:5173";
    const baseUrl = `${protocol}://${host}`;

    // Same visibility contract as the public marketplace listing query in
    // api/prompts/index.ts (buildMarketplaceQuery) so the sitemap can never
    // advertise a page the marketplace itself would hide.
    const rows = (await Prompt.find({
      listingStatus: "published",
      isActive: true,
      $or: [{ moderationStatus: null }, { moderationStatus: "none" }, { moderationStatus: { $exists: false } }],
      similarityFlag: { $ne: "highly_similar" },
      integrityStatus: { $nin: ["corrupted", "missing", "unreachable"] },
    })
      .select("onChainId _id title updatedAt owner category")
      .populate("owner", "walletAddress")
      .sort({ updatedAt: -1 })
      .limit(5000)
      .lean()) as Array<{
      _id: unknown;
      onChainId?: number | string | null;
      title: string;
      updatedAt?: Date;
      owner?: { walletAddress?: string } | null;
    }>;

    const prompts: SitemapPromptInput[] = rows.map((r) => ({
      id: r.onChainId ?? String(r._id),
      title: r.title,
      creator: r.owner?.walletAddress ?? null,
      updatedAt: r.updatedAt ?? null,
      // Already filtered in the query; kept explicit so the pure-logic
      // screen in buildSitemapXml stays the single source of truth.
      active: true,
      status: "Active",
    }));

    // Creator pages: one entry per wallet with at least one public listing.
    const byCreator = new Map<string, number>();
    for (const r of rows) {
      const wallet = r.owner?.walletAddress;
      if (!wallet) continue;
      byCreator.set(wallet, (byCreator.get(wallet) ?? 0) + 1);
    }
    const creators = [...byCreator.keys()].map((walletAddress) => ({
      walletAddress,
      hasPublicListings: (byCreator.get(walletAddress) ?? 0) > 0,
    }));

    const sitemap = buildSitemapXml(prompts, creators, baseUrl);

    res.setHeader("Content-Type", "text/xml");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.status(200).send(sitemap);
  } catch (error) {
    console.error("Failed to generate sitemap:", error);
    res.status(500).end();
  }
}
