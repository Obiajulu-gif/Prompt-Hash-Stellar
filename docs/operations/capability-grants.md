# Expiring capability grants (#1171)

A **capability grant** authorizes exactly one sensitive action, on exactly one
resource, for exactly one subject, once, until it expires. It is the narrowest
control in the repository:

| Control | Answers | Lifetime | Reusable |
| --- | --- | --- | --- |
| Wallet session | Who is this wallet? | Session | Yes |
| Step-up verification (`step-up-verification.md`) | Did the wallet prove itself just now? | 5 minutes | Yes (window) |
| Maintainer / support grant | May this operator stand in for a role? | Hours | Yes (scoped) |
| **Capability grant** | **May this subject do this one thing now?** | **≤ 15 minutes** | **No** |

## Lifecycle

```
POST /api/capabilities/grants            (admin: capability:write)
      │  subject + action + resource + reason + ttlMs?
      ▼
  grant issued ──► raw token returned ONCE (only its SHA-256 digest is stored)
      │
      ├─ sensitive route mounts requireCapabilityGrant(action, resource)
      │     ├─ token missing             → 401 CAPABILITY_TOKEN_REQUIRED
      │     ├─ unknown/expired/revoked   → 403 <code>
      │     ├─ subject/action/resource   → 403 <code>
      │     │  mismatch
      │     └─ match                     → consume, then handler runs
      │
      ├─ POST /api/capabilities/grants/:id/revoke   (admin: capability:write)
      └─ GET  /api/capabilities/grants/:id          (admin: capability:read)
```

The raw token travels in `X-Capability-Grant` (or `body.capabilityGrantToken`
for browser flows that cannot set headers). It is never logged, never stored,
and never returned by inspection endpoints.

## Issuance rules

- `subject` and `approver` are required and normalized (trimmed, lower-cased).
- `approver` comes from the **verified admin token** (`req.admin.sub`), never
  from the request body. A subject cannot approve their own grant.
- `action` must be one of `CAPABILITY_ACTIONS`:
  `prompt.delete`, `payout.release`, `admin.impersonate`,
  `webhook.secret.rotate`. New actions require a code change and review.
- `resource` is a single-line identifier (≤ 256 chars). `*` is accepted for a
  grant that deliberately covers any resource of that action; prefer concrete
  resources for destructive actions.
- `reason` must be at least 8 characters (ticket reference recommended).
- `ttlMs` defaults to 2 minutes. Range: 5 seconds – 15 minutes, integer only.

## Failure and retry semantics

- A denial **never consumes** the grant. A caller that presented the wrong
  subject, action or resource may retry with the correct context until the
  grant expires or is used.
- Expiry is checked at the exact boundary: `now >= expiresAt` is expired.
- Check order is revoked → expired → used → subject → action → resource. An
  unusable grant therefore cannot be kept alive by a context match.
- Revocation is idempotent. Revoking again returns `revoked: false` and keeps
  the original `revokedBy`/timestamp.
- A consumed grant is retained for diagnostics until the store evicts it;
  `GET` reports `status: "used"`.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Two requests race for the same token | The check-and-mark is synchronous per process; the first wins, the second gets `already_used` (403). |
| Handler crashes after consumption | The grant is spent. Request a new one; this is intentional. |
| Process restart | Every outstanding grant is dropped (fail closed). Clients must request again. |
| Multiple replicas | The default store is process-local. Issue and consume on the same instance, or inject a shared `CapabilityGrantStore` adapter. Cross-replica issuance is **not** supported by this slice. |
| Store at capacity (default 5,000) | Oldest grant is evicted; its token becomes `not_found`. |
| Expired, unused grants | Removed by `store.pruneExpired(now)`; they are denied before pruning anyway. |
| Token leak in logs | Prevented by design: only `grantId`, action, subject and resource are logged. |
| Body `approver` spoof attempt | Ignored; the verified admin subject is used. |

## Rollback

The feature is additive and has no schema or migration:

1. Unmount `app.use("/api/capabilities", capabilityGrantRouter)` and remove the
   `requireCapabilityGrant` middleware from any sensitive route. Routes revert
   to their previous authorization.
2. Outstanding grants become unreachable (no route consumes them); storage is
   in-memory, so a restart clears them.
3. Deleting the new service/middleware/controller/route files leaves no
   residual state. No existing contract changes: `server.ts` only gains one
   mount line.

If a grant was consumed and the action must be undone, use the action's own
compensating workflow (for example dead-letter replay for webhooks). Capability
grants do not themselves mutate domain state.

## Operational checks

- `grantId` prefix: `capg_`. Token prefix: `cap_` (64 hex chars after it).
- Denials log `capabilityGrantDenied` with a stable `code`; alert on spikes of
  `subject_mismatch` and `already_used`.
- Inspect a grant with `GET /api/capabilities/grants/:grantId` (admin
  `capability:read`) — the response contains no token material.

## Tests

`server/src/tests/capabilityGrants.test.ts` covers the normal path, unknown /
expired / revoked / already-used failures, retry after mismatches, issuance
validation (self-approval, allow-list, TTL bounds), bounded-store eviction,
pruning, middleware 401/403 denials, replay refusal, and admin-only
issuance/revocation.
