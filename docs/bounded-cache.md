# Bounded Cache and Invalidation

`BoundedCache` is the process-local fallback used when Redis is unavailable. It is an LRU cache capped by `LOCAL_CACHE_MAX_ENTRIES` (default 500), with independent stale and expiry timestamps. The existing async cache API remains unchanged: callers still receive a value or `null`.

## Behavior

- Fresh entries are returned and promoted to most-recently-used.
- At capacity, the least-recently-used entry is evicted before the bound can be exceeded.
- Stale entries are observable through `inspectLocalCache()` but are never returned by `cacheGet()`.
- Exact deletes and pattern invalidation update both Redis and the local cache.
- Failed loads are not cached, so a later request can retry normally.
- `entitlement:*` authorization decisions never use the process-local fallback. During Redis failure they miss and the caller must re-check the ledger; this prevents a stale allow decision on a replica that missed an invalidation.

## Operations and recovery

Redis remains the shared source for cache entries across replicas. The local cache only reduces read degradation during a Redis outage and should not be sized as a data store. Monitor Redis errors, local stale observations, and eviction rate; sustained high eviction means the bound is too small or keys have excessive cardinality.

Invalidation is best-effort caching behavior: the database/ledger remains authoritative. Settlement and prompt-update handlers explicitly invalidate prompt, listing, search, and entitlement keys. If invalidation is suspected, restart replicas or call the existing prompt invalidation path; never delete authoritative records.

Rollback is configuration-first: set `LOCAL_CACHE_MAX_ENTRIES=1` to effectively disable useful local retention while retaining the same API, then revert the fallback integration if necessary. A rollback may increase dependency traffic but does not require a data migration and does not change Redis keys or response contracts.

Invalidation also detaches in-flight loads. The waiting caller can finish, but its result cannot repopulate the cache after invalidation. A subsequent read starts a fresh load. When the cache is already tracking its maximum number of loads, additional misses fetch directly without populating the cache.
