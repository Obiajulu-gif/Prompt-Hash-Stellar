import { Buffer } from "buffer";
import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decryptPromptCiphertext,
  encryptPromptPlaintext,
  hashPromptPlaintext,
  normalizeContentHash,
  unwrapPromptKey,
  wrapPromptKey,
} from "./promptCrypto";
import {
  AES_KEY_HEX,
  AES_IV_HEX,
  CIPHERTEXT_BASE64,
  CONTENT_HASH,
  INVALID_BASE64,
  PLAINTEXT,
  SEAL_PRIVATE_KEY_BASE64,
  SEAL_PUBLIC_KEY_BASE64,
  SHORT_BASE64,
  TAMPERED_CIPHERTEXT_BASE64,
  WRAPPED_AES_KEY_BASE64,
} from "@/test/vectors/crypto";

function hexToBytes(hex: string) {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

describe("promptCrypto — shared test vectors", () => {
  it("decrypts the known ciphertext to the known plaintext", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const iv = hexToBytes(AES_IV_HEX);
    const plaintext = await decryptPromptCiphertext(
      CIPHERTEXT_BASE64,
      bytesToBase64(iv),
      key,
    );
    expect(plaintext).toBe(PLAINTEXT);
  });

  it("produces the expected ciphertext when encrypting with fixed key and IV", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const iv = hexToBytes(AES_IV_HEX);

    // encryptPromptPlaintext uses a random IV by default, so we bypass it
    // and call crypto.subtle.encrypt directly the same way the module does.
    const importedKey = await crypto.subtle.importKey(
      "raw",
      key,
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        importedKey,
        new TextEncoder().encode(PLAINTEXT),
      ),
    );
    expect(bytesToBase64(ciphertext)).toBe(CIPHERTEXT_BASE64);
  });

  it("hashes the known plaintext to the known content hash", async () => {
    const hash = await hashPromptPlaintext(PLAINTEXT);
    expect(hash).toBe(CONTENT_HASH);
  });

  it("hash is stable (deterministic)", async () => {
    const h1 = await hashPromptPlaintext(PLAINTEXT);
    const h2 = await hashPromptPlaintext(PLAINTEXT);
    expect(h1).toBe(h2);
  });

  it("rejects tampered ciphertext", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const iv = hexToBytes(AES_IV_HEX);

    await expect(
      decryptPromptCiphertext(TAMPERED_CIPHERTEXT_BASE64, bytesToBase64(iv), key),
    ).rejects.toThrow();
  });

  it("rejects decryption with the wrong key", async () => {
    const wrongKey = new Uint8Array(32).fill(0x42);
    const iv = hexToBytes(AES_IV_HEX);

    await expect(
      decryptPromptCiphertext(CIPHERTEXT_BASE64, bytesToBase64(iv), wrongKey),
    ).rejects.toThrow();
  });

  it("rejects decryption with the wrong IV", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const wrongIv = new Uint8Array(12).fill(0x42);

    await expect(
      decryptPromptCiphertext(CIPHERTEXT_BASE64, bytesToBase64(wrongIv), key),
    ).rejects.toThrow();
  });

  it("rejects invalid-base64 ciphertext", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const iv = hexToBytes(AES_IV_HEX);

    await expect(
      decryptPromptCiphertext(INVALID_BASE64, bytesToBase64(iv), key),
    ).rejects.toThrow();
  });

  it("rejects invalid-base64 IV", async () => {
    const key = hexToBytes(AES_KEY_HEX);

    await expect(
      decryptPromptCiphertext(CIPHERTEXT_BASE64, INVALID_BASE64, key),
    ).rejects.toThrow();
  });

  it("rejects too-short ciphertext (no room for AES-GCM tag)", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const iv = hexToBytes(AES_IV_HEX);

    await expect(
      decryptPromptCiphertext(SHORT_BASE64, bytesToBase64(iv), key),
    ).rejects.toThrow();
  });

  it("roundtrips AES-GCM with the fixed vector key and a random IV", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const encrypted = await encryptPromptPlaintext(PLAINTEXT, key);
    const decrypted = await decryptPromptCiphertext(
      encrypted.encryptedPrompt,
      encrypted.encryptionIv,
      key,
    );
    expect(decrypted).toBe(PLAINTEXT);
    expect(encrypted.contentHash).toBe(CONTENT_HASH);
  });
});

