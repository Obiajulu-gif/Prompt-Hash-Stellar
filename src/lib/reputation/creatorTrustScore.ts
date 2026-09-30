export interface CreatorTrustScoreInputs {
  qualityScore?: number;
  refundRate?: number;
  moderationFlags?: number;
  moderationActions?: number;
  salesCount?: number;
  totalListings?: number;
  isNewCreator?: boolean;
}

export type CreatorTrustBand = "new" | "watch" | "stable" | "trusted";

export interface CreatorTrustScoreSnapshot {
  score: number;
  band: CreatorTrustBand;
  qualityContribution: number;
  refundPenalty: number;
  moderationPenalty: number;
  recoveryBonus: number;
  explanation: string[];
  generatedAt: string;
  inputs: CreatorTrustScoreInputs;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function normalizeCreatorTrustScore(value: number): number {
  const numericValue = Number.isFinite(value) ? value : 0;
  return clamp(numericValue, 0, 5) * 20;
}

function deriveBand(score: number): CreatorTrustBand {
  if (score < 40) return "watch";
  if (score < 65) return "new";
  if (score < 80) return "stable";
  return "trusted";
}

export function calculateCreatorTrustScore(
  inputs: CreatorTrustScoreInputs = {},
): CreatorTrustScoreSnapshot {
  const qualityScore = clamp(inputs.qualityScore ?? 3.0, 0, 5);
  const refundRate = clamp(inputs.refundRate ?? 0, 0, 1);
  const moderationFlags = Math.max(0, inputs.moderationFlags ?? 0);
  const moderationActions = Math.max(0, inputs.moderationActions ?? 0);
  const salesCount = Math.max(0, inputs.salesCount ?? 0);
  const totalListings = Math.max(1, inputs.totalListings ?? 1);
  const isNewCreator = inputs.isNewCreator ?? salesCount < 3 && totalListings <= 3;

  const baseScore = isNewCreator ? 68 : 52;
  const qualityContribution = (qualityScore / 5) * 35;
  const salesBonus = Math.min(12, salesCount * 0.35);
  const refundPenalty = refundRate * 45;
  const moderationPenalty = moderationFlags * 12 + moderationActions * 8;
  const recoveryBonus =
    qualityScore >= 4.2 && refundRate <= 0.1 && moderationFlags === 0 && salesCount > 0
      ? 10
      : 0;

  let score = baseScore + qualityContribution + salesBonus - refundPenalty - moderationPenalty + recoveryBonus;
  if (salesCount === 0 && !isNewCreator) {
    score -= 8;
  }

  score = clamp(Math.round(score), 0, 100);

  const explanation = [
    qualityScore > 0
      ? `Quality signal ${qualityScore.toFixed(1)}/5 remains within the marketplace target.`
      : "No quality history has been established yet; this creator is still in the onboarding window.",
    refundRate > 0.12
      ? `Refund pressure is elevated at ${(refundRate * 100).toFixed(0)}%, reducing trust confidence.`
      : `Refund rate is within the normal operating range at ${(refundRate * 100).toFixed(0)}%.`,
    moderationFlags > 0 || moderationActions > 0
      ? `Moderation history includes ${moderationFlags + moderationActions} resolved issues, which is suppressing score momentum.`
      : "Moderation history is clean; no unresolved intervention is currently reducing trust.",
    salesCount > 0
      ? `Buyer activity is steady with ${salesCount} recorded sale${salesCount === 1 ? "" : "s"} and an active catalog.`
      : "The creator has not yet built a purchase history, so trust is based on baseline quality signals only.",
  ];

  return {
    score,
    band: deriveBand(score),
    qualityContribution: clamp(Math.round(qualityContribution), 0, 35),
    refundPenalty: clamp(Math.round(refundPenalty), 0, 45),
    moderationPenalty: clamp(Math.round(moderationPenalty), 0, 60),
    recoveryBonus: clamp(Math.round(recoveryBonus), 0, 10),
    explanation,
    generatedAt: new Date().toISOString(),
    inputs: {
      ...inputs,
      qualityScore,
      refundRate,
      moderationFlags,
      moderationActions,
      salesCount,
      totalListings,
      isNewCreator,
    },
  };
}

export function describeCreatorTrustScore(score: number): string {
  if (score >= 80) return "Trusted creator";
  if (score >= 65) return "Stable creator";
  if (score >= 40) return "New creator";
  return "Watchlist creator";
}

export function getCreatorTrustExplanation(snapshot: CreatorTrustScoreSnapshot): string[] {
  return snapshot.explanation;
}
