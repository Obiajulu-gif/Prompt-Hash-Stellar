import Prompt from "../models/Prompt.js";
import { checkSimilarityForContent } from "./similarityDetection.js";
import crypto from "crypto";

export type DuplicateSeverity = "exact" | "ambiguous" | "none";

export interface DuplicateDetectionResult {
  severity: DuplicateSeverity;
  similarTo: string | null;
  score: number;
}

export function generateCanonicalKey(title: string, content: string): string {
  const normTitle = (title || "").trim().toLowerCase();
  const normContent = (content || "").trim().toLowerCase();
  return crypto.createHash("sha256").update(`${normTitle}|${normContent}`).digest("hex");
}

export async function checkDuplicates(
  title: string,
  content: string,
  category?: string,
  excludeOnChainId?: string
): Promise<DuplicateDetectionResult> {
  const normTitle = (title || "").trim();
  const normContent = (content || "").trim();

  // 1. Exact match (deterministic)
  const query: any = {
    title: { $regex: new RegExp(`^${escapeRegExp(normTitle)}$`, 'i') },
    content: { $regex: new RegExp(`^${escapeRegExp(normContent)}$`, 'i') }
  };
  if (excludeOnChainId) {
    query.onChainId = { $ne: excludeOnChainId };
  }

  const exactMatches = await Prompt.find(query, { onChainId: 1 }).lean().limit(1);
  if (exactMatches.length > 0) {
    return {
      severity: "exact",
      similarTo: exactMatches[0].onChainId,
      score: 1.0,
    };
  }

  // 2. Fuzzy match boundaries
  const simResult = await checkSimilarityForContent(content, category, excludeOnChainId);
  if (simResult.flag === "highly_similar" || simResult.flag === "suspicious") {
    return {
      severity: "ambiguous",
      similarTo: simResult.similarTo,
      score: simResult.score,
    };
  }

  return {
    severity: "none",
    similarTo: null,
    score: simResult.score,
  };
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
