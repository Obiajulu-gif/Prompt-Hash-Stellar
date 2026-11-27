# Hidden and archived record authorization

Hidden/restricted records are denied to anonymous users and other strangers with
HTTP 403. Owners and moderator/admin roles may receive the record according to
existing moderation authorization rules. Hidden records must never enter public
search or discovery queries.

Archived records are non-public tombstones. Direct lookup may return a sanitized
tombstone, but search/discovery and purchase/access paths must exclude the
record and must not expose prompt content, encrypted prompts, moderation notes,
or internal lifecycle evidence.

Edge cases and recovery:

- Contradictory stale fields fail closed rather than becoming public.
- Deleted/retired records remain 410 and are not restored by moderation tests.
- Repeated authorization checks are side-effect free and do not mutate records.
- Restore/recovery requires an explicit lifecycle transition back to a published
  state after normal moderation/ownership validation. Cache entries should be
  invalidated before reopening public discovery.
- If a hidden or archived record was cached publicly, evict the cache key and
  repeat the public visibility test before resuming traffic.

No migration or wire-contract change is included; these tests protect existing
visibility semantics.
