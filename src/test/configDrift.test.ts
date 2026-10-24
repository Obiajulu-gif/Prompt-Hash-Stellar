// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  compareConfigurations,
  parseEnvironment,
  runConfigDriftCli,
} from "../../scripts/config-drift.mjs";

const baseConfig = {
  STELLAR_SCAFFOLD_ENV: "staging",
  PUBLIC_STELLAR_NETWORK: "TESTNET",
  PUBLIC_STELLAR_NETWORK_PASSPHRASE: "test-passphrase",
  PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
  PUBLIC_PROMPT_HASH_CONTRACT_ID: `C${"A".repeat(55)}`,
  PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID: `C${"B".repeat(55)}`,
  PUBLIC_STELLAR_SIMULATION_ACCOUNT: `G${"A".repeat(55)}`,
  PUBLIC_UNLOCK_PUBLIC_KEY: "public-key-value",
  CHALLENGE_TOKEN_SECRET: "challenge-secret-value",
  UNLOCK_PUBLIC_KEY: "unlock-public-key",
  UNLOCK_PRIVATE_KEY: "unlock-private-secret",
  ABUSE_RISK_MODE: "shadow",
  ALLOWLIST_MODE: "enforce",
};

const profiles = () => ({
  local: { ...baseConfig },
  staging: { ...baseConfig },
  production: { ...baseConfig },
});

describe("cross-environment configuration drift", () => {
  it("reports no drift for matching comparable settings", () => {
    expect(compareConfigurations(profiles())).toEqual({
      ok: true,
      findings: [],
      summary: { missing: 0, mismatched: 0, allowedDifferences: 0 },
    });
  });

  it("identifies required keys missing from an environment", () => {
    const configurations = profiles();
    delete configurations.staging.PUBLIC_STELLAR_RPC_URL;

    const report = compareConfigurations(configurations);
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({
      key: "PUBLIC_STELLAR_RPC_URL",
      status: "missing",
      missingEnvironments: ["staging"],
      severity: "error",
    }));
  });

  it("reports unexpected mismatches for invariant controls", () => {
    const configurations = profiles();
    configurations.production.ABUSE_RISK_MODE = "enforce";

    expect(compareConfigurations(configurations).findings).toContainEqual(expect.objectContaining({
      key: "ABUSE_RISK_MODE",
      status: "mismatch",
      severity: "error",
    }));
  });

  it("allows documented network-specific differences", () => {
    const configurations = profiles();
    configurations.production.PUBLIC_STELLAR_NETWORK = "PUBLIC";
    configurations.production.PUBLIC_STELLAR_NETWORK_PASSPHRASE = "public-passphrase";
    configurations.production.PUBLIC_STELLAR_RPC_URL = "https://soroban-rpc.mainnet.stellar.org";
    configurations.production.PUBLIC_STELLAR_HORIZON_URL = "https://horizon.stellar.org";
    configurations.production.CHALLENGE_TOKEN_SECRET = "production-only-secret";

    const report = compareConfigurations(configurations);
    expect(report.ok).toBe(true);
    expect(report.summary.allowedDifferences).toBe(5);
    expect(report.findings.every((finding) => finding.status === "allowed_difference")).toBe(true);
  });

  it("parses values but never includes secrets or config values in CLI output", () => {
    expect(
      parseEnvironment(
        '# comment\nABUSE_RISK_MODE=shadow\nPUBLIC_CHAT_API_BASE="https://example.test/path?a=b"',
      ),
    ).toEqual({
      ABUSE_RISK_MODE: "shadow",
      PUBLIC_CHAT_API_BASE: "https://example.test/path?a=b",
    });

    const configurations = profiles();
    configurations.production.ABUSE_RISK_MODE = "enforce";
    const fileContents = Object.fromEntries(
      Object.entries(configurations).map(([environment, values]) => [
        environment,
        Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"),
      ]),
    );
    const result = runConfigDriftCli(
      ["--local", "local.env", "--staging", "staging.env", "--production", "production.env", "--json"],
      { readFile: (filePath) => fileContents[filePath.split(/[\\/]/).pop().replace(".env", "")] },
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("ABUSE_RISK_MODE");
    for (const value of Object.values(baseConfig)) {
      expect(result.output).not.toContain(value);
    }
    expect(result.output).not.toContain("production-only-secret");
  });
});