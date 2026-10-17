# Deterministic Lifecycle Analytics (Conversion and Drop-off)

Shows maintainers where users **start, abandon, recover and complete** the two
revenue-critical workflows, without exposing any individual user.

Code:
- `src/lib/analytics/lifecycleStages.ts` — stages, capture points, failure-reason allow-list (browser-safe)
- `src/lib/analytics/lifecycleAnalytics.ts` — normalisation, hashing, deterministic aggregation
- `src/lib/analytics/lifecycleClient.ts` — `trackLifecycle()` browser capture
- `server/src/models/LifecycleEvent.ts`, `server/src/routes/lifecycleAnalyticsRoutes.ts` — ingest + admin report

Tests: `src/test/lifecycleAnalytics.test.ts` (fixture-based, exact numbers),
`src/test/lifecycleClient.test.ts`. Fixture and hand-derived golden values:
`src/test/fixtures/lifecycleEvents.ts`.

## Lifecycle stages and capture points

Each workflow is an ordered list; reaching the last stage = **completed**.
An event is `reached` (got to the stage) or `failed` (an attempt at that stage
failed, with an allow-listed reason).

**purchase** (buyer purchase and unlock)

| # | Stage | Emitted from |
| - | ----- | ------------ |
| 1 | `detail_viewed` | `PromptModal.tsx` — modal opens |
| 2 | `purchase_started` | `PromptModal.tsx` — `runPurchase` begins; `failed` in its `onError` |
| 3 | `payment_confirmed` | `PromptModal.tsx` — `runPurchase` `onSuccess` |
| 4 | `unlock_succeeded` | `PromptModal.tsx` — `runUnlock` `onSuccess`; `failed` in its `onError` |

**publish** (creator publishing)

| # | Stage | Emitted from |
| - | ----- | ------------ |
| 1 | `form_opened` | `CreatePromptForm.tsx` — form mounts |
| 2 | `publish_submitted` | `CreatePromptForm.tsx` — passes the guards; `failed` for offline / wallet / session / payout guards |
| 3 | `publish_confirmed` | `CreatePromptForm.tsx` — `createPrompt` success; `failed` when unconfirmed or thrown |

Adding a stage or workflow = edit `LIFECYCLE_WORKFLOWS` (one place); the
client, server and analysis all validate against it.

## Metrics

Per workflow: `started`, `completed`, `abandoned`, `inProgress`,
`completionRate`, `abandonRate`, `journeysWithFailure`, `recovered`,
`recoveryRate`, `medianMsToComplete`, `gapJourneys`.

Per stage: `reached`, `reachedRate`, `conversionFromPrevious`,
`abandonedHere`, `dropOffRate`, `failedAttempts`, `topFailureReasons`,
`medianMsFromPrevious`.

**Drop-off stages are identifiable:** `primaryDropOff` is the stage with the
highest `dropOffRate` (abandoned-here / reached); `dropOffStages` lists every
stage at or above `dropOffThreshold` (default 25%), worst first.

Definitions (all deterministic):
- A **journey** is one hashed session in one workflow.
- **Abandoned:** not completed and idle ≥ `abandonAfterMs` (default 30 min)
  at report time; otherwise **in progress**. Boundary is inclusive.
- **Furthest stage** = highest `reached` stage. A `failed` attempt at stage *i*
  proves stage *i−1* was reached, so a buyer who paid but whose unlock failed
  counts as a drop-off at `payment_confirmed`.
- **Recovered:** had ≥ 1 `failed` event and still completed afterwards.
- **Gap journey:** skipped an earlier stage (lost/blocked event); counted for
  data-quality monitoring, still included in the funnel.

Determinism guarantees: no clock reads (`asOf` is an input), no randomness,
stable ordering (input order does not matter), events are de-duplicated
(retried beacons are idempotent), and future-dated events (> `asOf` + 5 min)
are rejected and counted in `quality.rejected`.

## Privacy: aggregation and redaction

- **No identifiers in output.** Sessions are HMAC-SHA256 hashed with
  `LIFECYCLE_ANALYTICS_SALT` (≥ 16 chars) at ingest; the client sends a random
  per-tab session id, **never a wallet address**, email or IP. Reports contain
  only counts, rates and medians.
