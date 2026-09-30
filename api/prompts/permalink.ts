/**
 * Serverless Permalinks API Handler — Issue #936
 *
 * Resolves prompt permalinks, handles 301 redirects for renamed records,
 * and ensures archived/restricted/deleted records do not leak private data.
 */
import { withObservability } from "../../src/lib/observability/wrapper.js";
import connectDb from "../../server/src/db/connectDb.js";
import { resolvePermalink } from "../../server/src/services/permalinkService.js";

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    await connectDb();

    const { identifier, viewerWallet } = req.query ?? {};

    if (!identifier) {
      res.status(400).json({ error: "Record identifier or slug is required." });
      return;
    }

    const result = await resolvePermalink(String(identifier), {
      viewerWallet: viewerWallet ? String(viewerWallet) : undefined,
    });

    if (result.status === "redirect") {
      res.setHeader("Location", result.canonicalUrl);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.status(301).json(result);
      return;
    }

    if (result.status === "restricted" || result.status === "deleted") {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    } else {
      res.setHeader("Cache-Control", "public, max-age=60");
    }

    res.status(result.statusCode).json(result);
  } catch (error: any) {
    console.error("Resolve permalink error:", error);
    res.status(500).json({ error: error.message || "Failed to resolve permalink." });
  }
}

export default withObservability(handler, "prompts/permalink");
