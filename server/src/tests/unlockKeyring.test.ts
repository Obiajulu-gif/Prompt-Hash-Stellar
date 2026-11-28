import { describe, it, expect } from "vitest";
import {
  loadUnlockKeyring,
  resolvePromptUnlockKey,
  UnlockKeyError,
  validateUnlockKeyring,
} from "../services/unlockKeyring";
import {
  formatWrappedKey,
  parseWrappedKey,
  WRAPPED_KEY_VERSION_PREFIX,
} from "../../../src/lib/crypto/wrappedKeyFormat";
import { validateStartupConfig, StartupConfigurationError } from "../config/startupValidation";

// Distinct, well-formed base64 values (no placeholder patterns).
const PUB_A = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==";
const PRIV_A = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQg==";
const PUB_B = "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQw==";
const PRIV_B = "REREREREREREREREREREREREREREREREREQ==";

const SINGLE_KEY_ENV = {
  UNLOCK_PUBLIC_KEY: PUB_A,
  UNLOCK_PRIVATE_KEY: PRIV_A,
};

function keysetEnv(entries: unknown[], extra: Record<string, string> = {}) {
  return { UNLOCK_KEYS_JSON: JSON.stringify(entries), ...extra };
}

const ACTIVE_B = { keyId: "unlock-2026-11", publicKey: PUB_B, privateKey: PRIV_B, status: "active" };
const RETIRED_A = { keyId: "unlock-2026-01", publicKey: PUB_A, privateKey: PRIV_A, status: "retired" };

