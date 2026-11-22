# Public health endpoint with dependency-aware status (#1027)

The legacy `GET /health` always answers `"ok"`, even when MongoDB is down, so
load balancers and status pages cannot tell a broken replica from a healthy
one. The `/api/health` endpoints check each dependency and only report what is
safe to publish.

Code: `server/src/services/publicHealth.ts`, `server/src/routes/healthRoutes.ts`.
The deployed serverless endpoint (`api/health.ts`, #1179) shares the same
monitor: it keeps the legacy `timestamp`, `uptime`, `indexer` and `"ok"`
fields and adds `checkedAt`, `cached` and the redacted `dependencies` list.
Previously it answered `"ok"` unconditionally, even with MongoDB down.

## Endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health/live` | public | Liveness. Never touches a dependency, so it is safe as a container liveness probe. |
| `GET /api/health` | public | Readiness, with redacted per-dependency status. Use as the load-balancer and status-page probe. |
| `GET /api/health/details` | `health:read` | Full report: raw error detail, attempts, observed values. `?refresh=true` bypasses the cache. |

`GET /health` is unchanged for existing consumers.

### Response (`/api/health`)

```json
{
  "status": "degraded",
  "checkedAt": "2026-10-19T17:00:00.000Z",
  "cached": false,
  "dependencies": [
    { "name": "database", "status": "up", "critical": true, "latencyMs": 3 },
    { "name": "indexer", "status": "degraded", "critical": false, "latencyMs": 4, "reason": "unhealthy" },
    { "name": "stellar_rpc", "status": "down", "critical": false, "latencyMs": 2003, "reason": "timeout" }
  ]
}
```

`reason` is one of `timeout | unreachable | http_error | unhealthy |
check_failed`; the same codes as [public-status.md](../public-status.md).
Raw error text (hostnames, IPs, connection strings) is never published.

## Dependencies and status rules

| Dependency | Critical | up | degraded | down |
| --- | --- | --- | --- | --- |
| `database` | yes | connected and `ping` answers | — | disconnected, ping fails or times out |
| `indexer` | no | checkpoint touched within 60 s | 60 s – 10 min, or no checkpoint yet | older than 10 min |
| `stellar_rpc` | no | `getHealth` → `healthy` | any other RPC status | HTTP error, unreachable, timeout |

`stellar_rpc` is only checked when `STELLAR_RPC_URL` or
`PUBLIC_STELLAR_RPC_URL` is set.

Overall status:

- `down` (HTTP **503**, `Retry-After: 30`): a critical dependency is down.
- `degraded` (HTTP 200): a non-critical dependency is down, or any dependency
  is degraded. The API still serves, possibly with stale marketplace data.
- `ok` (HTTP 200): everything is up.

## Retry, timeout and caching

- Each check has a 2 s timeout, so a hung dependency cannot hang the endpoint.
- A `down` result or an error is retried once after 150 ms. One dropped packet
  does not flip the service to `down`. A `degraded` answer is real and is not
  retried.
- Results are cached for `HEALTH_CACHE_TTL_MS` (default 10 s), and concurrent
  evaluations share one in-flight probe round. Public callers can never force
  a refresh, so hammering `/api/health` causes at most one probe round per TTL
  against MongoDB and the RPC. Only `health:read` admins can pass
  `?refresh=true`.
- Every response carries `Cache-Control: no-store` so CDNs do not pin a stale
  status.

## Operational edge cases

- **Recovery shows up after at most one TTL.** After fixing a dependency,
  either wait `HEALTH_CACHE_TTL_MS` or call
  `/api/health/details?refresh=true` to update the cached view immediately.
- **Indexer with no new events:** the indexer renews its lease on every poll,
  which bumps the checkpoint's `updatedAt`. A quiet chain therefore still
  reads as `up`. A stopped indexer degrades after 60 s.
- **Fresh deploy:** until the indexer writes its first checkpoint, `indexer`
  is `degraded` with reason `unhealthy`. This is expected on an empty
  database.
- **Probe choice:** point container liveness at `/api/health/live` and
  readiness/LB at `/api/health`. Pointing liveness at `/api/health` would
  restart healthy replicas during a database outage.

## Public status page (#1179)

The user-facing status page (`/status`) renders the same readiness view in a
"Dependencies" section. Code:
`src/components/status/DependencyHealthPanel.tsx` and
`src/lib/health/dependencyHealth.ts`.

- It reads `GET /api/health` with `credentials: "omit"` and
  `cache: "no-store"`. The endpoint is public, so the page never attaches a
  wallet session, cookie, or admin token.
- Only documented fields are rendered: dependency `name`, `status`,
  `critical`, `latencyMs`, and a known `reason` code. Raw `detail`,
  `observed`, and any newly added server fields are discarded by
  `normalizeDependencyHealth`, so expanding the server payload cannot leak
  internals into the browser.
- The panel does not change the `GET /api/status` contract used by the rest of
the page; the two sections are independent.

### Edge cases

| Case | Behaviour |
| --- | --- |
| `503` with `Retry-After` | Shows the critical-outage headline and retries automatically after the header delay (0–60 s). Missing or invalid header → 30 s. |
| Critical dependency recovers | Next successful poll (or "Refresh dependencies") shows `ok`; the server cache can delay it by up to `HEALTH_CACHE_TTL_MS`. |
| Network error / unparsable body | Shows a recoverable error with a "Retry now" button; never crashes the status page. |
| Legacy deployment | A payload without a `dependencies` array is shown as "This deployment does not report dependency-level health" rather than falsely `ok`. |
| Malformed dependency entry | The entry is dropped; the rest of the list still renders. |
| Unknown status or reason | Unknown entries are dropped and unknown reasons omitted, so a future server value cannot inject text. |
| Slow dependency | `latencyMs` is displayed, and the shared 2 s timeout/retry in the endpoint prevents a hung check from blocking the page. |

### Recovery and rollback

- **Recovery:** after the dependency is fixed, no manual action is needed. The
  panel auto-retries during an outage and otherwise re-renders on its next
  fetch; use "Refresh dependencies" for an immediate read. An operator can
  also force the server cache with `/api/health/details?refresh=true`.
- **Rollback:** remove `<DependencyHealthPanel />` from
  `src/pages/status/page.tsx`. The endpoint, its cache, and the rest of the
  status page are untouched, and no data migration is involved. Alternately,
  keep the panel and revert only `normalizeDependencyHealth`; the panel already
  degrades safely when the endpoint is missing.

## Tuning and rollback

| Variable | Default | Meaning |
| --- | --- | --- |
| `HEALTH_CACHE_TTL_MS` | `10000` | Report cache lifetime |
| `HEALTH_INDEXER_DEGRADED_AFTER_MS` | `60000` | Checkpoint age before `indexer` degrades |
| `HEALTH_INDEXER_DOWN_AFTER_MS` | `600000` | Checkpoint age before `indexer` is down |

The routes are additive. To roll back the Express endpoints, point probes back
at `/health` (unchanged) or revert the route mount in `server/src/server.ts`.
To roll back the serverless endpoint, restore the previous `api/health.ts`
handler; consumers that only read `status`, `timestamp`, `uptime` or `indexer`
see no difference because those fields are preserved. To roll back the public
page, remove `<DependencyHealthPanel />` from
`src/pages/status/page.tsx`. No data is written and no migration is required.

### Contract and migration note (#1179)

`GET /api/health` is additive but its status code is not: a critical
dependency being down now returns **503** instead of a hard-coded **200**.
- Consumers that treat non-2xx as "unhealthy" need no change.
- Consumers that only check the body should keep reading `status` (`ok`,
  `degraded`, `down`) and may ignore `dependencies`.
- Uptime monitors pointed at `/api/health` now correctly mark a database
  outage; monitors that must never see 503 (for example a liveness probe)
  should use `/api/health/live`.
- The `"ok"` value is still returned when every dependency is up, so existing
  string comparisons against `"ok"` continue to pass.