- **Minimum cohort (k-anonymity):** any count of 1…k−1 (default **k = 5**,
  the admin endpoint never goes below 5) is returned as `null`, as is every
  rate derived from it and medians based on fewer than k journeys. Rare
  failure reasons (< k) are folded away rather than listed.
- **Optional rounding:** `roundTo=5` rounds published counts, and rates are
  computed from the rounded values so rounding cannot be undone by dividing.
- **Allow-listed vocabulary:** stages and failure reasons come from fixed
  lists; free text (which could contain addresses or amounts) becomes `other`.
- **Server clock only:** client timestamps are ignored; no per-user timeline is
  stored or returned.
- **Retention:** `LifecycleEvent` has a 90-day TTL index (see
  `data-retention-policy.md`).
- **Honours opt-out:** the tracker is a no-op with Do Not Track or
  `VITE_LIFECYCLE_ANALYTICS=off`.

## API and configuration

| | |
| --- | --- |
| `POST /api/analytics/lifecycle` | `{ sessionId, workflow, stage, kind?, reason? }` → `204`. Rate limited (120/min/client). `400` only for malformed events. |
| `GET /api/admin/lifecycle-analytics?days=7&minCohort=5&roundTo=1` | Admin scope `analytics:read`. `days` 1–90. |
| `LIFECYCLE_ANALYTICS_SALT` | Required (≥ 16 chars). Without it capture returns `204` and stores nothing. |
| `LIFECYCLE_ANALYTICS=off` | Server-side kill switch (capture becomes a no-op). |
| `VITE_LIFECYCLE_ANALYTICS=off` | Client-side kill switch. |

## Edge cases and failure modes

- **Analytics never breaks the product.** Capture never throws, never blocks,
  and the endpoint answers `204` even when the database is down (events are
  dropped, not retried).
- **Lost events** (ad blockers, `keepalive` limits, reloads): the funnel is
  built from *furthest stage*, so a missing middle event does not undercount
  later stages; it surfaces in `gapJourneys`. Absolute numbers are a lower
  bound, so read **rates and trends**, not totals.
- **Reloads/new tabs** start a new session id, so one person can appear as
  two journeys (one abandoned, one completed). Treat `abandonRate` as an upper
  bound.
- **Rotating `LIFECYCLE_ANALYTICS_SALT`** splits journeys that span the
  rotation and makes old hashes unjoinable. This is a privacy feature; rotate
  at a quiet time and ignore the first report window.
- **Small deployments:** with fewer than 5 journeys per cell most drop-off
  numbers are `null` by design. Increase `days` rather than lowering `k`.
- **Differencing:** published `reached` counts can still be subtracted to
  infer small drop-offs; use `roundTo` for stricter protection.
- **Report cap:** the admin report reads at most 500 000 events for the
  window; narrow `days` on very large deployments.
- **Late events** (a user finishing after `asOf`) re-classify an abandoned
  journey as completed on the next run — numbers for recent windows can move.
- **Clock skew:** only server timestamps are used; analysis `asOf` is the
  server clock.

## Rollback and recovery

1. **Stop collection immediately:** set `LIFECYCLE_ANALYTICS=off` (server) and
   `VITE_LIFECYCLE_ANALYTICS=off` (client build). No data migration is needed.
2. **Remove data:** drop the `lifecycleevents` collection (or wait for the
   90-day TTL). Nothing else references it.
3. **Bad report / bug in the aggregation:** the analysis is a pure function of
   stored events, so fixing the code and re-running the report gives
   corrected history; nothing needs backfilling.
4. **Bad event vocabulary** (a renamed stage): old events with the retired
   stage are rejected as `unknown_stage` and counted in `quality.rejected`;
   keep the old id in `LIFECYCLE_WORKFLOWS` until its events age out.
5. **Revert the instrumentation:** the capture calls are single `trackLifecycle`
   lines in `PromptModal.tsx` and `CreatePromptForm.tsx`; removing them has no
   effect on product behaviour.