describe("unlock key ring — missing and invalid secrets fail closed", () => {
  it("reports every missing single-key variable by name", () => {
    expect(() => loadUnlockKeyring({})).toThrow(UnlockKeyError);
    const problems = validateUnlockKeyring({});
    expect(problems).toContain("UNLOCK_PUBLIC_KEY is not configured.");
    expect(problems).toContain("UNLOCK_PRIVATE_KEY is not configured.");
  });

  it("rejects placeholder key material", () => {
    const problems = validateUnlockKeyring({
      UNLOCK_PUBLIC_KEY: "replace-with-public-key",
      UNLOCK_PRIVATE_KEY: PRIV_A,
    });
    expect(problems).toContain("UNLOCK_PUBLIC_KEY still has a placeholder value.");
  });

  it("rejects non-base64 key material", () => {
    const problems = validateUnlockKeyring({ UNLOCK_PUBLIC_KEY: PUB_A, UNLOCK_PRIVATE_KEY: "not base64!!" });
    expect(problems).toContain("UNLOCK_PRIVATE_KEY does not match base64 format.");
  });

  it("never echoes key material in its problem list", () => {
    const problems = validateUnlockKeyring({ UNLOCK_PUBLIC_KEY: PUB_A, UNLOCK_PRIVATE_KEY: "bad value" });
    for (const problem of problems) {
      expect(problem).not.toContain(PUB_A);
      expect(problem).not.toContain("bad value");
    }
  });

  it("rejects malformed JSON in the key ring", () => {
    expect(validateUnlockKeyring({ UNLOCK_KEYS_JSON: "[not json" })).toEqual([
      "UNLOCK_KEYS_JSON is not valid JSON.",
    ]);
  });

  it("returns no problems for a valid single-key configuration", () => {
    expect(validateUnlockKeyring(SINGLE_KEY_ENV)).toEqual([]);
  });

  it("surfaces unlock key ring problems through startup validation", () => {
    const env = {
      NODE_ENV: "production",
      PUBLIC_STELLAR_NETWORK: "PUBLIC",
      UNLOCK_KEYS_JSON: JSON.stringify([ACTIVE_B, { ...ACTIVE_B, keyId: "second-active", publicKey: PUB_A, privateKey: PRIV_A }]),
    };
    try {
      validateStartupConfig(env, { strictProduction: true });
      throw new Error("expected startup validation to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(StartupConfigurationError);
      const keys = (err as StartupConfigurationError).errors.map((e) => e.key);
      expect(keys).toContain("UNLOCK_KEYS_JSON");
    }
  });
});

describe("unlock key ring — key ring rules", () => {
  it("accepts a rotated ring with one active and one retired (decrypt-only) key", () => {
    const keyring = loadUnlockKeyring(keysetEnv([ACTIVE_B, RETIRED_A]));
    expect(keyring.activeKeyId).toBe("unlock-2026-11");
    expect(keyring.legacyKeyId).toBe("unlock-2026-11");
    expect(keyring.keys.size).toBe(2);
  });

  it("requires exactly one active key", () => {
    const problems = validateUnlockKeyring(keysetEnv([ACTIVE_B, { ...RETIRED_A, status: "active" }]));
    expect(problems).toContain("Exactly one unlock key must be active (found 2).");
  });

  it("rejects a rotation that reuses key material under a new id", () => {
    const problems = validateUnlockKeyring(
      keysetEnv([{ ...ACTIVE_B, publicKey: PUB_A, privateKey: PRIV_A }, RETIRED_A]),
    );
    expect(problems.some((p) => p.includes("reuses key material"))).toBe(true);
  });

  it("rejects duplicate key ids", () => {
    const problems = validateUnlockKeyring(keysetEnv([ACTIVE_B, { ...RETIRED_A, keyId: ACTIVE_B.keyId }]));
    expect(problems).toContain(`Duplicate unlock key id "${ACTIVE_B.keyId}".`);
  });

  it("rejects UNLOCK_ACTIVE_KEY_ID that does not name the active entry", () => {
    const problems = validateUnlockKeyring(keysetEnv([ACTIVE_B, RETIRED_A], { UNLOCK_ACTIVE_KEY_ID: RETIRED_A.keyId }));
    expect(problems).toContain("UNLOCK_ACTIVE_KEY_ID must name the active key in UNLOCK_KEYS_JSON.");
  });

  it("rejects a legacy key id that names no configured key", () => {
    const problems = validateUnlockKeyring(keysetEnv([ACTIVE_B], { UNLOCK_LEGACY_KEY_ID: "ghost" }));
    expect(problems.some((p) => p.includes('names no configured key ("ghost")'))).toBe(true);
  });

  it("rejects a keyId that does not match the allowed pattern", () => {
    const problems = validateUnlockKeyring(keysetEnv([{ ...ACTIVE_B, keyId: "has spaces" }]));
    expect(problems.some((p) => p.includes(".keyId is missing or malformed"))).toBe(true);
  });
});

describe("unlock key ring — wrapped key versioning", () => {
  it("round-trips a versioned wrapped key", () => {
    const wrapped = formatWrappedKey("unlock-2026-11", PUB_B);
    expect(wrapped.startsWith(WRAPPED_KEY_VERSION_PREFIX)).toBe(true);
    expect(parseWrappedKey(wrapped)).toEqual({ keyId: "unlock-2026-11", sealed: PUB_B });
  });

  it("treats an untagged legacy value as having no version", () => {
    expect(parseWrappedKey(PUB_A)).toEqual({ keyId: null, sealed: PUB_A });
  });

  it("refuses to format a key id that could break the tag syntax", () => {
    expect(() => formatWrappedKey("bad:id", PUB_A)).toThrow(/Unlock key id/);
    expect(() => formatWrappedKey("", PUB_A)).toThrow(/Unlock key id/);
  });

  it("rejects a version tag with no sealed key or an empty one", () => {
    expect(() => parseWrappedKey(`${WRAPPED_KEY_VERSION_PREFIX}unlock-v1`)).toThrow(/missing its sealed key/);
    expect(() => parseWrappedKey(`${WRAPPED_KEY_VERSION_PREFIX}unlock-v1:`)).toThrow(/empty sealed key/);
  });

  it("rejects a version tag whose key id is malformed", () => {
    expect(() => parseWrappedKey(`${WRAPPED_KEY_VERSION_PREFIX}-bad:${PUB_A}`)).toThrow(/malformed unlock key version/);
  });
});

describe("unlock key resolution — invalid versions and lookup failures", () => {
  it("resolves a legacy untagged prompt to the single configured key", () => {
    const resolved = resolvePromptUnlockKey(PUB_A, SINGLE_KEY_ENV);
    expect(resolved).toMatchObject({ keyId: "unlock-v1", sealed: PUB_A, publicKey: PUB_A, privateKey: PRIV_A });
  });

  it("selects the key named by a versioned prompt, including a retired key for decryption", () => {
    const env = keysetEnv([ACTIVE_B, RETIRED_A]);
    const oldPrompt = formatWrappedKey(RETIRED_A.keyId, PUB_A);
    expect(resolvePromptUnlockKey(oldPrompt, env)).toMatchObject({
      keyId: RETIRED_A.keyId,
      status: "retired",
      privateKey: PRIV_A,
    });
    const newPrompt = formatWrappedKey(ACTIVE_B.keyId, PUB_B);
    expect(resolvePromptUnlockKey(newPrompt, env)).toMatchObject({ keyId: ACTIVE_B.keyId, status: "active" });
  });

  it("fails with UNKNOWN_VERSION, naming only the version, when the key was never configured", () => {
    const err = captureError(() =>
      resolvePromptUnlockKey(formatWrappedKey("unlock-2019-01", PUB_A), keysetEnv([ACTIVE_B])),
    );
    expect(err).toBeInstanceOf(UnlockKeyError);
    expect(err.code).toBe("UNLOCK_KEY_UNKNOWN_VERSION");
    expect(err.keyId).toBe("unlock-2019-01");
  });

  it("fails with MALFORMED_VERSION for an unparseable version tag", () => {
    const err = captureError(() => resolvePromptUnlockKey(`${WRAPPED_KEY_VERSION_PREFIX}bad id:${PUB_A}`, SINGLE_KEY_ENV));
    expect(err.code).toBe("UNLOCK_KEY_MALFORMED_VERSION");
  });

  it("fails with LOOKUP_FAILED, without key material, when the ring cannot be loaded", () => {
    const err = captureError(() => resolvePromptUnlockKey(PUB_A, {}));
    expect(err.code).toBe("UNLOCK_KEY_LOOKUP_FAILED");
    expect(err.message).not.toContain(PRIV_A);
  });
});

function captureError(fn: () => unknown): UnlockKeyError {
  try {
    fn();
  } catch (err) {
    return err as UnlockKeyError;
  }
  throw new Error("expected function to throw");
}
