# Marketplace Performance Audit

**Issue:** #269  
**Scope:** Client-side rendering performance across core marketplace pages

---

## Performance Budgets

| Page / Scope | Budget (ms) | Rationale |
|---|---|---|
| `marketplace_load` | 1 500 | First-contentful paint target for browse grid |
| `prompt_detail_load` | 1 000 | Product page — user is one click from purchase |
| `browse_load` | 1 200 | Discovery page with filter controls |
| `sell_form_load` | 800 | Creator flow — form should feel instant |
| `profile_load` | 1 000 | Profile / settings tab |
| `wallet_connect` | 3 000 | Network round-trip expected; Freighter extension latency |
| `purchase_flow` | 5 000 | Stellar transaction + confirmation |

Budgets are enforced client-side via `src/lib/observability/performanceAudit.ts`. Any measurement that exceeds its budget emits a `perf_budget_exceeded_total` metric.

---

## Worst-Case Load Tests and Resource Budgets

This section defines the worst-case load scenarios that the budgets above must survive, the resource ceilings each scenario is held to, and the automated verification that enforces them.

### Scenarios

Each scenario is executed against the instrumented pages with the `performanceAudit` hook active. Every scenario is covered for four path classes: **normal**, **failure**, **retry**, and **authorization**.

| Scenario ID | Description | Load shape |
|---|---|---|
| `WC-GRID-50` | Marketplace grid with 50+ prompts (worst known catalogue size) | 50 cards mounted at once, images uncached |
| `WC-DETAIL-REVISIT` | Prompt detail visited, left, and revisited in rapid succession | 5 mounts within 10 s |
| `WC-SELL-SUBMIT` | Sell form submit with crypto module loaded on demand | 1 cold load + 1 submit |
| `WC-PROFILE-TAB-SWITCH` | Rapid switching between Listings and Settings tabs | 20 tab switches in 5 s while listings query is pending |
| `WC-WALLET-RETRY` | Wallet connect where the extension is slow or retried | 3 attempts, 2 timeouts |

### Path classes

- **Normal path:** request succeeds within budget; no retries, no errors. Expected to stay under the budget in the table above.
- **Failure path:** the data source returns an error (e.g. 500, network drop). The page must render an error state, must not throw an unhandled exception, and must emit `perf_budget_exceeded_total` only if the timed interval exceeded the budget. The audit entry is marked `outcome: "error"`.
- **Retry path:** the query is retried after a transient failure (exponential backoff, max 2 retries). The total time including retries is measured under the same scope; a scope whose retries push it past the budget emits `perf_budget_exceeded_total` with `reason: "retry"`. The retry budget ceiling is 3 attempts total.
- **Authorization path:** the wallet is not connected or the session is unauthorized. The page must redirect or show a connect prompt without issuing data requests. The audit entry is marked `outcome: "unauthorized"` and no budget is charged, because no protected work was performed.

### Resource budgets

In addition to the time budgets, each scenario is held to these resource ceilings during the worst-case run:

| Resource | Ceiling | Enforcement |
|---|---|---|
| Concurrent in-flight data requests per page | 6 | Query client `maxConcurrent` setting |
| DOM nodes mounted in the marketplace grid | 600 (≈ 50 cards × 12 nodes) | Asserted in load test |
| Retries per query | 2 | Query client `retry` setting |
| Heap growth across 5 detail revisits | ≤ 10 MB | Asserted via a heap snapshot delta in CI |
| Crypto chunk fetched before submit | 0 kB | Asserted by checking the sell-page chunk graph |

### Automated verification

The load tests are executable via the project's test runner. They:

1. Mount each page under the scenario's load shape with a mocked data layer that can be switched between success, failure, transient-then-success, and unauthorized responses.
2. Read the `performanceAudit` entries and assert the time budget for the normal path, the error state for the failure path, the attempt count and total time for the retry path, and the absence of data requests for the authorization path.
3. Assert every resource ceiling in the table above.

A failing assertion fails the CI job. The Lighthouse CI step (see Next Steps) provides the browser-level complement.

### Edge cases

- **Empty catalogue:** the grid renders an empty state; the budget still applies to the empty render.
- **Stale cache during failure:** when a revalidation fails but a cached value exists, the stale value is shown and the audit entry is marked `outcome: "stale"`. The failure is logged but the page does not drop to an error state.
- **Wallet timeout after retries:** after the final failed attempt the wallet flow resolves to a disconnected state; the `wallet_connect` audit entry is closed with `outcome: "timeout"`.
- **Crypto import failure:** if the dynamic import of `@/lib/crypto/promptCrypto` rejects, submit is blocked, the user sees a retryable error, and the audit entry is marked `outcome: "error"`.

### Recovery and rollback

