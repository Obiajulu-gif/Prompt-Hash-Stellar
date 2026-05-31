export interface SavedPromptListing {
  purchaseId: string;
  promptId: string;
  savedAt: string;
  prompt: {
    id: string;
    image: string;
    title: string;
    content: string;
    price: number;
    category: string;
    listingStatus?: string;
    isActive?: boolean;
    owner?: {
      username?: string;
      walletAddress?: string;
    };
  };
}

type SavedPromptApiResponse = {
  purchaseId: string;
  savedAt: string;
  prompt: {
    _id?: string;
    id?: string;
    image?: string;
    title?: string;
    content?: string;
    price?: number;
    category?: string;
    listingStatus?: string;
    isActive?: boolean;
    owner?: {
      username?: string;
      walletAddress?: string;
    };
  } | null;
};

const toSavedPromptListing = (
  record: SavedPromptApiResponse,
): SavedPromptListing => {
  const prompt = record.prompt ?? {};
  const id = String(prompt._id ?? prompt.id ?? record.purchaseId);

  return {
    purchaseId: record.purchaseId,
    promptId: id,
    savedAt: record.savedAt,
    prompt: {
      id,
      image: prompt.image ?? "",
      title: prompt.title ?? "Untitled prompt",
      content: prompt.content ?? "",
      price: prompt.price ?? 0,
      category: prompt.category ?? "Other",
      listingStatus: prompt.listingStatus,
      isActive: prompt.isActive,
      owner: prompt.owner,
    },
  };
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "Request failed")
        : "Request failed");
    throw new Error(message);
  }

  return payload as T;
};

export async function fetchSavedPrompts(
  walletAddress: string,
): Promise<SavedPromptListing[]> {
  const response = await fetch(`/api/prompts/buyer/${walletAddress}/saved`);
  const payload = await parseJson<{ saved?: SavedPromptApiResponse[] }>(response);
  return (payload.saved ?? []).map(toSavedPromptListing);
}

export async function savePromptListing(
  walletAddress: string,
  promptId: string,
): Promise<void> {
  const response = await fetch("/api/prompts/buyer/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ walletAddress, promptId }),
  });

  await parseJson<{ saved?: boolean }>(response);
}

export async function unsavePromptListing(
  walletAddress: string,
  promptId: string,
): Promise<void> {
  const response = await fetch("/api/prompts/buyer/unsave", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ walletAddress, promptId }),
  });

  await parseJson<{ saved?: boolean }>(response);
}
