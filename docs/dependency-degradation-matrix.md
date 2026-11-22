# External Dependency Degradation Matrix

> **Issue**: #980, #1126  
> **Purpose**: Documents every critical third-party dependency's failure modes, user-safe fallback
> behavior, and automated health-check probes.

---

## Overview

When a critical dependency degrades or fails entirely, the system transitions into a documented
fallback state rather than failing unpredictably. This matrix enumerates:

- The **failure mode** (what breaks and how).
- The **user-safe API/UX response** (what the operator should configure/expect the system to do).
- The **user-facing message** (safe to surface in HTTP responses and UI toasts — no internal detail).
- **Recovery steps** an operator follows to restore the service.
- An **automated probe** that can be run to detect the failure mode in CI, health dashboards, or
  scheduled smoke tests.

---

## Dependencies

### 1. Stellar RPC (Soroban)

**Purpose**: Soroban RPC node used to simulate transactions, query on-chain state (`has_access`,
prompt data), and submit `buy_prompt` calls.

| Failure Mode | Severity | Fallback Behavior | User Message |
|---|---|---|---|
| `timeout` | HIGH | Unlock and purchase endpoints return HTTP 503 with `Retry-After` header. No funds moved. | "The Stellar network is taking longer than expected. Your funds are safe — please try again." |
| `connection_refused` | CRITICAL | All on-chain operations blocked. Read-only browsing stays available. | "Prompt purchases are temporarily unavailable. You can still browse." |
| `stale_data` | HIGH | `has_access` deferred to secondary node; stale-ledger overlay shown. | "Your access is being verified against a slightly delayed ledger. This is temporary." |
| `auth_failure` | CRITICAL | Provider rejected our API key (401/403). On-chain operations blocked and never auto-retried; access checks fail closed. | "Prompt purchases are temporarily unavailable. You can still browse the marketplace." |

**Recovery**:
1. Check `https://status.stellar.org`.
2. Rotate `STELLAR_RPC_URL` to a backup node.
3. Re-run: `yarn diagnose stellar-rpc` after fix.

**Probe**: `POST <STELLAR_RPC_URL>` with `{"jsonrpc":"2.0","id":1,"method":"getHealth"}` — healthy
when `result.status === "healthy"`.

---

### 2. Stellar Horizon

**Purpose**: REST API for XLM account balance lookups and transaction polling.

| Failure Mode | Severity | Fallback Behavior | User Message |
|---|---|---|---|
| `timeout` | MEDIUM | Balance pre-check skipped with UI warning; transaction proceeds. | "Balance verification is temporarily unavailable. Your transaction may be rejected if balance is insufficient." |
| `rate_limited` | MEDIUM | Exponential back-off with jitter; requests queued for retry. | "We're experiencing high traffic. Please wait a moment before trying again." |

**Recovery**:
1. Check `https://status.stellar.org`.
2. Switch `STELLAR_HORIZON_URL` to Stellar Foundation fallback.

---

### 3. MongoDB

**Purpose**: Primary database — prompts, purchases, entitlements, audit logs, support cases.

| Failure Mode | Severity | Fallback Behavior | User Message |
|---|---|---|---|
| `connection_refused` | CRITICAL | All write/read API endpoints return 503. CDN-cached static content may remain. | "The marketplace is temporarily unavailable for new transactions." |
| `partial_data` | HIGH | Reads retried against primary; writes queued with idempotency keys. | "Some data may appear outdated while our database synchronises. Actions you've taken are safe." |
| `auth_failure` | CRITICAL | Credentials rejected; handled like `connection_refused` and not auto-retried. | "The marketplace is temporarily unavailable for new transactions." |

**Recovery**:
1. Verify `MONGODB_URI` and VPC connectivity.
2. Check Atlas / replica-set primary status.
3. Restore from backup if needed: `yarn db:restore`.
4. Validate state: `yarn data:integrity:monitor`.

---

### 4. Redis

**Purpose**: Distributed rate-limit counters, idempotency keys, challenge nonces, session caches.

