import { afterEach, describe, expect, it } from "vitest";
import { selectReceiptSigningKey, verifyReceipt, canonicalizeReceipt } from "./receipts";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("receipt signing-key policy", () => {
  it("selects the configured active key from a bounded key set", () => {
    process.env.RECEIPT_SIGNING_ACTIVE_KEY_ID = "k2";
    process.env.RECEIPT_SIGNING_KEYS_JSON = JSON.stringify([
      {
        keyId: "k1",
        publicKey: "pub-1",
        privateKey: "priv-1",
      },
      {
        keyId: "k2",
        publicKey: "pub-2",
        privateKey: "priv-2",
        notBefore: "2026-01-01T00:00:00.000Z",
        issueBefore: "2026-12-31T00:00:00.000Z",
      },
    ]);

    expect(selectReceiptSigningKey(new Date("2026-08-25T00:00:00.000Z"))).toMatchObject({
      keyId: "k2",
      publicKey: "pub-2",
      privateKey: "priv-2",
    });
  });

  it("rejects receipt issuance after a key cutoff", () => {
    process.env.RECEIPT_SIGNING_ACTIVE_KEY_ID = "k1";
    process.env.RECEIPT_SIGNING_KEYS_JSON = JSON.stringify([
      {
        keyId: "k1",
        publicKey: "pub-1",
        privateKey: "priv-1",
        issueBefore: "2026-08-01T00:00:00.000Z",
      },
    ]);

    expect(() =>
      selectReceiptSigningKey(new Date("2026-08-25T00:00:00.000Z")),
    ).toThrow(/No active receipt signing key/);
  });

  it("rejects revoked keys even inside their nominal validity window", () => {
    process.env.RECEIPT_SIGNING_KEYS_JSON = JSON.stringify([
      {
        keyId: "k1",
        publicKey: "pub-1",
        privateKey: "priv-1",
        notAfter: "2027-01-01T00:00:00.000Z",
        revokedAt: "2026-08-20T00:00:00.000Z",
      },
    ]);

    expect(() =>
      selectReceiptSigningKey(new Date("2026-08-25T00:00:00.000Z")),
    ).toThrow(/No active receipt signing key/);
  });
});

describe("receipt verification", () => {
  it("rejects invalid receipt object", async () => {
    const result = await verifyReceipt({
      receipt: null as any,
      signature: "sig",
      signerPublicKey: "pub",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("valid object");
  });

  it("detects missing required fields", async () => {
    const incompleteReceipt = {
      version: 1,
      network: { passphrase: "Test" },
    };

    const result = await verifyReceipt({
      receipt: incompleteReceipt,
      signature: "sig",
      signerPublicKey: "pub",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Missing required fields"))).toBe(true);
  });

  it("detects tampered transaction hash", async () => {
    const receipt = {
      version: 1,
      network: { passphrase: "Test" },
      contract: { id: "contract-id" },
      prompt: { id: "42", revision: 0 },
      buyer: "GDXSEH3V6V7K4J3L5M6N",
      transaction: { hash: "invalid-hash-not-hex", ledger: 1 },
      event: { topic: "PromptPurchased", index: 0 },
    };

    const result = await verifyReceipt({
      receipt,
      signature: "sig",
      signerPublicKey: "pub",
    });

    expect(result.tamperedFields).toContain("transaction.hash");
  });

  it("detects tampered buyer wallet", async () => {
    const receipt = {
      version: 1,
      network: { passphrase: "Test" },
      contract: { id: "contract-id" },
      prompt: { id: "42", revision: 0 },
      buyer: "invalid-wallet-format",
      transaction: { hash: "a".repeat(64), ledger: 1 },
      event: { topic: "PromptPurchased", index: 0 },
    };

    const result = await verifyReceipt({
      receipt,
      signature: "sig",
      signerPublicKey: "pub",
    });

    expect(result.tamperedFields).toContain("buyer");
  });

  it("detects tampered prompt ID", async () => {
    const receipt = {
      version: 1,
      network: { passphrase: "Test" },
      contract: { id: "contract-id" },
      prompt: { id: "not-numeric", revision: 0 },
      buyer: "GDXSEH3V6V7K4J3L5M6N",
      transaction: { hash: "a".repeat(64), ledger: 1 },
      event: { topic: "PromptPurchased", index: 0 },
    };

    const result = await verifyReceipt({
      receipt,
      signature: "sig",
      signerPublicKey: "pub",
    });

    expect(result.tamperedFields).toContain("prompt.id");
  });

  it("warns on expired receipt", async () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const receipt = {
      version: 1,
      network: { passphrase: "Test" },
      contract: { id: "contract-id" },
      prompt: { id: "42", revision: 0 },
      buyer: "GDXSEH3V6V7K4J3L5M6N",
      transaction: { hash: "a".repeat(64), ledger: 1 },
      event: { topic: "PromptPurchased", index: 0 },
      issuedAt: pastDate,
      expiresAt: pastDate,
    };

    const result = await verifyReceipt({
      receipt,
      signature: "sig",
      signerPublicKey: "pub",
    });

    expect(result.warnings.some(w => w.includes("expired"))).toBe(true);
  });
});
