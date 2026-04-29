import { describe, expect, it } from "vitest";
import { loadUnlockKeyStore } from "./unlockKeyStore";

describe("unlock key store", () => {
  it("loads a single current key from direct environment values", () => {
    const store = loadUnlockKeyStore(
      "v1",
      "PUBLIC_BASE64",
      "PRIVATE_BASE64",
    );

    expect(store.size).toBe(1);
    expect(store.get("v1")).toEqual({
      version: "v1",
      publicKey: "PUBLIC_BASE64",
      privateKey: "PRIVATE_BASE64",
    });
  });

  it("loads a versioned key store and validates the current version", () => {
    const store = loadUnlockKeyStore(
      "v2",
      undefined,
      undefined,
      "v1:PUBLIC_A,v2:PUBLIC_B",
      "v1:PRIVATE_A,v2:PRIVATE_B",
    );

    expect(store.size).toBe(2);
    expect(store.get("v2")).toEqual({
      version: "v2",
      publicKey: "PUBLIC_B",
      privateKey: "PRIVATE_B",
    });
  });

  it("throws when a versioned key store is missing a matching private key", () => {
    expect(() =>
      loadUnlockKeyStore(
        "v1",
        undefined,
        undefined,
        "v1:PUBLIC_A",
        "v2:PRIVATE_B",
      ),
    ).toThrow("Unlock key version v1 does not have both public and private values configured.");
  });

  it("throws when the current unlock key version is not configured", () => {
    expect(() =>
      loadUnlockKeyStore(
        "v3",
        undefined,
        undefined,
        "v1:PUBLIC_A,v2:PUBLIC_B",
        "v1:PRIVATE_A,v2:PRIVATE_B",
      ),
    ).toThrow("Current unlock key version v3 is not configured.");
  });
});
