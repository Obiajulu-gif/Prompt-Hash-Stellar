/**
 * Unit tests for the XLM payment gateway.
 *
 * All Stellar RPC calls are mocked so these run entirely in-memory with no
 * network access required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  purchasePromptWithXlm,
  InsufficientXlmBalanceError,
  UserRejectedTransactionError,
  TransactionSubmissionError,
  type XlmPaymentConfig,
} from "./xlmPaymentGateway";

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Mock the lower-level Stellar helpers so we don't need a live RPC node.
vi.mock("./tx", async () => {
  const actual = await vi.importActual<typeof import("./tx")>("./tx");
  return {
    ...actual,
    getRpcServer: vi.fn(),
    prepareContractCall: vi.fn(),
    submitPreparedTransaction: vi.fn(),
    scValArg: vi.fn((v) => v),
  };
});

vi.mock("./nativeAssetClient", () => ({
  approveNativeAssetSpend: vi.fn(),
}));

import { getRpcServer, prepareContractCall, submitPreparedTransaction } from "./tx";
import { approveNativeAssetSpend } from "./nativeAssetClient";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const TEST_CONFIG: XlmPaymentConfig = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  promptHashContractId: "CTEST_PROMPT_HASH_CONTRACT",
  nativeAssetContractId: "CTEST_NATIVE_ASSET_CONTRACT",
};

const BUYER = "GBUYER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE";
const PROMPT_ID = 1n;
const PRICE = 50_000_000n; // 5 XLM

const mockSigner = {
  signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "mock_signed_xdr" }),
};

const mockPrepared = { preparedTransaction: {}, simulation: {}, server: {} };
const mockSubmitResult = { hash: "abc123txhash", status: "SUCCESS" };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("purchasePromptWithXlm", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: happy-path stubs
    vi.mocked(getRpcServer).mockReturnValue({
      getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1000 }),
    } as any);

    vi.mocked(approveNativeAssetSpend).mockResolvedValue({} as any);
    vi.mocked(prepareContractCall).mockResolvedValue(mockPrepared as any);
    vi.mocked(submitPreparedTransaction).mockResolvedValue(mockSubmitResult as any);
  });

  // ── Success path ──────────────────────────────────────────────────────────

  it("returns a txHash on a successful purchase", async () => {
    const result = await purchasePromptWithXlm(
      TEST_CONFIG,
      mockSigner,
      BUYER,
      PROMPT_ID,
      PRICE,
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("abc123txhash");
  });

  it("calls approveNativeAssetSpend with the correct spender (the contract)", async () => {
    await purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE);

    expect(approveNativeAssetSpend).toHaveBeenCalledOnce();
    const [, , owner, spender, amount] = vi.mocked(approveNativeAssetSpend).mock.calls[0];
    expect(owner).toBe(BUYER);
    expect(spender).toBe(TEST_CONFIG.promptHashContractId);
    expect(amount).toBe(PRICE);
  });

  it("calls buy_prompt on the PromptHash contract after approval", async () => {
    await purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE);

    expect(prepareContractCall).toHaveBeenCalledOnce();
    const [, source, contractId, method] = vi.mocked(prepareContractCall).mock.calls[0];
    expect(source).toBe(BUYER);
    expect(contractId).toBe(TEST_CONFIG.promptHashContractId);
    expect(method).toBe("buy_prompt");
  });

  it("uses an expiration ledger ~120 ledgers ahead of current", async () => {
    const currentSeq = 5000;
    vi.mocked(getRpcServer).mockReturnValue({
      getLatestLedger: vi.fn().mockResolvedValue({ sequence: currentSeq }),
    } as any);

    await purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE);

    const [, , , , amount, expiry] = vi.mocked(approveNativeAssetSpend).mock.calls[0];
    expect(expiry).toBe(currentSeq + 120);
  });

  // ── Configuration guard ───────────────────────────────────────────────────

  it("throws when promptHashContractId is missing", async () => {
    const badConfig = { ...TEST_CONFIG, promptHashContractId: "" };
    await expect(
      purchasePromptWithXlm(badConfig, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow("PromptHash contract ID is not configured");
  });

  it("throws when nativeAssetContractId is missing", async () => {
    const badConfig = { ...TEST_CONFIG, nativeAssetContractId: "" };
    await expect(
      purchasePromptWithXlm(badConfig, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow("Native asset contract ID is not configured");
  });

  // ── User rejection ────────────────────────────────────────────────────────

  it("throws UserRejectedTransactionError when the user rejects approval", async () => {
    vi.mocked(approveNativeAssetSpend).mockRejectedValue(
      new Error("User rejected the request"),
    );

    await expect(
      purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow(UserRejectedTransactionError);
  });

  it("throws UserRejectedTransactionError when the user denies the buy tx", async () => {
    vi.mocked(submitPreparedTransaction).mockRejectedValue(
      new Error("action rejected"),
    );

    await expect(
      purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow(UserRejectedTransactionError);
  });

  // ── Insufficient balance ──────────────────────────────────────────────────

  it("throws InsufficientXlmBalanceError on op_underfunded during approval", async () => {
    vi.mocked(approveNativeAssetSpend).mockRejectedValue(
      new Error("op_underfunded"),
    );

    await expect(
      purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow(InsufficientXlmBalanceError);
  });

  it("throws InsufficientXlmBalanceError on 'insufficient' error during buy", async () => {
    vi.mocked(submitPreparedTransaction).mockRejectedValue(
      new Error("insufficient balance"),
    );

    await expect(
      purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow(InsufficientXlmBalanceError);
  });

  it("throws InsufficientXlmBalanceError on tx_insufficient_balance", async () => {
    vi.mocked(approveNativeAssetSpend).mockRejectedValue(
      new Error("tx_insufficient_balance"),
    );

    await expect(
      purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow(InsufficientXlmBalanceError);
  });

  // ── Network / contract errors ─────────────────────────────────────────────

  it("throws TransactionSubmissionError on generic network failure", async () => {
    vi.mocked(submitPreparedTransaction).mockRejectedValue(
      new Error("Connection refused"),
    );

    await expect(
      purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow(TransactionSubmissionError);
  });

  it("throws TransactionSubmissionError when getRpcServer fails", async () => {
    vi.mocked(getRpcServer).mockReturnValue({
      getLatestLedger: vi.fn().mockRejectedValue(new Error("RPC error")),
    } as any);

    await expect(
      purchasePromptWithXlm(TEST_CONFIG, mockSigner, BUYER, PROMPT_ID, PRICE),
    ).rejects.toThrow(TransactionSubmissionError);
  });
});

// ─── PromptHashClient integration ────────────────────────────────────────────

describe("PromptHashClient.purchasePrompt (on-chain mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getRpcServer).mockReturnValue({
      getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1000 }),
    } as any);
    vi.mocked(approveNativeAssetSpend).mockResolvedValue({} as any);
    vi.mocked(prepareContractCall).mockResolvedValue(mockPrepared as any);
    vi.mocked(submitPreparedTransaction).mockResolvedValue(mockSubmitResult as any);
  });

  it("uses mock path when config has no contractId", async () => {
    const { PromptHashClient } = await import("./promptHashClient");
    const result = await PromptHashClient.purchasePrompt("1", BUYER, {
      delay: 0,
    });
    expect(result.success).toBe(true);
    expect(result.txHash).toMatch(/^tx_/);
    // On-chain helpers must NOT have been called
    expect(approveNativeAssetSpend).not.toHaveBeenCalled();
  });

  it("calls on-chain gateway when config and signer are provided", async () => {
    const { PromptHashClient } = await import("./promptHashClient");
    const result = await PromptHashClient.purchasePrompt("1", BUYER, {
      config: TEST_CONFIG,
      signer: mockSigner,
      priceStroops: PRICE,
    });
    expect(result.success).toBe(true);
    expect(result.txHash).toBe("abc123txhash");
    expect(approveNativeAssetSpend).toHaveBeenCalledOnce();
  });

  it("re-throws InsufficientXlmBalanceError from gateway", async () => {
    vi.mocked(approveNativeAssetSpend).mockRejectedValue(
      new Error("op_underfunded"),
    );
    const { PromptHashClient } = await import("./promptHashClient");

    await expect(
      PromptHashClient.purchasePrompt("1", BUYER, {
        config: TEST_CONFIG,
        signer: mockSigner,
        priceStroops: PRICE,
      }),
    ).rejects.toThrow(InsufficientXlmBalanceError);
  });

  it("re-throws UserRejectedTransactionError from gateway", async () => {
    vi.mocked(approveNativeAssetSpend).mockRejectedValue(
      new Error("User rejected the request"),
    );
    const { PromptHashClient } = await import("./promptHashClient");

    await expect(
      PromptHashClient.purchasePrompt("1", BUYER, {
        config: TEST_CONFIG,
        signer: mockSigner,
        priceStroops: PRICE,
      }),
    ).rejects.toThrow(UserRejectedTransactionError);
  });

  it("wraps unknown gateway errors as plain Error", async () => {
    vi.mocked(submitPreparedTransaction).mockRejectedValue(
      new Error("some random contract error"),
    );
    const { PromptHashClient } = await import("./promptHashClient");

    await expect(
      PromptHashClient.purchasePrompt("1", BUYER, {
        config: TEST_CONFIG,
        signer: mockSigner,
        priceStroops: PRICE,
      }),
    ).rejects.toThrow("some random contract error");
  });

  it("mock path rejects when forceFailure is set", async () => {
    const { PromptHashClient } = await import("./promptHashClient");
    await expect(
      PromptHashClient.purchasePrompt("1", BUYER, {
        forceFailure: "Simulated failure",
        delay: 0,
      }),
    ).rejects.toThrow("Simulated failure");
  });
});
