import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";
import {
  bytesToBase64,
  decryptPromptCiphertext,
  encryptPromptPlaintext,
  unwrapPromptKey,
  wrapPromptKey,
} from "./promptCrypto";

describe("promptCrypto", () => {
  it("roundtrips AES-GCM encryption and decryption", async () => {
    const plaintext = "Secure prompt body with private instructions.";
    const encrypted = await encryptPromptPlaintext(plaintext);
    const decrypted = await decryptPromptCiphertext(
      encrypted.encryptedPrompt,
      encrypted.encryptionIv,
      encrypted.keyBytes,
    );

    expect(decrypted).toBe(plaintext);
  });

  it("roundtrips sealed key wrapping and unwrapping", async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    const encrypted = await encryptPromptPlaintext("Another protected prompt.");

    const wrappedKey = await wrapPromptKey(
      encrypted.keyBytes,
      bytesToBase64(keyPair.publicKey),
    );
    const unwrappedKey = await unwrapPromptKey(
      wrappedKey,
      bytesToBase64(keyPair.publicKey),
      bytesToBase64(keyPair.privateKey),
    );

    expect(Array.from(unwrappedKey)).toEqual(Array.from(encrypted.keyBytes));
  });
});
