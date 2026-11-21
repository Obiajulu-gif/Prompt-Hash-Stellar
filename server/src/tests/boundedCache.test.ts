import { describe, expect, it, vi } from "vitest";
import { BoundedCache } from "../services/boundedCache";

describe("BoundedCache (#1040)", () => {
  it("returns fresh values and evicts the least recently used entry at capacity", () => {
    let now = 0;
    const cache = new BoundedCache<string>({
      maxEntries: 2,
      defaultTtlMs: 100,
      now: () => now,
    });
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A"); // a is now most recently used
    cache.set("c", "C");
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
  });

  it("detects stale data without serving it and removes expired data", () => {
    let now = 1_000;
    const cache = new BoundedCache<string>({
      maxEntries: 2,
      defaultTtlMs: 100,
      defaultStaleMs: 40,
      now: () => now,
    });
    cache.set("authorization", "allow");
    now = 1_040;
    expect(cache.inspect("authorization")).toEqual({
      status: "stale",
      value: "allow",
      ageMs: 40,
    });
    expect(cache.get("authorization")).toBeUndefined();
    now = 1_100;
    expect(cache.inspect("authorization")).toEqual({ status: "miss" });
    expect(cache.size).toBe(0);
  });

  it("supports exact and predicate invalidation", () => {
    const cache = new BoundedCache<number>({
      maxEntries: 5,
      defaultTtlMs: 100,
    });
    cache.set("prompt:1", 1);
    cache.set("prompt:2", 2);
    cache.set("other", 3);
    expect(cache.invalidate("other")).toBe(true);
    expect(cache.invalidateWhere((key) => key.startsWith("prompt:"))).toBe(2);
    expect(cache.size).toBe(0);
  });

  it("does not cache a failed loader, allowing a clean retry", async () => {
    const cache = new BoundedCache<string>({
      maxEntries: 2,
      defaultTtlMs: 100,
    });
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("dependency down"))
      .mockResolvedValueOnce("recovered");
    await expect(cache.getOrLoad("key", loader)).rejects.toThrow(
      "dependency down",
    );
    await expect(cache.getOrLoad("key", loader)).resolves.toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
    await expect(cache.getOrLoad("key", loader)).resolves.toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not cache a load invalidated while in flight", async () => {
    const cache = new BoundedCache<string>({ maxEntries: 2, defaultTtlMs: 100 });
    let finish!: (value: string) => void;
    const load = () => new Promise<string>((resolve) => { finish = resolve; });
    const old = cache.getOrLoad("account:one", load);
    await Promise.resolve();
    expect(cache.invalidateWhere((key) => key.startsWith("account:"))).toBe(1);
    await expect(cache.getOrLoad("account:one", async () => "new")).resolves.toBe("new");
    finish("old");
    await expect(old).resolves.toBe("old");
    expect(cache.get("account:one")).toBe("new");
  });

  it("rejects unbounded or invalid configuration", () => {
    expect(() => new BoundedCache({ maxEntries: 0, defaultTtlMs: 1 })).toThrow(
      /maxEntries/,
    );
    expect(
      () =>
        new BoundedCache({
          maxEntries: 1,
          defaultTtlMs: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(/defaultTtlMs/);
  });
});