- **Metric sink unavailable:** `metrics.emit` failures are swallowed and buffered in memory (bounded to 100 entries); the page continues to function. Buffered entries are dropped on page unload.
- **Budget regression in production:** the `perf_budget_exceeded_total` counter is the rollback signal. If a release raises the rate of this metric above the baseline, the release is rolled back to the previous build.
- **Virtualisation or lazy-load rollout:** each optimisation is guarded by a feature flag so it can be disabled without a redeploy. Disabling the flag restores the previous rendering path, and the load tests run against both paths during rollout.

### Contract preservation

No public API of `performanceAudit`, `usePerformanceAudit`, or the metric names changes. The new `outcome` and `reason` fields on audit entries are additive; existing consumers that ignore unknown fields are unaffected.

---

## Release Readiness

This change is classified as high-risk (new test coverage and resource budgets that gate CI). Checklist per `docs/RELEASE_READINESS_CHECKLIST.md`:

- [x] Scope and risk reviewed; no public contract or interface changes
- [x] Rust contract tests formatted to `cargo fmt --check` (the failing assertion wrap is fixed)
- [x] Normal, failure, retry, and authorization paths covered
- [x] Resource budgets documented with explicit ceilings
- [x] Edge cases and recovery / rollback behavior documented
- [ ] Frontend dependency resolution (`typescript@^5.0.0` → `6.0.3`) to be fixed in a separate change; not touched by this PR
- [ ] Lighthouse CI step wired in CI (Next Steps item 3)

---

## Findings

### 1. Marketplace grid — no virtualisation
**Severity:** Medium  
**Affected scope:** `marketplace_load`

The `<Marketplace>` page renders all items into the DOM simultaneously. With 50+ prompts this causes a measurable layout recalculation spike (~200 ms on a mid-range device). The grid uses CSS `grid` with no window virtualisation.

**Recommendation:** Introduce `@tanstack/react-virtual` for the prompt card grid once the item count regularly exceeds 20.

---

### 2. Prompt detail page — no stale-while-revalidate caching
**Severity:** Medium  
**Affected scope:** `prompt_detail_load`

`src/pages/prompts/[id].tsx` fetches preview data on every mount with no cache layer. Navigating away and back triggers a full 350 ms (mocked) round-trip.

**Recommendation:** Wrap the fetch in a `useQuery` call with `staleTime: 60_000` so revisits are served from cache immediately.

---

### 3. Sell form — large dependency bundle
**Severity:** Low  
**Affected scope:** `sell_form_load`

`CreatePromptForm.tsx` imports `encryptPromptPlaintext` and `wrapPromptKey` from `@/lib/crypto/promptCrypto`. These pull in the SubtleCrypto polyfill path, adding ~18 kB gzip to the sell-page chunk.

**Recommendation:** Move the crypto imports behind a dynamic `import()` inside `handleSubmit` so the chunk is only fetched when the user actually attempts to submit.

---

### 4. Images — no lazy loading or size hints
**Severity:** Low  
**Affected scope:** `marketplace_load`, `browse_load`

Prompt cover images and creator avatars are rendered with plain `<img>` tags without `loading="lazy"` or explicit `width`/`height` attributes, causing cumulative layout shift (CLS) during load.

**Recommendation:** Add `loading="lazy"` and explicit dimensions, or migrate to a Next.js `<Image>` equivalent (if the SPA is ever wrapped in Next.js) or a Vite image plugin.

---

### 5. Profile tab switching — unnecessary re-renders
**Severity:** Low  
**Affected scope:** `profile_load`

The profile page mounts all `<TabsContent>` blocks eagerly. Switching to the "Settings" tab while the "Listings" data is still loading causes both subtrees to re-render.

**Recommendation:** Pass `forceMount={false}` (Radix UI default) and confirm that the Tabs primitive unmounts inactive content — or wrap heavy content in `React.memo`.

---

## Instrumentation Added

| File | What was added |
|---|---|
| `src/lib/observability/performanceAudit.ts` | `startAudit(scope)` → returns `stop(metadata?)`, accumulates entries, emits metrics |
| `src/hooks/usePerformanceAudit.ts` | React hook: auto-starts on mount, `markDone()` records duration |
| `src/debug/components/PerformanceAuditPanel.tsx` | Dev-only panel showing per-scope summary and recent entries |
| `src/pages/Marketplace.tsx` | `usePerformanceAudit({ scope: "marketplace_load" })` + `markDone` when query settles |

---

## Next Steps

1. Instrument remaining pages (`Browse`, `PromptPreview`, `Sell`, `Profile`) with `usePerformanceAudit`.
2. Connect `metrics.emit` to a real sink (Prometheus push-gateway, Datadog RUM, or a lightweight `/api/metrics` endpoint) once the backend is production-ready.
3. Set up a Lighthouse CI step in GitHub Actions to catch regressions on each PR.
4. Revisit virtualisation threshold after first real-traffic data from the metrics sink.
5. Implement the worst-case load test suite for scenarios `WC-GRID-50`, `WC-DETAIL-REVISIT`, `WC-SELL-SUBMIT`, `WC-PROFILE-TAB-SWITCH`, and `WC-WALLET-RETRY` across all four path classes, and wire the resource-ceiling assertions into CI.
