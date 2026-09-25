import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getReadinessAttestation,
  getServerDeploymentManifest,
} from "./envValidator";

describe("Server Deployment Manifest & Readiness Attestation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("generates deterministic manifestHash in development", () => {
    process.env.NODE_ENV = "development";
    process.env.PUBLIC_STELLAR_NETWORK = "TESTNET";
    process.env.PUBLIC_STELLAR_RPC_URL = "https://soroban-testnet.stellar.org";
    process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID = "CB6678...MOCK";

    const manifest1 = getServerDeploymentManifest(true);
    const manifest2 = getServerDeploymentManifest(true);

    expect(manifest1.manifestHash).toBeTruthy();
    expect(manifest1.manifestHash).toEqual(manifest2.manifestHash);
  });

  it("fails production validation when PUBLIC_STELLAR_NETWORK is missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PUBLIC_STELLAR_NETWORK;
    delete process.env.PUBLIC_STELLAR_RPC_URL;

    expect(() => getServerDeploymentManifest(true)).toThrow(
      "[Server Deployment Manifest Validation Failure]"
    );
  });

  it("fails production validation when simulation account equals unlock public key", () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_STELLAR_NETWORK = "MAINNET";
    process.env.PUBLIC_STELLAR_RPC_URL = "https://mainnet.stellar.org";
    process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID = "C" + "A".repeat(55);
    process.env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID = "C" + "B".repeat(55);
    process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT = "G" + "A".repeat(55);
    process.env.UNLOCK_PUBLIC_KEY = "G" + "A".repeat(55);

    expect(() => getServerDeploymentManifest(true)).toThrow(
      "PUBLIC_STELLAR_SIMULATION_ACCOUNT cannot be identical to UNLOCK_PUBLIC_KEY"
    );
  });

  it("returns readiness attestation Object", () => {
    process.env.NODE_ENV = "development";
    const attestation = getReadinessAttestation();
    expect(attestation.ready).toBe(true);
    expect(attestation.manifestHash).toBeTruthy();
  });
});
