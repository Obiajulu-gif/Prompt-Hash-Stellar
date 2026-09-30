/**
 * Client-side permalink resolution & redirect handling — Issue #936
 */
import {
  generateSlug,
  buildCanonicalPermalink,
  type PermalinkResolution,
} from "@prompthash/schema";

export { generateSlug, buildCanonicalPermalink };
export type { PermalinkResolution };

/**
 * Resolves a prompt permalink, slug, or old link from the marketplace API.
 * Handles 301 redirects for renamed prompts and safe status checks for
 * archived and restricted listings.
 */
export async function fetchPermalinkResolution(
  identifier: string,
  viewerWallet?: string
): Promise<PermalinkResolution | null> {
  if (!identifier) return null;

  try {
    const params = new URLSearchParams({ identifier });
    if (viewerWallet) {
      params.append("viewerWallet", viewerWallet);
    }

    const res = await fetch(`/api/prompts/permalink?${params.toString()}`);
    if (!res.ok && res.status !== 301 && res.status !== 403 && res.status !== 410) {
      return null;
    }

    const data = (await res.json()) as PermalinkResolution;
    return data;
  } catch (err) {
    console.error("Failed to resolve permalink:", err);
    return null;
  }
}
