import { afterEach, describe, expect, it } from "vitest";
import { selectReceiptSigningKey } from "./receipts";

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
