import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  submitXlmPromptPayment,
  buildXlmPromptPaymentArgs,
  type XlmPaymentStatusUpdate,
} from "./xlmGateway";
import { prepareContractCall } from "@/lib/stellar/tx";
import { Api } from "@stellar/stellar-sdk/rpc";

vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: {
    fromXDR: vi.fn(() => ({ signed: true })),
  },
}));

vi.mock("@stellar/stellar-sdk/rpc", () => ({
  Api: {
    GetTransactionStatus: {
      SUCCESS: "SUCCESS",
      FAILED: "FAILED",
      NOT_FOUND: "NOT_FOUND",
    },
  },
}));

vi.mock("@/lib/stellar/tx", () => ({
  scValArg: vi.fn((value: unknown, type?: string) => ({ value, type })),
  prepareContractCall: vi.fn(),
}));

const config = {
  rpcUrl: "https://stellar.test/rpc",
  networkPassphrase: "Test SDF Network ; September 2015",
  promptHashContractId: "CPROMPTHASH",
};

const signer = {
  signTransaction: vi.fn(),
};

function mockPrepared(pollStatus: string = Api.GetTransactionStatus.SUCCESS) {
  const server = {
    sendTransaction: vi.fn().mockResolvedValue({
      status: "PENDING",
      hash: "abc123",
    }),
    pollTransaction: vi.fn().mockResolvedValue({
      status: pollStatus,
      resultXdr: { toXDR: () => "failed-xdr" },
    }),
  };

  vi.mocked(prepareContractCall).mockResolvedValue({
    preparedTransaction: { toXDR: () => "prepared-xdr" } as any,
    simulation: {} as any,
    server: server as any,
  });

  return server;
}

describe("XLM prompt payment gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signer.signTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
  });

  it("builds the buy_prompt payment args with native XLM stroops", () => {
    expect(
      buildXlmPromptPaymentArgs({
        config,
        signer,
        buyerAddress: "GBUYER",
        promptId: "42",
        amountStroops: 50_0000000n,
      }),
    ).toEqual([
      { value: "GBUYER", type: "address" },
      { value: 42n, type: "u64" },
      { value: null, type: undefined },
      { value: 50_0000000n, type: "i128" },
      { value: null, type: undefined },
    ]);
  });

  it("submits and confirms a successful XLM payment", async () => {
    const server = mockPrepared();
    const statuses: XlmPaymentStatusUpdate[] = [];

    const result = await submitXlmPromptPayment({
      config,
      signer,
      buyerAddress: "GBUYER",
      promptId: 7n,
      amountStroops: 12_0000000n,
      onStatus: (update) => statuses.push(update),
    });

    expect(prepareContractCall).toHaveBeenCalledWith(
      config,
      "GBUYER",
      "CPROMPTHASH",
      "buy_prompt",
      expect.any(Array),
    );
    expect(signer.signTransaction).toHaveBeenCalledWith("prepared-xdr", {
      address: "GBUYER",
      networkPassphrase: config.networkPassphrase,
    });
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
    expect(server.pollTransaction).toHaveBeenCalledWith(
      "abc123",
      expect.any(Object),
    );
    expect(result).toEqual({
      txHash: "abc123",
      success: true,
      status: "confirmed",
    });
    expect(statuses.map((update) => update.status)).toEqual([
      "awaiting_approval",
      "submitting",
      "pending",
      "confirmed",
    ]);
  });

  it("surfaces failed Stellar confirmations", async () => {
    mockPrepared(Api.GetTransactionStatus.FAILED);
    const statuses: XlmPaymentStatusUpdate[] = [];

    await expect(
      submitXlmPromptPayment({
        config,
        signer,
        buyerAddress: "GBUYER",
        promptId: 7n,
        amountStroops: 12_0000000n,
        onStatus: (update) => statuses.push(update),
      }),
    ).rejects.toThrow(/Transaction failed/);

    expect(statuses.map((update) => update.status)).toContain("failed");
  });

  it("surfaces still-pending confirmations to the caller", async () => {
    mockPrepared(Api.GetTransactionStatus.NOT_FOUND);
    const statuses: XlmPaymentStatusUpdate[] = [];

    await expect(
      submitXlmPromptPayment({
        config,
        signer,
        buyerAddress: "GBUYER",
        promptId: 7n,
        amountStroops: 12_0000000n,
        onStatus: (update) => statuses.push(update),
      }),
    ).rejects.toThrow(/still pending/);

    expect(statuses[statuses.length - 1]).toMatchObject({
      status: "pending",
      txHash: "abc123",
    });
  });
});
