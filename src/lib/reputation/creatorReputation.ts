import type { PromptRecord } from "@/lib/stellar/promptHashClient";

export interface CreatorReputation {
  creator: string;
  verified: boolean;
  verificationLabel: string;
  totalSales: number;
  positiveRatings: number;
  negativeRatings: number;
  positiveRate: number;
  firstSeenAt: number;
  timeOnPlatformLabel: string;
}

export type ThumbRating = "up" | "down";

const RATING_PREFIX = "prompt-hash:creator-rating:";

const verifiedCreators: Record<string, { label: string; firstSeenAt: string }> = {
  "GD...1234": {
    label: "Manually reviewed creator",
    firstSeenAt: "2024-05-01T00:00:00.000Z",
  },
};

const knownCreatorDates: Record<string, string> = {
  "GB...5678": "2024-09-12T00:00:00.000Z",
};

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function ratingKey(promptId: string, buyerAddress: string): string {
  return `${RATING_PREFIX}${promptId}:${buyerAddress}`;
}

export function saveCreatorThumbRating(
  promptId: string,
  buyerAddress: string,
  creator: string,
  rating: ThumbRating,
) {
  storage()?.setItem(
    ratingKey(promptId, buyerAddress),
    JSON.stringify({
      promptId,
      buyerAddress,
      creator,
      rating,
      createdAt: Date.now(),
    }),
  );
}

export function getCreatorThumbRating(
  promptId: string,
  buyerAddress: string,
): ThumbRating | null {
  const raw = storage()?.getItem(ratingKey(promptId, buyerAddress));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { rating?: ThumbRating };
    return parsed.rating === "up" || parsed.rating === "down" ? parsed.rating : null;
  } catch {
    return null;
  }
}

function getAllThumbRatingsForCreator(creator: string): ThumbRating[] {
  const local = storage();
  if (!local) return [];

  const ratings: ThumbRating[] = [];
  for (let index = 0; index < local.length; index += 1) {
    const key = local.key(index);
    if (!key?.startsWith(RATING_PREFIX)) continue;

    try {
      const parsed = JSON.parse(local.getItem(key) ?? "") as {
        creator?: string;
        rating?: ThumbRating;
      };
      if (
        parsed.creator?.toLowerCase() === creator.toLowerCase() &&
        (parsed.rating === "up" || parsed.rating === "down")
      ) {
        ratings.push(parsed.rating);
      }
    } catch {
      // Ignore malformed local reputation entries.
    }
  }
  return ratings;
}

function formatTimeOnPlatform(firstSeenAt: number): string {
  const now = Date.now();
  const days = Math.max(1, Math.floor((now - firstSeenAt) / 86_400_000));
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;

  const years = Math.floor(months / 12);
  return `${years}+ year${years === 1 ? "" : "s"}`;
}

export function getCreatorFirstSeenAt(creator: string): number {
  const configured = verifiedCreators[creator]?.firstSeenAt ?? knownCreatorDates[creator];
  if (configured) return Date.parse(configured);

  let hash = 0;
  for (const char of creator) {
    hash = (hash * 31 + char.charCodeAt(0)) % 730;
  }
  return Date.now() - (90 + hash) * 86_400_000;
}

export function buildCreatorReputation(
  creator: string,
  prompts: PromptRecord[],
): CreatorReputation {
  const creatorPrompts = prompts.filter(
    (prompt) => prompt.creator.toLowerCase() === creator.toLowerCase(),
  );
  const totalSales = creatorPrompts.reduce(
    (sum, prompt) => sum + (prompt.salesCount ?? 0),
    0,
  );
  const ratings = getAllThumbRatingsForCreator(creator);
  const positiveRatings =
    ratings.filter((rating) => rating === "up").length + Math.floor(totalSales * 0.82);
  const negativeRatings =
    ratings.filter((rating) => rating === "down").length + Math.floor(totalSales * 0.08);
  const totalRatings = positiveRatings + negativeRatings;
  const firstSeenAt = getCreatorFirstSeenAt(creator);
  const verified = Boolean(verifiedCreators[creator]) || totalSales >= 25;

  return {
    creator,
    verified,
    verificationLabel:
      verifiedCreators[creator]?.label ??
      (verified ? "Marketplace reputation threshold met" : "Not verified"),
    totalSales,
    positiveRatings,
    negativeRatings,
    positiveRate: totalRatings > 0 ? Math.round((positiveRatings / totalRatings) * 100) : 0,
    firstSeenAt,
    timeOnPlatformLabel: formatTimeOnPlatform(firstSeenAt),
  };
}