describe("promptCrypto — sealed-key wrapping with test vectors", () => {
  it("unwraps the pre-computed wrapped AES key", async () => {
    const unwrapped = await unwrapPromptKey(
      WRAPPED_AES_KEY_BASE64,
      SEAL_PUBLIC_KEY_BASE64,
      SEAL_PRIVATE_KEY_BASE64,
    );
    const key = hexToBytes(AES_KEY_HEX);
    expect(Array.from(unwrapped)).toEqual(Array.from(key));
  });

  it("roundtrips wrap and unwrap with the fixed keypair", async () => {
    await sodium.ready;
    const key = hexToBytes(AES_KEY_HEX);

    const wrapped = await wrapPromptKey(key, SEAL_PUBLIC_KEY_BASE64);
    const unwrapped = await unwrapPromptKey(
      wrapped,
      SEAL_PUBLIC_KEY_BASE64,
      SEAL_PRIVATE_KEY_BASE64,
    );
    expect(Array.from(unwrapped)).toEqual(Array.from(key));
  });

  it("rejects unwrap with the wrong private key", async () => {
    const wrongPrivate = bytesToBase64(new Uint8Array(32).fill(0x99));

    await expect(
      unwrapPromptKey(
        WRAPPED_AES_KEY_BASE64,
        SEAL_PUBLIC_KEY_BASE64,
        wrongPrivate,
      ),
    ).rejects.toThrow();
  });
});

describe("promptCrypto — content hash normalization", () => {
  it("normalizes uppercase hex to lowercase", () => {
    expect(normalizeContentHash(CONTENT_HASH.toUpperCase())).toBe(CONTENT_HASH);
  });

  it("converts base64-encoded hash to hex", () => {
    const hashBytes = hexToBytes(CONTENT_HASH);
    const asBase64 = bytesToBase64(hashBytes);
    expect(normalizeContentHash(asBase64)).toBe(CONTENT_HASH);
  });

  it("passes through a matching hex hash unchanged", () => {
    expect(normalizeContentHash(CONTENT_HASH)).toBe(CONTENT_HASH);
  });

  it("handles Uint8Array input", () => {
    const hashBytes = hexToBytes(CONTENT_HASH);
    expect(normalizeContentHash(hashBytes)).toBe(CONTENT_HASH);
  });

  it("returns trimmed lowercase for non-hex, non-base32 strings", () => {
    expect(normalizeContentHash("  MIXED-CASE-STRING  ")).toBe("mixed-case-string");
  });
});

describe("promptCrypto — random-key roundtrip (existing coverage)", () => {
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

  it("hashes plaintext to a stable lowercase hex digest", async () => {
    const hash = await hashPromptPlaintext("Prompt body for integrity checks.");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPromptPlaintext("Prompt body for integrity checks.")).toBe(hash);
  });
});

describe("promptCrypto — empty and edge-case inputs", () => {
  it("encrypts and decrypts an empty string", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const encrypted = await encryptPromptPlaintext("", key);
    const decrypted = await decryptPromptCiphertext(
      encrypted.encryptedPrompt,
      encrypted.encryptionIv,
      key,
    );
    expect(decrypted).toBe("");
  });

  it("encrypts and decrypts a single-character string", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const encrypted = await encryptPromptPlaintext("x", key);
    const decrypted = await decryptPromptCiphertext(
      encrypted.encryptedPrompt,
      encrypted.encryptionIv,
      key,
    );
    expect(decrypted).toBe("x");
  });

  it("encrypts and decrypts a very long string (10 KB)", async () => {
    const key = hexToBytes(AES_KEY_HEX);
    const longText = "A".repeat(10_000);
    const encrypted = await encryptPromptPlaintext(longText, key);
    const decrypted = await decryptPromptCiphertext(
      encrypted.encryptedPrompt,
      encrypted.encryptionIv,
      key,
    );
    expect(decrypted).toBe(longText);
  });
});