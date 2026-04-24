import type { PromptRecord } from "@/lib/stellar/promptHashClient";

export function makePrompt(
  overrides: Partial<PromptRecord> = {},
): PromptRecord {
  return {
    id: 1n,
    creator: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
    imageUrl: "https://example.com/prompt.png",
    title: "Board-ready launch plan",
    category: "Marketing",
    previewText: "Public preview text for the listing.",
    encryptedPrompt: "ciphertext",
    encryptionIv: "iv",
    wrappedKey: "wrapped-key",
    contentHash: "a".repeat(64),
    priceStroops: 2_5000000n,
    active: true,
    salesCount: 4,
    ...overrides,
  };
}