| Failure Mode | Severity | Fallback Behavior | User Message |
|---|---|---|---|
| `connection_refused` | HIGH | In-process rate limiter with conservative limits; nonces stored in-process with shorter TTL. | "Some actions may be temporarily limited while we restore our caching service." |
| `stale_data` | LOW | Cache-miss path fetches from MongoDB; stale nonces rejected, fresh challenge required. | "Please re-initiate the signing process to get a fresh verification token." |

**Recovery**:
1. Check `REDIS_HOST` / `REDIS_PORT` env vars.
2. Verify Redis container/cluster health.
3. In-process fallback is automatic for short outages.

---

### 5. IPFS / Pinata

**Purpose**: Off-chain storage for large encrypted prompt payloads.

| Failure Mode | Severity | Fallback Behavior | User Message |
|---|---|---|---|
| `unavailable` | HIGH | `publish_prompt` / `upload_content` blocked. Existing purchased prompts unaffected. | "Prompt storage is temporarily unavailable. Your existing purchases are unaffected — only new publications are paused." |
| `timeout` | MEDIUM | Up to 3 retries with exponential back-off; MongoDB preview served in place of full payload. | "Loading your prompt content is taking longer than usual. We're retrying automatically." |
| `auth_failure` | HIGH | Pinata JWT rejected; publication blocked and not auto-retried. Existing purchases unaffected. | "Prompt storage is temporarily unavailable. Your existing purchases are unaffected — only new publications are paused." |

**Recovery**:
1. Check `https://status.pinata.cloud`.
2. Switch `IPFS_GATEWAY_URL` to alternative gateway.
3. Retry failed uploads: `yarn jobs:run ipfs-upload-retry`.

---

### 6. Content Safety Scanner

**Purpose**: Automated content-safety pipeline that scans prompt submissions.

| Failure Mode | Severity | Fallback Behavior | User Message |
|---|---|---|---|
| `unavailable` | HIGH | Instant auto-publication blocked; submissions routed to manual-review queue. | "Automated content review is temporarily offline. Your submission has been queued for manual review." |
| `timeout` | MEDIUM | Async analysis queue; creator notified when decision is ready. | "Content review is taking a little longer than usual. We'll notify you when it's complete." |

**Recovery**:
1. Check `SAFETY_SCANNER_HEALTH_URL`.
2. Drain manual queue: `yarn jobs:run manual-review-drain`.
3. Re-scan once recovered: `yarn jobs:run safety-rescan`.

---

## Automated Probes

All probes are implemented in `server/src/services/dependencyDegradationMatrix.ts` and can be
executed programmatically:

```typescript
import { runDegradationMatrixProbes } from "./dependencyDegradationMatrix";

const report = await runDegradationMatrixProbes();
// report.overallHealthy — boolean
// report.degradedDependencies — DependencyName[]
// report.results — ProbeResult[]
```

Tests covering probe logic and matrix structural completeness are in
`server/src/tests/dependencyDegradationMatrix.test.ts`.

---

## Capability Fallback Policy (#1126)

The tables above say what a failure *means*.
`server/src/services/dependencyFallbackPolicy.ts` turns them into behaviour.
`resolveFallbackDecision(capability, states)` is pure and synchronous. It maps
the current dependency states (raw `ProbeResult`s work) to `normal`,
`degraded`, or `blocked` for each user-facing capability:

| Capability | Blocked by | Degraded by |
|---|---|---|
| `browse_catalog` | MongoDB | Redis |
| `purchase_prompt` | Stellar RPC, MongoDB | Horizon (balance pre-check skipped), Redis |
| `unlock_prompt` | Stellar RPC, MongoDB | IPFS (preview served), Redis |
| `publish_prompt` | MongoDB, IPFS | Safety scanner (manual review), Redis |
| `wallet_auth` | — | Redis (in-process nonces) |

A dependency that isn't listed for a capability doesn't affect it. For
example, browsing keeps working while RPC is down.

**Escalation rules**

- `auth_failure` on any dependency a capability uses turns its impact into
  **blocked**. The decision is `retryable: false` and has no `Retry-After`,
  because retrying with rejected credentials cannot succeed.
