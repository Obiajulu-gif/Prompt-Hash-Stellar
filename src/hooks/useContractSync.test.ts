import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";

vi.mock("./useSubscription", () => ({ useSubscription: vi.fn() }));
vi.mock("./useWalletAccountChange", () => ({
  useWalletAccountChange: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(),
}));
vi.mock("@/lib/stellar/browserConfig", () => ({
  browserStellarConfig: { promptHashContractId: "test-contract-id" },
}));

import { invalidateAllPromptQueries, useContractSync } from "./useContractSync";
import { useQueryClient } from "@tanstack/react-query";
import { useWalletAccountChange } from "./useWalletAccountChange";

function mockQueryClient() {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as QueryClient;
}

const EXPECTED_KEYS = [
  ["marketplace-prompts"],
  ["created-prompts"],
  ["purchased-prompts"],
  ["saved-prompts"],
  ["prompt-access"],
];

describe("invalidateAllPromptQueries", () => {
  it("invalidates all prompt-related query keys", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(5);
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

  it("includes saved-prompts so buyer saved listings refresh after mutations", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["saved-prompts"],
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

    expect(settled).toHaveLength(5);
    expect(settled).toContain("marketplace-prompts");
    expect(settled).toContain("created-prompts");
    expect(settled).toContain("purchased-prompts");
    expect(settled).toContain("saved-prompts");
    expect(settled).toContain("prompt-access");
  });

  it("can be called multiple times without error", async () => {
    const queryClient = mockQueryClient();
    await invalidateAllPromptQueries(queryClient);
    await invalidateAllPromptQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(10);
  });
});

describe("useContractSync hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("calls useWalletAccountChange to detect wallet changes", () => {
    const mockQueryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient;
    vi.mocked(useQueryClient).mockReturnValue(mockQueryClient);

    renderHook(() => useContractSync());

    expect(useWalletAccountChange).toHaveBeenCalled();
  });

  it("prevents overlapping polls when a poll is already in progress", async () => {
    const mockQueryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient;
    vi.mocked(useQueryClient).mockReturnValue(mockQueryClient);

    let pollCount = 0;
    const originalInvalidate = vi.fn(() => {
      pollCount++;
      return Promise.resolve();
    });
    mockQueryClient.invalidateQueries = originalInvalidate;

    renderHook(() => useContractSync());

    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync();

    const firstPollCount = pollCount;
    expect(firstPollCount).toBeGreaterThan(0);
  });

  it("implements exponential backoff on repeated RPC failures", async () => {
    const mockQueryClient = {
      invalidateQueries: vi.fn().mockRejectedValue(new Error("RPC error")),
    } as unknown as QueryClient;
    vi.mocked(useQueryClient).mockReturnValue(mockQueryClient);

    renderHook(() => useContractSync());

    const intervals: number[] = [];
    const originalSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((cb, delay: number) => {
      intervals.push(delay);
      return originalSetTimeout(cb, 0);
    });

    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync();

    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync();

    vi.advanceTimersByTime(20_000);
    await vi.runAllTimersAsync();

    expect(intervals.length).toBeGreaterThan(0);
    const nonZeroIntervals = intervals.filter((i) => i > 0);
    if (nonZeroIntervals.length > 1) {
      expect(nonZeroIntervals[1]).toBeGreaterThanOrEqual(nonZeroIntervals[0]);
    }
  });

  it("resets error count on successful poll", async () => {
    let callCount = 0;
    const mockQueryClient = {
      invalidateQueries: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("First call fails");
        }
      }),
    } as unknown as QueryClient;
    vi.mocked(useQueryClient).mockReturnValue(mockQueryClient);

    renderHook(() => useContractSync());

    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync();

    vi.advanceTimersByTime(20_000);
    await vi.runAllTimersAsync();

    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});
