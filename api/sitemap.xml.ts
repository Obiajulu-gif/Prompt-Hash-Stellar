import type { VercelRequest, VercelResponse } from "@vercel/node";
// Using the mocked client to get all available prompts
import { PromptHashClient } from "../src/lib/stellar/promptHashClient";
import { browserStellarConfig } from "../src/lib/stellar/browserConfig";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const prompts = await PromptHashClient.getAllPrompts(browserStellarConfig);

    // Get the base URL (Vercel provides this in VERCEL_URL, or fallback to localhost for dev)
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = process.env.VERCEL_URL || req.headers.host || "localhost:5173";
    const baseUrl = `${protocol}://${host}`;

    // Create the sitemap entries
    const urls = prompts
      .filter((prompt) => prompt.active)
      .map((prompt) => {
        return `
  <url>
    <loc>${baseUrl}/prompts/${prompt.id}</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
      })
      .join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/browse</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>${urls}
</urlset>`;

    res.setHeader("Content-Type", "text/xml");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.status(200).send(sitemap);
  } catch (error) {
    console.error("Failed to generate sitemap:", error);
    res.status(500).end();
  }
}
