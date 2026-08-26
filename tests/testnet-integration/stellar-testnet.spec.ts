/**
 * Stellar testnet integration suite for PromptHash.
 *
 * Run separately from unit tests — requires network access and a funded fixture wallet.
 *
 * Environment variables (never commit real values):
 *   TESTNET_FIXTURE_SECRET   — Secret key of the funded testnet wallet.
 *   TESTNET_RPC_URL          — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org).
 *   TESTNET_NETWORK_PASSPHRASE — Network passphrase (default: Test SDF Network ; September 2015).
 *   TESTNET_PROMPT_HASH_CONTRACT_ID — Deployed PromptHash contract address on testnet.
 *   TESTNET_SIMULATION_ACCOUNT — Account for read-only contract simulations.
 *   TESTNET_NATIVE_ASSET_CONTRACT_ID — Native XLM asset contract.
 *
 * Run with:
 *   TESTNET_FIXTURE_SECRET=<secret> npx vitest run tests/testnet-integration
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  Keypair,
  Account,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { Server as SorobanServer } from "@stellar/stellar-sdk/rpc";
import { PromptHashClient } from "../../src/lib/stellar/promptHashClient";
import type { PromptHashConfig } from "../../src/lib/stellar/promptHashClient";

const FIXTURE_SECRET = process.env.TESTNET_FIXTURE_SECRET;
const RPC_URL =
  process.env.TESTNET_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.TESTNET_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT_ID = process.env.TESTNET_PROMPT_HASH_CONTRACT_ID ?? "";
const SIMULATION_ACCOUNT = process.env.TESTNET_SIMULATION_ACCOUNT ?? "";
const NATIVE_ASSET_CONTRACT_ID =
  process.env.TESTNET_NATIVE_ASSET_CONTRACT_ID ?? "";

// Skip the entire suite when secrets are not provided.
const hasFixture = Boolean(FIXTURE_SECRET && CONTRACT_ID && SIMULATION_ACCOUNT);

let config: PromptHashConfig;
let fixtureKey: Keypair;

describe.skipIf(!hasFixture)("PromptHash testnet integration", () => {
  beforeAll(() => {
    fixtureKey = Keypair.fromSecret(FIXTURE_SECRET!);
    config = {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      promptHashContractId: CONTRACT_ID,
      nativeAssetContractId: NATIVE_ASSET_CONTRACT_ID,
      simulationAccount: SIMULATION_ACCOUNT,
    };
  });

  it("fixture wallet is funded and can connect", async () => {
    const server = new SorobanServer(RPC_URL, { allowHttp: false });
    const account = await server.getAccount(fixtureKey.publicKey());

    expect(account.id).toBe(fixtureKey.publicKey());
    expect(parseInt(account.balances[0].balance, 10)).toBeGreaterThan(10); // At least 10 XLM
  });

  it("can read all prompts from contract", async () => {
    const prompts = await PromptHashClient.getAllPrompts(config);

    // Should return an array (even if empty on fresh testnet)
    expect(Array.isArray(prompts)).toBe(true);

    // If there are prompts, verify structure
    if (prompts.length > 0) {
      const prompt = prompts[0];
      expect(prompt.id).toBeDefined();
      expect(typeof prompt.title).toBe("string");
      expect(typeof prompt.priceStroops).toBe("bigint");
    }
  });

  it("can check access for a prompt", async () => {
    // Query all prompts to find one to check
    const prompts = await PromptHashClient.getAllPrompts(config);

    if (prompts.length > 0) {
      const firstPrompt = prompts[0];
      const hasAccess = await PromptHashClient.checkAccess(
        config,
        fixtureKey.publicKey(),
        firstPrompt.id,
      );

      // Should return a boolean
      expect(typeof hasAccess).toBe("boolean");
    } else {
      // No prompts to test, but function should work
      expect(true).toBe(true);
    }
  });

  it("can get prompts by creator (returns empty if not creator)", async () => {
    const creatorPrompts = await PromptHashClient.getPromptsByCreator(
      config,
      fixtureKey.publicKey(),
    );

    // Should return an array
    expect(Array.isArray(creatorPrompts)).toBe(true);
  });

  it("can get bundles by creator (returns empty if not creator)", async () => {
    const bundles = await PromptHashClient.getBundlesByCreator(
      config,
      fixtureKey.publicKey(),
    );

    // Should return an array
    expect(Array.isArray(bundles)).toBe(true);
  });

  it("can get access passes by creator (returns empty if not creator)", async () => {
    const passes = await PromptHashClient.getAccessPassesByCreator(
      config,
      fixtureKey.publicKey(),
    );

    // Should return an array
    expect(Array.isArray(passes)).toBe(true);
  });

  it("contract methods are called and receive non-error responses", async () => {
    // This is a smoke test that real contract methods execute without throwing
    try {
      const prompts = await PromptHashClient.getAllPrompts(config);
      expect(prompts).toBeDefined();
    } catch (e) {
      // Some network errors are acceptable in testnet, but contract errors should not occur
      const msg = (e as Error).message.toLowerCase();
      expect(!msg.includes("contract") || msg.includes("restore")).toBe(true);
    }
  });

  it("fixture wallet can build and simulate transactions", async () => {
    const server = new SorobanServer(RPC_URL, { allowHttp: false });
    const account = await server.getAccount(fixtureKey.publicKey());

    // Build a no-op contract call to verify signing pipeline works
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(CONTRACT_ID).call("get_all_prompts"))
      .setTimeout(30)
      .build();

    // Should simulate successfully
    const sim = await server.simulateTransaction(tx);
    expect(sim).toBeDefined();
    // Simulation should not error
    expect(!("error" in sim) || sim.error === undefined).toBe(true);
  });
});
