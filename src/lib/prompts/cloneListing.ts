import type { PromptRecord } from "@/lib/stellar/promptHashClient";
import { stroopsToXlmString } from "@/lib/stellar/format";
import { getDraftStorageKey, type DraftMeta } from "@/hooks/useDraftAutoSave";

/**
 * Builds a new-listing draft from an existing prompt's PUBLIC metadata only.
 *
 * Deliberately excludes: the on-chain listing id, `contentHash`,
 * `salesCount`, and the encrypted payload (`encryptedPrompt`, `wrappedKey`,
 * `encryptionIv`) — the cloned listing gets its own identity and its own
 * encrypted content once the creator fills in and submits the form.
 */
export function buildCloneDraftFormData(prompt: PromptRecord): Record<string, unknown> {
  return {
    imageUrl: prompt.imageUrl ?? "",
    title: prompt.title ? `${prompt.title} (copy)` : "",
    category: prompt.category ?? "",
    previewText: prompt.previewText ?? "",
    description: prompt.description ?? "",
    tags: prompt.tags ?? [],
    priceXlm: stroopsToXlmString(prompt.priceStroops ?? 0n),
    licence: "standard",
    // fullPrompt intentionally omitted — encrypted content is never cloned.
  };
}

/**
 * Only the prompt's own creator may clone it into a new draft.
 */
export function canCloneListing(prompt: PromptRecord, walletAddress: string | undefined): boolean {
  if (!walletAddress) return false;
  return prompt.creator?.toLowerCase() === walletAddress.toLowerCase();
}

/**
 * Seeds the wallet's create-listing draft (the same localStorage slot
 * `useDraftAutoSave` reads on mount) with a clone of `prompt`'s public
 * metadata, so navigating to /sell opens the create form pre-filled and
 * ready for review before publication — nothing is published automatically.
 */
export function seedCloneDraft(prompt: PromptRecord, walletAddress: string): void {
  const meta: DraftMeta = {
    savedAt: new Date().toISOString(),
    formData: buildCloneDraftFormData(prompt),
  };
  window.localStorage.setItem(getDraftStorageKey(walletAddress), JSON.stringify(meta));
}

/** Whether the wallet already has an in-progress draft that cloning would overwrite. */
export function hasExistingDraft(walletAddress: string): boolean {
  return window.localStorage.getItem(getDraftStorageKey(walletAddress)) !== null;
}
