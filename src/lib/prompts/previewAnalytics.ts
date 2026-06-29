export async function recordPreview(promptId: string): Promise<void> {
  try {
    await fetch("/api/prompts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptId }),
    });
  } catch {
    // silently fail - analytics should never block UX
  }
}

export interface PreviewStat {
  _id: string;
  title: string;
  previewCount: number;
  salesCount: number;
  price: number;
  isActive: boolean;
}

export interface PreviewStatsResponse {
  totalPreviews: number;
  prompts: PreviewStat[];
}

export async function getPreviewStats(
  walletAddress: string,
): Promise<PreviewStatsResponse> {
  const res = await fetch(
    `/api/prompts/preview/stats?walletAddress=${encodeURIComponent(walletAddress)}`,
  );
  if (!res.ok) {
    throw new Error("Failed to fetch preview stats");
  }
  return res.json();
}
