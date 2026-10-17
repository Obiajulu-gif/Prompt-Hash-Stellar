# Projection Integrity: Duplicates, Reconciliation, Stale Detection

Covers issues #985 (duplicate detection + merge review), #987 (reconciliation
job) and #1001 (stale-cache / stale-index detection). Implementation:
`server/src/services/projectionIntegrity.ts`; tests:
`server/src/tests/projectionIntegrity.test.ts`.

The module is pure over injected data. It reads nothing and writes nothing by
itself — the caller loads snapshots, persists returned objects, and supplies a
repair sink. No routes, models or migrations were added, so existing public
APIs and schemas are unchanged.

---

## 1. Duplicate detection (#985)

`detectDuplicateCandidates(prompts, { threshold })`

- **exact_hash** — stored `contentHash` equal, or (if absent) SHA-256 of
  whitespace/case-normalized content equal.
- **near_text** — `computeSimilarityScore` (same scorer as
  `similarityDetection.ts`) ≥ threshold (default `HIGHLY_SIMILAR` = 0.90).
  Scores are rounded to 4 dp so float noise cannot flip a result.
- **Determinism** — input is sorted by id, the primary is always the smaller
  id, and `candidateId = sha256(primary|duplicate|reason)[0:24]`. Re-running on
  the same data yields byte-identical output regardless of input order.
- Prompts with `mergedInto` set are excluded.

**Edge cases**

| Case | Behaviour |
|---|---|
| Content edited after detection | Proposal stores `duplicateVersion`; apply fails `STALE_PROPOSAL`. Re-run detection. |
| Short prompts (< 50 chars) | Scorer switches to Levenshtein ratio; very short prompts collide more — raise threshold for those batches. |
| Catalog-wide scan | O(n²). Run per creator/category, or pre-bucket (MinHash/LSH) before calling. |
| Threshold change | Changes candidate set; candidate ids for unchanged pairs stay stable. |
| Primary itself merged later (A→B, then B→C) | Not blocked by `applyMerge` (it only sees the duplicate). Callers must check the primary is live before apply, and resolve alias chains when reading. |

## 2. Merge review workflow (#985)

```
propose ──► approve ──► apply ──► revert
   │
   └──► reject
```

| Step | Function | Guard |
|---|---|---|
| propose | `proposeMerge(candidate, duplicate, actor, now)` | snapshot must match candidate |
| review | `reviewMerge(p, reviewer, "approve"\|"reject", reason, now)` | reviewer ≠ proposer (`SELF_REVIEW`), reason required |
| apply | `applyMerge(p, duplicate, actor, now)` | status `approved`, version unchanged, not already merged |
| revert | `revertMerge(p, duplicate, actor, reason, now)` | status `applied`, duplicate still points at primary |

**What a merge does:** the duplicate becomes a hidden alias
(`visible=false`, `mergedInto=primaryId`, `version+1`). Purchases,
entitlements, on-chain records and payouts are **never moved** — buyers of the
duplicate keep access. That is what makes revert safe.

**Audit:** every transition appends an entry hashed with
`auditTrail.computeRecordHash` (integrity v2) chained via `previousHash`.
`verifyMergeHistory(p)` returns `-1` if intact, the index of the first
tampered entry, or the history length if only `status` was altered. Persist the entries to `AuditLog` (`targetType:
"prompt_merge"`) if you want them in the global chain.

**Failure modes & recovery**

- `STALE_PROPOSAL` — duplicate changed; discard proposal, re-detect, re-propose.
- `NOT_REVERSIBLE` — duplicate was re-merged elsewhere. Revert the later merge
  first (newest first), then this one.
- Persist failed after apply — the returned `duplicate` was not saved: the
  proposal says `applied` but the prompt isn't. Re-run `applyMerge` against the
  stored proposal copy from *before* apply, or run reconciliation (§3) which
  flags the visibility mismatch.
- Caches after apply/revert — call `invalidatePromptCaches(duplicateId)`, or
  let the next reconciliation pass repair it.

## 3. Reconciliation job (#987)

`reconcileProjection(name, kind, source, entries, { now, staleAfterMs? })`
compares source-of-truth `PromptSnapshot`s to a projection
(`search_index` or `cache`). One drift item per id (most severe wins) so
repairs never conflict.

| Drift | Root-cause hint | Repair |
|---|---|---|
| `missing_projection` | create/publish event never reached projection writer (indexer lag, outbox DLQ) | upsert |
| `orphan_projection` | source deleted/merged without cleanup | delete |
| `version_ahead` | source rolled back / restored, or written from another env | **manual** |
| `visibility_mismatch` | unlist/merge/moderation not propagated | upsert or delete |
| `version_behind` | missed/reordered update event | upsert |
| `hash_mismatch` | partial write or non-canonical serialization | upsert |
| `expired` | outlived `staleAfterMs` without refresh (TTL/refresh job stalled) | upsert |

`hash_mismatch` requires the projection's `contentHash` to use the same scheme as the source's stored hash. If the source has no stored hash, the module derives SHA-256 of normalized content; a projection hashed differently will show false `hash_mismatch` drift. Leave the projection's `contentHash` unset until both sides agree.

Every item carries `evidence` (source/projected version and timestamps) and a
`scope` (exact cache keys or index doc id) for operator review.

### Dry-run-first repair

```ts
const report = reconcileProjection("prompt-detail-cache", "cache", source, entries, { now: new Date(), staleAfterMs: 300_000 });
const plan = await repairDrift(report, cacheRepairSink);                  // dry run: nothing written
const done = await repairDrift(report, cacheRepairSink, { apply: true, maxRepairs: 50 });
```

- Default is dry run; `apply: true` must be explicit.
- `maxRepairs` caps blast radius; overflow is **queued** with a reason.
- `manual` items are always queued, never auto-repaired.
- A failing repair lands in `failed[]`; the rest continue.
- `cacheRepairSink` invalidates the scoped keys for both upsert and delete —
  idempotent, next read repopulates from source.

## 4. Stale-cache / stale-index detection (#1001)

Staleness is the subset of drift where the projection lags source:
`version_behind`, `hash_mismatch`, `visibility_mismatch` and (with
`staleAfterMs`) `expired`. Recommendations are the `repair` field; operator
evidence is the `evidence` + `scope` + `hint` triple; the `RepairResult`
splits outcomes into `applied`, `queued` and `failed`.

## Operational edge cases

- **Snapshot skew** — load source and projection as close together as
  possible; an in-flight write can show as `version_behind` for one pass.
  Re-run before escalating; a real lag persists.
- **Clock skew** — `expired` uses `now - projectedAt`; projection writers on a
  skewed clock can look fresh/stale. Prefer version drift over time drift.
- **Redis down** — `cacheDel` is best-effort (logs at debug); repairs report as
  applied but may not have landed. Re-run reconciliation after recovery.
- **Mass drift** (e.g. index rebuilt from an old backup) — do not raise
  `maxRepairs`; use `yarn --cwd server reindex:dry-run` then `reindex`.

## Rollback / recovery

- The module is additive and unreferenced by request paths; reverting the
  commit removes it with no data impact.
- Merges: revert per proposal (newest first). Data is never deleted.
- Cache repairs are invalidations — no rollback needed.
- Index repairs: re-run the full reindex from ledger
  (`yarn --cwd server reindex`) to restore a known-good projection.
