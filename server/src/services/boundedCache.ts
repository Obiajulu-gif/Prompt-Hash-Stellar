export type CacheLookup<T> =
  | { status: "hit"; value: T; ageMs: number }
  | { status: "stale"; value: T; ageMs: number }
  | { status: "miss" };

interface CacheEntry<T> {
  value: T;
  writtenAt: number;
  staleAt: number;
  expiresAt: number;
}

export interface BoundedCacheOptions {
  maxEntries: number;
  defaultTtlMs: number;
  defaultStaleMs?: number;
  now?: () => number;
}

/**
 * Small LRU cache with an entry bound, separate stale/expiry timestamps, and
 * explicit invalidation. `get()` never returns stale data; `inspect()` lets
 * callers observe it for metrics or an intentional stale-while-revalidate flow.
 */
export class BoundedCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly now: () => number;

  constructor(private readonly options: BoundedCacheOptions) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive safe integer");
    }
    if (!Number.isFinite(options.defaultTtlMs) || options.defaultTtlMs <= 0) {
      throw new RangeError("defaultTtlMs must be positive");
    }
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  set(
    key: string,
    value: T,
    ttlMs = this.options.defaultTtlMs,
    staleMs = this.options.defaultStaleMs ?? ttlMs,
  ): void {
    if (!key) throw new TypeError("cache key must not be empty");
    if (
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0 ||
      !Number.isFinite(staleMs) ||
      staleMs < 0
    ) {
      throw new RangeError(
        "cache lifetimes must be finite and ttlMs must be positive",
      );
    }
    this.pending.delete(key);
    const writtenAt = this.now();
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      writtenAt,
      staleAt: writtenAt + Math.min(staleMs, ttlMs),
      expiresAt: writtenAt + ttlMs,
    });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  inspect(key: string): CacheLookup<T> {
    const entry = this.entries.get(key);
    if (!entry) return { status: "miss" };
    const current = this.now();
    if (current >= entry.expiresAt) {
      this.entries.delete(key);
      return { status: "miss" };
    }
    const ageMs = Math.max(0, current - entry.writtenAt);
    if (current >= entry.staleAt)
      return { status: "stale", value: entry.value, ageMs };
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { status: "hit", value: entry.value, ageMs };
  }

  get(key: string): T | undefined {
    const lookup = this.inspect(key);
    return lookup.status === "hit" ? lookup.value : undefined;
  }

  invalidate(key: string): boolean {
    const pending = this.pending.delete(key);
    return this.entries.delete(key) || pending;
  }

  invalidateWhere(predicate: (key: string) => boolean): number {
    let removed = 0;
    for (const key of new Set([...this.entries.keys(), ...this.pending.keys()])) {
      if (predicate(key) && this.invalidate(key)) removed++;
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  async getOrLoad(
    key: string,
    load: () => Promise<T>,
    ttlMs = this.options.defaultTtlMs,
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= this.options.maxEntries) return load();

    const pending = Promise.resolve().then(load);
    this.pending.set(key, pending);
    try {
      const value = await pending;
      if (this.pending.get(key) === pending) this.set(key, value, ttlMs);
      return value;
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }
}
