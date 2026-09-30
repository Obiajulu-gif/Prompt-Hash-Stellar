import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchPurchaseReceipt } from "./entitlementReceipt";

describe("fetchPurchaseReceipt — issue #490", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the existing /api/prompts/receipt endpoint with promptId and buyerWallet", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          receipt: {
            version: 1,
            prompt: { id: "7", revision: 2 },
            buyer: "GBUYER",
            transaction: {
              hash: "tx-hash-abc123",
              ledger: 100,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            amount: { stroops: "50000000" },
            issuedAt: "2026-01-01T00:00:01.000Z",
          },
          signature: "sig",
          signerPublicKey: "pubkey",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPurchaseReceipt("7", "GBUYER");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/prompts/receipt?promptId=7&buyerWallet=GBUYER",
    );
    expect(result?.receipt.transaction.hash).toBe("tx-hash-abc123");
    expect(result?.receipt.prompt.revision).toBe(2);
  });

  it("returns null on a 404 (purchase not indexed yet) instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "No purchase transaction found" }), {
          status: 404,
        }),
      ),
    );

    const result = await fetchPurchaseReceipt("7", "GBUYER");
    expect(result).toBeNull();
  });

  it("throws with the server's error message for other failure responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "PUBLIC_PROMPT_HASH_CONTRACT_ID is not configured." }),
          { status: 500 },
        ),
      ),
    );

    await expect(fetchPurchaseReceipt("7", "GBUYER")).rejects.toThrow(
      /not configured/i,
    );
  });
});
