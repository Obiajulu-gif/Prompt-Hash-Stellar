import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  contractGetPromptsByBuyer,
  contractGetPromptsByCreator,
} from "../contractMethods";
import { PromptHashClient, type PromptHashConfig } from "../promptHashClient";
import * as tx from "../tx";
import { Address } from "@stellar/stellar-sdk";

vi.mock("../tx", async () => {
  const actual = await vi.importActual<typeof tx>("../tx");
  return {
    ...actual,
    readContract: vi.fn(),
  };
});

const mockConfig: PromptHashConfig = {
  rpcUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  promptHashContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  nativeAssetContractId: "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  simulationAccount: "GDBCL4APVRMZPAS77V2BPHTCTC5T5SYT22X6GTQC3QB5EZKTIFII3LPD",
};

const mockBuyer = "GA2HGBJIJKI6O4XJJWWVYGQ2OO7H4NXAO6SX77GW4G75E2MQMIE5J2JY";
const mockCreator = "GBWMHY6GZAZSZUKV4G3DXG7PW65F762Y624F3Q6GTYJ72242QG4WWWW4";

describe("contractGetPromptsByBuyer (#592)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls get_prompts_by_buyer with Address argument and decodes prompts correctly", async () => {
    const rawContractPrompt = {
      id: 42n,
      creator: mockCreator,
      price: 15000000n,
      title: "Mastering Soroban Prompts",
      category: "development",
      preview_text: "Learn how to write contracts...",
      description: "Full guide to Soroban development.",
      tags: ["stellar", "soroban", "rust"],
      image_url: "ipfs://bafybeiexample/image.png",
      sales_count: 3,
      active: true,
      content_hash: "a".repeat(64),
    };

    vi.mocked(tx.readContract).mockResolvedValueOnce([rawContractPrompt]);

    const result = await contractGetPromptsByBuyer(mockConfig, mockBuyer);

    const expectedArgs = [tx.scValArg(new Address(mockBuyer).toScVal())];

    expect(tx.readContract).toHaveBeenCalledTimes(1);
    expect(tx.readContract).toHaveBeenCalledWith(
      {
        rpcUrl: mockConfig.rpcUrl,
        networkPassphrase: mockConfig.networkPassphrase,
        allowHttp: mockConfig.allowHttp,
        simulationAccount: mockConfig.simulationAccount,
      },
      mockConfig.promptHashContractId,
      "get_prompts_by_buyer",
      expectedArgs,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 42n,
      creator: mockCreator,
      priceStroops: 15000000n,
      title: "Mastering Soroban Prompts",
      category: "development",
      previewText: "Learn how to write contracts...",
      description: "Full guide to Soroban development.",
      tags: ["stellar", "soroban", "rust"],
      imageUrl: "ipfs://bafybeiexample/image.png",
      salesCount: 3,
      active: true,
      contentHash: "a".repeat(64),
    });
  });

  it("handles empty arrays or nullish responses from get_prompts_by_buyer", async () => {
    vi.mocked(tx.readContract).mockResolvedValueOnce([]);

    const result = await contractGetPromptsByBuyer(mockConfig, mockBuyer);

    expect(result).toEqual([]);
    expect(tx.readContract).toHaveBeenCalledWith(
      expect.anything(),
      mockConfig.promptHashContractId,
      "get_prompts_by_buyer",
      expect.anything(),
    );
  });

  it("matches contractGetPromptsByCreator call shape and decoding pattern", async () => {
    const rawContractPrompt = {
      id: 10n,
      creator: mockCreator,
      price: 5000000n,
      title: "Creator Prompt",
      category: "art",
      preview_text: "Preview",
      description: "Description",
      tags: ["art"],
      image_url: "ipfs://image",
      sales_count: 1,
      active: true,
      content_hash: "b".repeat(64),
    };

    vi.mocked(tx.readContract).mockResolvedValueOnce([rawContractPrompt]);

    const result = await contractGetPromptsByCreator(mockConfig, mockCreator);

    const expectedArgs = [tx.scValArg(new Address(mockCreator).toScVal())];

    expect(tx.readContract).toHaveBeenCalledWith(
      {
        rpcUrl: mockConfig.rpcUrl,
        networkPassphrase: mockConfig.networkPassphrase,
        allowHttp: mockConfig.allowHttp,
        simulationAccount: mockConfig.simulationAccount,
      },
      mockConfig.promptHashContractId,
      "get_prompts_by_creator",
      expectedArgs,
    );

    expect(result[0].id).toBe(10n);
    expect(result[0].title).toBe("Creator Prompt");
  });

  it("PromptHashClient.getPromptsByBuyer delegates to contractGetPromptsByBuyer", async () => {
    vi.mocked(tx.readContract).mockResolvedValueOnce([]);

    const result = await PromptHashClient.getPromptsByBuyer(mockConfig, mockBuyer);

    expect(result).toEqual([]);
    expect(tx.readContract).toHaveBeenCalledWith(
      expect.anything(),
      mockConfig.promptHashContractId,
      "get_prompts_by_buyer",
      [tx.scValArg(new Address(mockBuyer).toScVal())],
    );
  });

  it("propagates errors thrown by readContract", async () => {
    vi.mocked(tx.readContract).mockRejectedValueOnce(new Error("RPC node timeout"));

    await expect(
      contractGetPromptsByBuyer(mockConfig, mockBuyer),
    ).rejects.toThrow("RPC node timeout");
  });
});
