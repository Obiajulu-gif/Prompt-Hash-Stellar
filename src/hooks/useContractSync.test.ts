import { describe, it, expect, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

vi.mock("./useSubscription", () => ({ useSubscription: vi.fn() }));
vi.mock("@/lib/stellar/browserConfig", () => ({
  browserStellarConfig: { promptHashContractId: "test-contract-id" },
}));

import { invalidateAllPromptQueries } from "./useContractSync";

function mockQueryClient() {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as QueryClient;
}

const EXPECTED_KEYS = [
  ["marketplace-prompts"],
  ["created-prompts"],
  ["purchased-prompts"],
  ["prompt-access"],
];

describe("invalidateAllPromptQueries", () => {
  it("invalidates all four prompt-related query keys", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
    for (const queryKey of EXPECTED_KEYS) {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey });
    }
  });

  it("includes marketplace-prompts so the browse grid refreshes after any TX", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["marketplace-prompts"],
    });
  });

  it("includes created-prompts so creator sales counts refresh after a purchase", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["created-prompts"],
    });
  });

  it("includes purchased-prompts so buyer library refreshes after buy", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["purchased-prompts"],
    });
  });

  it("includes prompt-access so access checks refresh after a purchase", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["prompt-access"],
    });
  });

  it("awaits all invalidations in parallel before resolving", async () => {
    const settled: string[] = [];
    const queryClient = {
      invalidateQueries: vi.fn().mockImplementation(
        ({ queryKey }: { queryKey: string[] }) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              settled.push(queryKey[0]);
              resolve();
            }, 5),
          ),
      ),
    } as unknown as QueryClient;

    await invalidateAllPromptQueries(queryClient);

    expect(settled).toHaveLength(4);
    expect(settled).toContain("marketplace-prompts");
    expect(settled).toContain("created-prompts");
    expect(settled).toContain("purchased-prompts");
    expect(settled).toContain("prompt-access");
  });

  it("can be called multiple times without error", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(8);
  });
});
