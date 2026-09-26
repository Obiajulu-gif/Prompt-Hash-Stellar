/**
 * Client for the buyer library API (#784): collections, archive state, and
 * entitlement health for the connected wallet's purchases. Every call needs
 * a wallet session token (see src/lib/auth/walletSession.ts).
 */
import { clearWalletSession } from "@/lib/auth/walletSession";
import type { EntitlementHealth } from "@/lib/prompts/entitlementHealth";

export interface LibraryEntry {
  promptId: string;
  title: string;
  category: string;
  image: string;
  purchasedAt: string;
  txHash: string;
  versionIndex: number;
  archived: boolean;
  archivedAt: string | null;
  collectionIds: string[];
  entitlement: {
    health: EntitlementHealth;
    purchaseStatus: string;
    disputeStatus: string | null;
  };
}

export interface LibraryCollection {
  id: string;
  name: string;
  description: string;
  promptIds: string[];
  promptCount: number;
  updatedAt: string;
}

export interface BuyerLibraryData {
  entries: LibraryEntry[];
  collections: LibraryCollection[];
  counts: { total: number; archived: number };
}

async function libraryRequest<T>(
  walletAddress: string,
  sessionToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/library/${encodeURIComponent(walletAddress)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
  });

  if (response.status === 401) {
    // Expired or revoked session: drop it so the next action re-verifies.
    clearWalletSession(walletAddress);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Library request failed (${response.status}).`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Loads the whole library, archived entries included; the UI filters it. */
export function fetchBuyerLibrary(walletAddress: string, sessionToken: string) {
  return libraryRequest<BuyerLibraryData>(walletAddress, sessionToken, "?archived=include");
}

export function setLibraryItemArchived(
  walletAddress: string,
  sessionToken: string,
  promptId: string,
  archived: boolean,
) {
  return libraryRequest<{ promptId: string; archived: boolean }>(
    walletAddress,
    sessionToken,
    `/items/${encodeURIComponent(promptId)}`,
    { method: "PUT", body: JSON.stringify({ archived }) },
  );
}

export function createLibraryCollection(
  walletAddress: string,
  sessionToken: string,
  input: { name: string; description?: string; promptIds?: string[] },
) {
  return libraryRequest<LibraryCollection>(walletAddress, sessionToken, "/collections", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateLibraryCollection(
  walletAddress: string,
  sessionToken: string,
  collectionId: string,
  patch: { name?: string; description?: string; addPromptIds?: string[]; removePromptIds?: string[] },
) {
  return libraryRequest<LibraryCollection>(
    walletAddress,
    sessionToken,
    `/collections/${encodeURIComponent(collectionId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export function deleteLibraryCollection(
  walletAddress: string,
  sessionToken: string,
  collectionId: string,
) {
  return libraryRequest<void>(
    walletAddress,
    sessionToken,
    `/collections/${encodeURIComponent(collectionId)}`,
    { method: "DELETE" },
  );
}

/** Independently verifiable purchase receipt (#436) for a library entry. */
export function receiptUrl(promptId: string, buyerWallet: string): string {
  const params = new URLSearchParams({ promptId, buyerWallet });
  return `/api/prompts/receipt?${params.toString()}`;
}
