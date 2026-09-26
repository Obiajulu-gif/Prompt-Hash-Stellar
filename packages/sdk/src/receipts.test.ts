// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers";
import { Keypair, StrKey, nativeToScVal } from "@stellar/stellar-sdk";
import type { PurchaseReceipt } from "./types.js";

interface FakeState {
  network: { passphrase: string };
  transaction: { status: string; ledger?: number };
  events: Array<{ txHash: string; topic: unknown[]; value: unknown }>;
  simulationResult: unknown;
  accountSequence: string;
}

const { state, FakeServer } = vi.hoisted(() => {
  const state: FakeState = {
    network: { passphrase: "" },
    transaction: { status: "NOT_FOUND" },
    events: [],
    simulationResult: { error: "no simulation configured" },
    accountSequence: "1",
  };

  class FakeServer {
    constructor(_url: string, _opts?: unknown) {}
    async getNetwork() {
      return state.network;
    }
    async getTransaction(_hash: string) {
      return state.transaction;
    }
    async getEvents(_request: unknown) {
      return { events: state.events };
    }
    async getAccount(publicKey: string) {
      return { accountId: () => publicKey, sequenceNumber: () => state.accountSequence };
    }
    async simulateTransaction(_tx: unknown) {
      return state.simulationResult;
    }
  }

  return { state, FakeServer };
});

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: FakeServer },
  };
});

const { verifyReceipt, canonicalizeReceipt } = await import("./receipts.js");

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = StrKey.encodeContract(new Uint8Array(32).fill(7));

function mkEvent(topic: string, data: Record<string, unknown>, txHash: string) {
  return {
    txHash,
    topic: [nativeToScVal(topic, { type: "symbol" })],
    value: nativeToScVal(data),
  };
}

async function sign(receipt: PurchaseReceipt) {
  await sodium.ready;
  const keypair = sodium.crypto_sign_keypair();
  const message = sodium.from_string(canonicalizeReceipt(receipt));
  const signature = sodium.crypto_sign_detached(message, keypair.privateKey);
  return {
    signature: sodium.to_base64(signature, sodium.base64_variants.ORIGINAL),
    signerPublicKey: sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL),
  };
}

