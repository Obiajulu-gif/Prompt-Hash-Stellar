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
