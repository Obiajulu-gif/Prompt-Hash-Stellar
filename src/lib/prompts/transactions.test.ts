import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPurchaseTransactions } from "./transactions";
import { stellarExpertTxUrl } from "@/lib/stellar/explorer";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

describe("fetchPurchaseTransactions", () => {
  it("normalizes transaction records from the API", async () => {
    mockFetch(200, {
      transactions: [
        {
          id: "abc",
          promptId: "42",
          promptTitle: "GPT-4 Architect",
          promptImage: "/img.png",
          amountXlm: 5,
          versionIndex: 1,
          txHash: "deadbeef",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await fetchPurchaseTransactions("GABC");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "abc",
      promptId: "42",
      promptTitle: "GPT-4 Architect",
      amountXlm: 5,
      txHash: "deadbeef",
    });
  });

  it("defaults missing fields to safe values", async () => {
    mockFetch(200, { transactions: [{ txHash: "h1" }] });

    const [tx] = await fetchPurchaseTransactions("GABC");
    expect(tx.promptTitle).toBe("Prompt");
    expect(tx.amountXlm).toBeNull();
    expect(tx.versionIndex).toBeNull();
  });

  it("returns an empty array when there are no transactions", async () => {
    mockFetch(200, { transactions: [] });
    await expect(fetchPurchaseTransactions("GABC")).resolves.toEqual([]);
  });

  it("throws the API error message on failure", async () => {
    mockFetch(500, { error: "boom" });
    await expect(fetchPurchaseTransactions("GABC")).rejects.toThrow("boom");
  });
});

describe("stellarExpertTxUrl", () => {
  it("builds a testnet explorer link for the default network", () => {
    expect(stellarExpertTxUrl("hash123")).toBe(
      "https://stellar.expert/explorer/testnet/tx/hash123",
    );
  });
});
