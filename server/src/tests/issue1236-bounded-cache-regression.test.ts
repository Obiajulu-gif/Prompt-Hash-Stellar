import { describe, expect, it } from "vitest";
import { BoundedCache } from "../services/boundedCache";

describe("issue #1236 bounded cache regression", () => {
  it("marks a value stale before expiry and misses it at expiry", () => {
    let now = 10_000;
    const cache = new BoundedCache<string>({
      maxEntries: 2,
      defaultTtlMs: 100,
      defaultStaleMs: 50,
      now: () => now,
    });

    cache.set("dependency:status", "healthy");
    now = 10_050;
    expect(cache.inspect("dependency:status")).toMatchObject({
      status: "stale",
      value: "healthy",
    });

    now = 10_100;
    expect(cache.inspect("dependency:status")).toEqual({ status: "miss" });
  });

  it("invalidates a bounded key set without affecting unrelated entries", () => {
    const cache = new BoundedCache<number>({ maxEntries: 3, defaultTtlMs: 500 });
    cache.set("status:rpc", 1);
    cache.set("status:ipfs", 2);
    cache.set("profile:user-1", 3);

    expect(cache.invalidateWhere((key) => key.startsWith("status:"))).toBe(2);
    expect(cache.get("status:rpc")).toBeUndefined();
    expect(cache.get("status:ipfs")).toBeUndefined();
    expect(cache.get("profile:user-1")).toBe(3);
  });

  it("allows a failed refresh to retry without caching the failure", async () => {
    const cache = new BoundedCache<string>({ maxEntries: 2, defaultTtlMs: 500 });
    let attempts = 0;
    const load = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("dependency unavailable");
      return "recovered";
    };

    await expect(cache.getOrLoad("dependency:rpc", load)).rejects.toThrow(
      "dependency unavailable",
    );
    await expect(cache.getOrLoad("dependency:rpc", load)).resolves.toBe("recovered");
    expect(cache.get("dependency:rpc")).toBe("recovered");
  });
});
