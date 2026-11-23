import { describe, it, expect } from "vitest";
import {
  validateStartupConfig,
  StartupConfigurationError,
  STELLAR_NETWORK_PASSPHRASES,
  isPlaceholderValue,
} from "../config/startupValidation";

describe("Startup Configuration & Secret Validation (#1095)", () => {
  const validProductionEnv: Record<string, string> = {
    NODE_ENV: "production",
    PUBLIC_STELLAR_NETWORK: "PUBLIC",
    PUBLIC_STELLAR_NETWORK_PASSPHRASE: STELLAR_NETWORK_PASSPHRASES.PUBLIC,
    PUBLIC_STELLAR_RPC_URL: "https://mainnet.sorobanrpc.com",
    PUBLIC_STELLAR_HORIZON_URL: "https://horizon.stellar.org",
    PUBLIC_PROMPT_HASH_CONTRACT_ID: "CBBD7X4DPA4Z5V73XUWVX2Q4QJ5K5ZNVB4Y27M45T2HZZZZZZZZZZZZZ",
    PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    PUBLIC_STELLAR_SIMULATION_ACCOUNT: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    MONGODB_URI: "mongodb+srv://prompthash-cluster.stellar.internal/prompthash",
    CHALLENGE_TOKEN_SECRET: "c8f3b204e9a7156d9812456e7890abcd1234567890abcdef1234567890abcdef",
    UNLOCK_PUBLIC_KEY: "dGhpcy1pcy1hLXZhbGlkLXByb2R1Y3Rpb24tcHViLWtleS0wMQ==",
    UNLOCK_PRIVATE_KEY: "dGhpcy1pcy1hLXZhbGlkLXByb2R1Y3Rpb24tcHJpdi1rZXktMDE=",
  };

  const validTestnetEnv: Record<string, string> = {
    NODE_ENV: "development",
    PUBLIC_STELLAR_NETWORK: "TESTNET",
    PUBLIC_STELLAR_NETWORK_PASSPHRASE: STELLAR_NETWORK_PASSPHRASES.TESTNET,
    PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    PUBLIC_PROMPT_HASH_CONTRACT_ID: "CBBD7X4DPA4Z5V73XUWVX2Q4QJ5K5ZNVB4Y27M45T2HZZZZZZZZZZZZZ",
    PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    PUBLIC_STELLAR_SIMULATION_ACCOUNT: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    MONGODB_URI: "mongodb://127.0.0.1:27017/prompt-hash-stellar",
    CHALLENGE_TOKEN_SECRET: "development-local-testing-secret-key-12345",
    UNLOCK_PUBLIC_KEY: "dGhpcy1pcy1hLWRldmVsb3BtZW50LWtleS0wMQ==",
    UNLOCK_PRIVATE_KEY: "dGhpcy1pcy1hLWRldmVsb3BtZW50LWtleS0wMQ==",
  };

  it("passes cleanly for a fully configured production environment", () => {
    const report = validateStartupConfig(validProductionEnv, { throwOnError: false });
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.network).toBe("PUBLIC");
    expect(report.environment).toBe("production");
  });

  it("passes cleanly for a valid testnet development environment", () => {
    const report = validateStartupConfig(validTestnetEnv, { throwOnError: false });
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.network).toBe("TESTNET");
  });

  it("fails fast and rejects missing required secrets in production", () => {
    const broken = { ...validProductionEnv, CHALLENGE_TOKEN_SECRET: "" };
    expect(() => validateStartupConfig(broken, { throwOnError: true })).toThrowError(
      StartupConfigurationError,
    );

    const report = validateStartupConfig(broken, { throwOnError: false });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.key === "CHALLENGE_TOKEN_SECRET")).toBe(true);
  });

  it("identifies and rejects placeholder secrets and keys", () => {
    expect(isPlaceholderValue("super-secret-challenge-token-string")).toBe(true);
    expect(isPlaceholderValue("ZHVtbXktcHVibGljLWtleS12YWx1ZS1oZXJl")).toBe(true);
    expect(isPlaceholderValue("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(isPlaceholderValue("")).toBe(true);
    expect(isPlaceholderValue("real-high-entropy-production-secret-value-abcdef123456")).toBe(false);

    const placeholderEnv = {
      ...validProductionEnv,
      CHALLENGE_TOKEN_SECRET: "super-secret-challenge-token-string",
      UNLOCK_PUBLIC_KEY: "ZHVtbXktcHVibGljLWtleS12YWx1ZS1oZXJl",
      UNLOCK_PRIVATE_KEY: "ZHVtbXktcHJpdmF0ZS1rZXktdmFsdWUtaGVyZQ==",
    };

    const report = validateStartupConfig(placeholderEnv, { throwOnError: false });
    expect(report.valid).toBe(false);
    const codes = report.errors.map((e) => e.code);
    expect(codes).toContain("PLACEHOLDER_VALUE");
  });

  it("detects network passphrase and RPC conflict when network is PUBLIC but pointing to Testnet", () => {
    const conflictingEnv = {
      ...validProductionEnv,
      PUBLIC_STELLAR_NETWORK: "PUBLIC",
      PUBLIC_STELLAR_NETWORK_PASSPHRASE: STELLAR_NETWORK_PASSPHRASES.TESTNET,
      PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    };

    const report = validateStartupConfig(conflictingEnv, { throwOnError: false });
    expect(report.valid).toBe(false);
    const conflictErrors = report.errors.filter((e) => e.code === "NETWORK_CONFLICT");
    expect(conflictErrors.length).toBeGreaterThanOrEqual(2);
    expect(conflictErrors.some((e) => e.key === "PUBLIC_STELLAR_NETWORK_PASSPHRASE")).toBe(true);
    expect(conflictErrors.some((e) => e.key === "PUBLIC_STELLAR_RPC_URL")).toBe(true);
  });

  it("detects unsafe HTTP protocol in production", () => {
    const insecureEnv = {
      ...validProductionEnv,
      PUBLIC_STELLAR_RPC_URL: "http://soroban-remote.stellar.org",
      MONGODB_URI: "mongodb://127.0.0.1:27017/prod",
    };

    const report = validateStartupConfig(insecureEnv, { throwOnError: false });
    expect(report.valid).toBe(false);
    const unsafeErrors = report.errors.filter((e) => e.code === "UNSAFE_PROTOCOL");
    expect(unsafeErrors.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects malformed contract and simulation account IDs", () => {
    const malformedEnv = {
      ...validProductionEnv,
      PUBLIC_PROMPT_HASH_CONTRACT_ID: "INVALID_CONTRACT_ID",
      PUBLIC_STELLAR_SIMULATION_ACCOUNT: "NOT_AN_ACCOUNT",
    };

    const report = validateStartupConfig(malformedEnv, { throwOnError: false });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.key === "PUBLIC_PROMPT_HASH_CONTRACT_ID")).toBe(true);
    expect(report.errors.some((e) => e.key === "PUBLIC_STELLAR_SIMULATION_ACCOUNT")).toBe(true);
  });

  it("rejects secrets with insufficient entropy or length", () => {
    const weakEnv = {
      ...validProductionEnv,
      CHALLENGE_TOKEN_SECRET: "short-token",
    };

    const report = validateStartupConfig(weakEnv, { throwOnError: false });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "INSUFFICIENT_ENTROPY")).toBe(true);
  });

  it("rejects simulation account identical to unlock public key in production", () => {
    const collidingEnv = {
      ...validProductionEnv,
      PUBLIC_STELLAR_SIMULATION_ACCOUNT: validProductionEnv.UNLOCK_PUBLIC_KEY,
    };

    const report = validateStartupConfig(collidingEnv, { throwOnError: false });
    expect(report.valid).toBe(false);
    expect(
      report.errors.some(
        (e) =>
          e.key === "PUBLIC_STELLAR_SIMULATION_ACCOUNT" &&
          e.code === "NETWORK_CONFLICT" &&
          e.message.includes("cannot be identical to UNLOCK_PUBLIC_KEY"),
      ),
    ).toBe(true);
  });

  it("guarantees secrets are NEVER leaked in error messages, reports, or exception summaries", () => {
    const secretValue = "super-secret-unleaked-token-value-xyz9876";
    const privateKeyValue = "ZHVtbXktcHJpdmF0ZS1rZXktdmFsdWUtaGVyZQ==";
    const testEnv = {
      ...validProductionEnv,
      CHALLENGE_TOKEN_SECRET: secretValue,
      UNLOCK_PRIVATE_KEY: privateKeyValue,
    };

    let thrownError: StartupConfigurationError | null = null;
    try {
      validateStartupConfig(testEnv, { throwOnError: true });
    } catch (err) {
      if (err instanceof StartupConfigurationError) {
        thrownError = err;
      }
    }

    expect(thrownError).not.toBeNull();
    const errorString = thrownError!.message;
    // Secret values must never appear anywhere in the error message
    expect(errorString.includes(secretValue)).toBe(false);
    expect(errorString.includes(privateKeyValue)).toBe(false);
    expect(JSON.stringify(thrownError!.errors).includes(secretValue)).toBe(false);
  });
});