- **Authorization capabilities fail closed.** For `unlock_prompt` and
  `wallet_auth`, `stale_data` or `partial_data` blocks the request.
  Access is never granted from a stale ledger or a stale nonce.
- When several dependencies fail, blocked wins over degraded, and
  `Retry-After` is the longest value among the blocking failures
  (timeout 5s, partial 10s, stale 15s, refused/rate-limited 30s,
  unavailable 60s).

**Retry within a request.** `executeWithFallback({ capability, states, run, idempotencyKey })`:

- never calls `run` when the capability is blocked (no funds move, nothing is partially written);
- retries `DependencyFailureError`s whose mode is timeout, rate-limited, refused, or partial, with capped exponential backoff (200 ms → 2 s, 3 attempts by default);
- never retries `auth_failure` or non-dependency errors such as validation bugs;
- runs `purchase_prompt`/`publish_prompt` **exactly once unless an idempotency key is supplied**, and passes the same key to every attempt so the backend dedupes.

**HTTP contract.** `requireCapability(capability, source)` is opt-in Express
middleware. A blocked capability gets:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 30

{ "error": "<user-safe message>", "code": "DEPENDENCY_UNAVAILABLE",
  "capability": "purchase_prompt", "retryable": true, "retryAfter": 30 }
```

A degraded request continues with `X-Degraded-Dependencies: stellar_horizon,...`, and
the decision is available on `res.locals.fallbackDecision`. To avoid probing
on every request, wrap the probes in
`createCachedStateSource(() => runDegradationMatrixProbes().then(r => r.results), { ttlMs: 15_000 })`.
Concurrent requests share one refresh. A failed refresh keeps the last known
states, so a broken probe pipeline cannot flap the API.

**Runner hardening.** `runDegradationMatrixProbes(env, matrix?)` takes an
optional matrix, so tests and drills can inject stubs. A probe that throws
is reported as `unavailable` instead of rejecting the whole report.

**Migration / rollout.** Everything is additive. No route uses the middleware
yet, and existing exports and signatures are unchanged (the runner's second
parameter is optional). Adopt it per route, starting with read-only ones:

1. Mount `requireCapability("browse_catalog", source)` and watch the 503 rate.
2. Move purchase/unlock handlers to `executeWithFallback` with the existing idempotency key.
3. Rollback: remove the middleware from the route. Decisions have no state, so there's nothing to clean up.

Tests: `server/src/tests/dependencyFallbackPolicy.test.ts` covers the normal, failure, retry, and authorization paths, plus an exhaustive capability × dependency × failure-mode sweep.

## Operational Edge Cases

| Scenario | Recommended Response |
|---|---|
| Stellar RPC and Horizon both down simultaneously | Block all financial operations; keep browsing available; page on-call immediately (P1). |
| MongoDB primary fails over mid-request | Idempotency keys prevent double-charging; client should retry after 503. |
| Redis flushes during peak traffic | In-process limiter activates; monitor for abuse since limits are local per-instance. |
| IPFS + safety scanner both down | Publication completely blocked; show estimated recovery ETA on creator dashboard. |
| All probes pass but purchases fail | Check on-chain indexer lag (`reconciliationDrift.indexerLagLedgers` in health report). |
| A provider rotates or revokes our key | Probes report `auth_failure`; affected capabilities are blocked with `retryable: false` (no client retry storm). Rotate the credential; the cached state source picks up recovery within its TTL. |
| A probe itself crashes | The runner reports that dependency as `unavailable` and still classifies the rest. |
| Purchase retried without an idempotency key | Executed once only; the client receives the failure and must resubmit with a key. |
| RPC healthy but serving a stale ledger | Purchases continue; unlocks are blocked (fail closed) until the ledger catches up. |

---

## Rollback / Recovery Sequence

1. Run `runDegradationMatrixProbes()` to confirm which dependencies are healthy.
2. For each `degradedDependency`, apply the recovery steps listed above.
3. Re-run probes until `overallHealthy === true`.
4. Run the incident drill: `yarn test:incident-drill` to confirm all verification checks pass.
5. Clear any queued fallback jobs and resume normal operations.