function baseReceipt(overrides: Partial<PurchaseReceipt> = {}): PurchaseReceipt {
  return {
    version: 1,
    network: { passphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL },
    contract: { id: CONTRACT_ID },
    prompt: { id: "42", revision: 0 },
    buyer: Keypair.random().publicKey(),
    asset: { contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" },
    amount: { stroops: "10000000" },
    transaction: { hash: "a".repeat(64), ledger: 1000, createdAt: new Date().toISOString() },
    event: { topic: "PromptPurchased", index: 0 },
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

function configureOnChainTruth(receipt: PurchaseReceipt) {
  state.network = { passphrase: receipt.network.passphrase };
  state.transaction = { status: "SUCCESS", ledger: receipt.transaction.ledger };
  state.events = [
    mkEvent(
      receipt.event.topic,
      {
        prompt_id: BigInt(receipt.prompt.id),
        buyer: receipt.buyer,
        price_stroops: BigInt(receipt.amount.stroops),
      },
      receipt.transaction.hash,
    ),
  ];
}

beforeEach(() => {
  state.network = { passphrase: "" };
  state.transaction = { status: "NOT_FOUND" };
  state.events = [];
  state.simulationResult = { error: "no simulation configured" };
  state.accountSequence = "1";
});

describe("verifyReceipt", () => {
  it("passes every check for an untampered receipt matching on-chain truth", async () => {
    const receipt = baseReceipt();
    configureOnChainTruth(receipt);
    const { signature, signerPublicKey } = await sign(receipt);

    const result = await verifyReceipt(receipt, signature, signerPublicKey, {
      skipEntitlementCheck: true,
    });

    expect(result.valid).toBe(true);
    expect(result.checks).toEqual({
      signatureValid: true,
      networkMatches: true,
      transactionFound: true,
      transactionSucceeded: true,
      eventMatches: true,
    });
    expect(result.errors).toEqual([]);
  });

  it("fails when a field is altered after signing (signature tamper)", async () => {
    const receipt = baseReceipt();
    configureOnChainTruth(receipt);
    const { signature, signerPublicKey } = await sign(receipt);

    const tampered: PurchaseReceipt = { ...receipt, amount: { stroops: "999999999" } };

    const result = await verifyReceipt(tampered, signature, signerPublicKey, {
      skipEntitlementCheck: true,
    });

    expect(result.valid).toBe(false);
    expect(result.checks.signatureValid).toBe(false);
  });

  it("fails eventMatches when a validly-signed receipt disagrees with on-chain truth", async () => {
    const receipt = baseReceipt({ amount: { stroops: "1" } });
    configureOnChainTruth({ ...receipt, amount: { stroops: "10000000" } });
    const { signature, signerPublicKey } = await sign(receipt);

    const result = await verifyReceipt(receipt, signature, signerPublicKey, {
      skipEntitlementCheck: true,
    });

    expect(result.checks.signatureValid).toBe(true);
    expect(result.checks.eventMatches).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("fails networkMatches when the RPC endpoint is on a different network", async () => {
    const receipt = baseReceipt();
    configureOnChainTruth(receipt);
    state.network = { passphrase: "Public Global Stellar Network ; September 2015" };
    const { signature, signerPublicKey } = await sign(receipt);

    const result = await verifyReceipt(receipt, signature, signerPublicKey, {
      skipEntitlementCheck: true,
    });

    expect(result.checks.networkMatches).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("fails transactionFound for an orphaned/unconfirmed transaction", async () => {
    const receipt = baseReceipt();
    configureOnChainTruth(receipt);
    state.transaction = { status: "NOT_FOUND" };
    const { signature, signerPublicKey } = await sign(receipt);

    const result = await verifyReceipt(receipt, signature, signerPublicKey, {
      skipEntitlementCheck: true,
    });

    expect(result.checks.transactionFound).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("fails transactionSucceeded for a failed transaction", async () => {
    const receipt = baseReceipt();
    configureOnChainTruth(receipt);
    state.transaction = { status: "FAILED", ledger: receipt.transaction.ledger };
    const { signature, signerPublicKey } = await sign(receipt);

    const result = await verifyReceipt(receipt, signature, signerPublicKey, {
      skipEntitlementCheck: true,
    });

    expect(result.checks.transactionFound).toBe(true);
    expect(result.checks.transactionSucceeded).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("reports a refunded purchase via the current-entitlement signal without affecting historical validity", async () => {
    const receipt = baseReceipt();
    configureOnChainTruth(receipt);
    const { signature, signerPublicKey } = await sign(receipt);

    state.simulationResult = {
      result: { retval: nativeToScVal(false, { type: "bool" }) },
    };

    const result = await verifyReceipt(receipt, signature, signerPublicKey, {
      simulationAccount: receipt.buyer,
    });

    expect(result.valid).toBe(true); // the purchase itself still verifiably happened
    expect(result.currentEntitlement?.hasAccess).toBe(false);
  });

  it("reports transferred/expired licenses as hasAccess:false with no dispute on record", async () => {
    const receipt = baseReceipt();
    configureOnChainTruth(receipt);
    const { signature, signerPublicKey } = await sign(receipt);

    let call = 0;
    const originalSimulate = FakeServer.prototype.simulateTransaction;
    FakeServer.prototype.simulateTransaction = async function () {
      call += 1;
      // First call: has_access -> false. Second call: get_dispute -> simulation error (no record).
      if (call === 1) {
        return { result: { retval: nativeToScVal(false, { type: "bool" }) } };
      }
      return { error: "no dispute found" };
    };

    const result = await verifyReceipt(receipt, signature, signerPublicKey, {
      simulationAccount: receipt.buyer,
    });

    FakeServer.prototype.simulateTransaction = originalSimulate;

    expect(result.valid).toBe(true);
    expect(result.currentEntitlement?.hasAccess).toBe(false);
    expect(result.currentEntitlement?.disputeStatus).toBeUndefined();
  });
});
