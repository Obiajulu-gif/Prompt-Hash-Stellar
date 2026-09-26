import { describe, expect, it } from "vitest";
import { decodePromptRecord } from "./contractMethods";

const CONTENT_HASH = "ab".repeat(32);

describe("decodePromptRecord integrity fields", () => {
  it("preserves the on-chain content commitment and encrypted payload for unlock verification", () => {
    const record = decodePromptRecord(
      {
        id: 17n,
        creator: "GCREATOR",
        price: 10_000n,
        title: "Integrity fixture",
        category: "Testing",
        preview_text: "Preview",
        image_url: "",
        sales_count: 0,
        active: true,
        revision: 3,
        content_hash: CONTENT_HASH,
        encrypted_payload: "ciphertext-v1",
        encryption_iv: "iv-v1",
        wrapped_key: "wrapped-key-v1",
      },
      17n,
    );

    expect(record).toMatchObject({
      contentHash: CONTENT_HASH,
      revision: 3,
      encryptedPrompt: "ciphertext-v1",
      encryptionIv: "iv-v1",
      wrappedKey: "wrapped-key-v1",
    });
  });
});
