import { describe, expect, it, vi, beforeEach } from "vitest";
import { getPromptsByCreator, getPromptsByBuyer } from "./promptHashClient";
import * as tx from "./tx";

vi.mock("./tx", async () => {
  const actual = await vi.importActual<typeof tx>("./tx");
  return {
    ...actual,
    readContract: vi.fn(),
  };
});

const mockConfig = {
  rpcUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  promptHashContractId: "CC...",
  nativeAssetContractId: "CB...",
  simulationAccount: "GA...",
};

describe("dashboard fetch logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getPromptsByCreator handles empty responses", async () => {
    vi.mocked(tx.readContract).mockResolvedValue({
      Ok: [],
    });

    const result = await getPromptsByCreator(mockConfig, "GA...");
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
          creator: "GA...",
          title: "Test Prompt",
          price_stroops: 1000n,
          active: true,
          sales_count: 5n,
        },
      ],
    });

    const result = await getPromptsByCreator(mockConfig, "GA...");
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
          creator: "GB...",
          title: "Bought Prompt",
          price_stroops: 5000n,
          active: true,
          sales_count: 10n,
        },
      ],
    });

    const result = await getPromptsByBuyer(mockConfig, "GA...");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2n);
    expect(result[0].title).toBe("Bought Prompt");
  });

  it("handles contract errors gracefully", async () => {
    vi.mocked(tx.readContract).mockResolvedValue({
      Err: "InternalError",
    });

    await expect(getPromptsByCreator(mockConfig, "GA...")).rejects.toThrow("Contract error: InternalError");
  });
});
