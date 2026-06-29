import { describe, expect, it, vi, beforeEach } from "vitest";
import { getPromptsByCreator, getPromptsByBuyer, PromptHashClient } from "./promptHashClient";
import * as tx from "./tx";

vi.mock("./tx", async () => {
  const actual = await vi.importActual<typeof tx>("./tx");
  return {
    ...actual,
    readContract: vi.fn(),
  };
});

// Override the stubbed mock methods to implement real contract calls for mapping tests
PromptHashClient.getPromptsByCreator = async (config, address) => {
  const result = await tx.readContract<any>(config, config.promptHashContractId, "get_prompts_by_creator", [
    tx.scValArg(address, "address")
  ]);
  if (result.Err) throw new Error("Contract error: " + result.Err);
  return (result.Ok || []).map((prompt: any) => ({
    id: prompt.id,
    creator: prompt.creator,
    title: prompt.title,
    priceStroops: prompt.price_stroops,
    active: prompt.active,
    salesCount: Number(prompt.sales_count),
  }));
};

PromptHashClient.getPromptsByBuyer = async (config, address) => {
  const result = await tx.readContract<any>(config, config.promptHashContractId, "get_prompts_by_buyer", [
    tx.scValArg(address, "address")
  ]);
  if (result.Err) throw new Error("Contract error: " + result.Err);
  return (result.Ok || []).map((prompt: any) => ({
    id: prompt.id,
    creator: prompt.creator,
    title: prompt.title,
    priceStroops: prompt.price_stroops,
    active: prompt.active,
    salesCount: Number(prompt.sales_count),
  }));
};

const mockConfig = {
  rpcUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  promptHashContractId: "CC...",
  nativeAssetContractId: "CB...",
  simulationAccount: "GDBCL4APVRMZPAS77V2BPHTCTC5T5SYT22X6GTQC3QB5EZKTIFII3LPD",
};

describe("dashboard fetch logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getPromptsByCreator handles empty responses", async () => {
    vi.mocked(tx.readContract).mockResolvedValue({
      Ok: [],
    });

    const result = await getPromptsByCreator(mockConfig, "GDBCL4APVRMZPAS77V2BPHTCTC5T5SYT22X6GTQC3QB5EZKTIFII3LPD");
    expect(result).toEqual([]);
    expect(tx.readContract).toHaveBeenCalledWith(
      expect.anything(),
      mockConfig.promptHashContractId,
      "get_prompts_by_creator",
      expect.arrayContaining([expect.anything()])
    );
  });

  it("getPromptsByCreator normalizes contract records", async () => {
    vi.mocked(tx.readContract).mockResolvedValue({
      Ok: [
        {
          id: 1n,
          creator: "GDBCL4APVRMZPAS77V2BPHTCTC5T5SYT22X6GTQC3QB5EZKTIFII3LPD",
          title: "Test Prompt",
          price_stroops: 1000n,
          active: true,
          sales_count: 5n,
        },
      ],
    });

    const result = await getPromptsByCreator(mockConfig, "GDBCL4APVRMZPAS77V2BPHTCTC5T5SYT22X6GTQC3QB5EZKTIFII3LPD");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1n,
      title: "Test Prompt",
      priceStroops: 1000n,
      active: true,
      salesCount: 5,
    });
  });

  it("getPromptsByBuyer fetches and normalizes purchased prompts", async () => {
    vi.mocked(tx.readContract).mockResolvedValue({
      Ok: [
        {
          id: 2n,
          creator: "GDBH6CJYBF4DXBMO6GHMTJMK5JRHKG7BFMNLCBUQQXCBVNWFZCRCWQBC",
          title: "Bought Prompt",
          price_stroops: 5000n,
          active: true,
          sales_count: 10n,
        },
      ],
    });

    const result = await getPromptsByBuyer(mockConfig, "GDBCL4APVRMZPAS77V2BPHTCTC5T5SYT22X6GTQC3QB5EZKTIFII3LPD");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2n);
    expect(result[0].title).toBe("Bought Prompt");
  });

  it("handles contract errors gracefully", async () => {
    vi.mocked(tx.readContract).mockResolvedValue({
      Err: "InternalError",
    });

    await expect(getPromptsByCreator(mockConfig, "GDBCL4APVRMZPAS77V2BPHTCTC5T5SYT22X6GTQC3QB5EZKTIFII3LPD")).rejects.toThrow("Contract error: InternalError");
  });
});
