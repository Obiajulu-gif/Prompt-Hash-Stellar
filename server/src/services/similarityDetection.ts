/**
 * Anti-Plagiarism / Similarity Detection Service (Issue #133)
 *
 * Detects when a newly indexed prompt is too similar to existing ones.
 * Uses TF-IDF cosine similarity for general content and Levenshtein ratio
 * for very short texts (< 50 chars).
 *
 * Thresholds:
 *   score >= 0.90  → "highly_similar" (flag for moderation)
 *   score >= 0.70  → "suspicious"
 *   score <  0.70  → "clean"
 */

import Prompt from "../models/Prompt";

// ---------------------------------------------------------------------------
// Text preprocessing
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildTermFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by document length
  for (const [term, count] of tf) {
    tf.set(term, count / tokens.length);
  }
  return tf;
}

// ---------------------------------------------------------------------------
// Cosine similarity on TF vectors
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, tfA] of a) {
    normA += tfA * tfA;
    const tfB = b.get(term) ?? 0;
    dot += tfA * tfB;
  }
  for (const [, tfB] of b) {
    normB += tfB * tfB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Levenshtein distance (for short texts)
// ---------------------------------------------------------------------------

export function levenshteinRatio(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  const distance = dp[m][n];
  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

export function computeSimilarityScore(textA: string, textB: string): number {
  const norm = (s: string) => s.toLowerCase().trim();
  const a = norm(textA);
  const b = norm(textB);

  if (a.length < 50 || b.length < 50) {
    return levenshteinRatio(a, b);
  }

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const tfA = buildTermFrequency(tokensA);
  const tfB = buildTermFrequency(tokensB);
  return cosineSimilarity(tfA, tfB);
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const SIMILARITY_THRESHOLDS = {
  HIGHLY_SIMILAR: 0.9,
  SUSPICIOUS: 0.7,
} as const;

export type SimilarityFlag = "clean" | "suspicious" | "highly_similar";

export function classifyScore(score: number): SimilarityFlag {
  if (score >= SIMILARITY_THRESHOLDS.HIGHLY_SIMILAR) return "highly_similar";
  if (score >= SIMILARITY_THRESHOLDS.SUSPICIOUS) return "suspicious";
  return "clean";
}

// ---------------------------------------------------------------------------
// Main scan function: called after a new prompt is indexed
// ---------------------------------------------------------------------------

export interface SimilarityResult {
  flag: SimilarityFlag;
  score: number;
  similarTo: string | null;
}

/**
 * Scan a newly indexed prompt against all existing active prompts.
 * Updates the Prompt document with the result and returns the result.
 *
 * @param onChainId  The on-chain ID of the newly created prompt.
 * @param content    The prompt text to compare (title + body combined).
 */
export async function scanForSimilarity(
  onChainId: string,
  content: string,
): Promise<SimilarityResult> {
  const existing = await Prompt.find(
    { onChainId: { $ne: onChainId } },
    { onChainId: 1, content: 1, title: 1 },
  ).lean();

  let maxScore = 0;
  let mostSimilarId: string | null = null;

  for (const prompt of existing) {
    const candidateText = `${prompt.title ?? ""} ${prompt.content ?? ""}`;
    const score = computeSimilarityScore(content, candidateText);
    if (score > maxScore) {
      maxScore = score;
      mostSimilarId = prompt.onChainId ?? null;
    }
  }

  const flag = classifyScore(maxScore);

  await Prompt.findOneAndUpdate(
    { onChainId },
    {
      $set: {
        similarityFlag: flag,
        similarityScore: maxScore,
        similarTo: flag !== "clean" ? mostSimilarId : null,
        similarityCheckedAt: new Date(),
      },
    },
  );

  if (flag !== "clean") {
    console.warn(
      `[similarity] Prompt ${onChainId} flagged as "${flag}" ` +
        `(score=${maxScore.toFixed(3)}, similar to ${mostSimilarId})`,
    );
  }

  return { flag, score: maxScore, similarTo: flag !== "clean" ? mostSimilarId : null };
}
