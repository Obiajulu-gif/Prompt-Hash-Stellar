# Stale Session and Token Revocation After Security Events (#1031)

Stateless challenge tokens and HMAC bearer sessions protect self-service endpoints (`/api/wallet-session`) and privileged admin tasks (`/api/admin`). However, when security incidents occur—such as compromised wallet private keys, operator token leaks, permission downgrades, or root signing secret rotations—simply waiting for sessions to expire naturally leaves an unacceptable vulnerability window.

The Session Revocation Service (`server/src/services/sessionRevocationService.ts`) provides instantaneous, granular invalidation of stale sessions across both wallet sessions and operator admin tokens.

---

## 1. Revocation Mechanisms

1. **Subject Cutoff (`revokedBefore`)**:
   Sets a millisecond cutoff timestamp for an entity (a Stellar wallet address `G...` or an operator identifier `ops-...`).
   Any session presenting `issuedAt <= revokedBefore` is immediately refused (`401 Unauthorized`).
   New sessions created *after* the security event (with fresh wallet signatures or newly minted credentials) proceed normally.
2. **Specific Token / Nonce Revocation**:
   Revokes an individual token by its unique nonce without invalidating other valid sessions belonging to that actor.
3. **Global Emergency Cutoff (`targetSubject: "*"` )**:
   A global breaker for critical infrastructure events (e.g., suspected server secret leak). All tokens issued prior to the emergency timestamp are severed across the entire marketplace.

---

## 2. Security Event Lifecycle

```mermaid
graph TD
    A["Security Incident (Key Leak, Downgrade, Secret Rotation)"] --> B["Record Security Event via Registry"]
    B --> C["Update In-Memory Cutoff Map & Append to Audit Log"]
    C --> D["Incoming HTTP Request with Bearer Token"]
    D --> E{"IssuedAt <= Cutoff OR Nonce Revoked?"}
    E -- "Yes" --> F["401 Unauthorized (subject_revoked_by_security_event)"]
    E -- "No" --> G["Admit Request"]
```

---

## 3. Integration Points

- **Wallet Sessions (`server/src/middleware/walletSession.ts`)**:
  - `requireWalletSession`: Verifies `globalSessionRevocationRegistry.isRevoked(wallet, payload.issuedAt, payload.nonce)`.
  - `hasFreshWalletSession`: Validates step-up authentication tokens against active revocation cutoffs.
- **Admin Tokens (`server/src/services/adminToken.ts`)**:
  - `verifyAdminToken`: Checks operator subjects against active cutoffs.

---

## 4. Performance & Bounded Storage

- **Time Complexity**: $O(1)$ constant time lookup in hash maps during request authentication.
- **Space Complexity**: $O(M)$ bounded memory. Revocation records are automatically pruned after `MAX_REVOCATION_RETENTION_MS` (2 hours). Because tokens have a maximum TTL (e.g. 30–60 minutes), any token issued before an expired cutoff has already expired naturally, preventing memory leaks.

---

## 5. Operational Recovery & Rollback

- **False Alarm Recovery (`reinstateSubject`)**:
  If a security alert is verified as a false positive, authorized operators (`admin` or `security:revoke`) can call `reinstateSubject(subject, actor, reason)`. The subject's cutoff is removed, immediately restoring valid access and recording an audit trail entry.
- **Audit Logging**:
  All security events and reinstatements are logged in the immutable security audit log (`getAuditTrail()`).

---

## 6. Security Event Policy and User Messaging (#908)

`SECURITY_EVENT_POLICY` in `sessionRevocationService.ts` says which events end
sessions, and how far:

| Event | Scope | When to use |
| --- | --- | --- |
| `credential_change` | Subject | Password or key changed |
| `role_change` | Subject | Role or permission level changed for the account |
| `account_recovery` | Subject | Recovery flow completed |
| `explicit_logout_all` | Subject | User asked to sign out everywhere |
| `wallet_compromise`, `suspicious_activity`, `permission_revocation`, `admin_key_rotation` | Subject | As named |
| `global_emergency_cutoff` | Global (`*`) | Platform-wide secret rotation only |

Call `invalidateSessionsForSecurityEvent(registry, input)` in the same request
that changes the credential, role or recovery state. It enforces the scope: a
subject event must name one account, and a global event must target `*`.

**User messages.** A rejected session gets `401` with `error` (a user-safe
message from the event policy) and `code`. The internal `reason` is never
returned to the client. Operators read it from the registry status and the
audit trail.

**Unaffected sessions.** Subject events only cut off that account. Other
accounts' sessions keep working, and sessions issued after the event sign in
normally.

---

## 7. Admin HTTP Endpoints

Mounted under `/api/admin/security-events` (`server/src/routes/securityEventRoutes.ts`):

| Method | Path | Required Scope | Description |
| --- | --- | --- | --- |
| `POST` | `/api/admin/security-events/invalidate` | `security:revoke` | Record a security event (`{ type, subject, reason, metadata? }`) and invalidate matching sessions. |
| `POST` | `/api/admin/security-events/reinstate` | `security:revoke` | Roll back a subject or global (`*`) revocation after a verified false alarm (`{ subject, reason }`). |
| `GET` | `/api/admin/security-events/status/:subject` | `security:read` | Inspect current revocation status for a Stellar address, operator ID, or `*`. |
| `GET` | `/api/admin/security-events/audit` | `security:read` | Retrieve the immutable in-memory security event audit trail (filterable by `type`, `subject`, `limit`). |

---

## 8. Edge Cases, Retry Semantics & Rollback Behavior

- **Monotonic Idempotent Retries**: Duplicate or retried revocation calls for the same subject or global cutoff compute `Math.max(existingCutoff, newCutoff)`, ensuring an out-of-order retry with an older timestamp never weakens an active security cutoff while preserving every attempt in the audit trail.
- **Boundary Timestamps**: Tokens with `issuedAt <= revokedBefore` are rejected; tokens minted at `revokedBefore + 1` or later are admitted. Future cutoffs beyond a 60-second clock-skew tolerance (`now + 60_000`) are rejected with `invalid_timestamp`.
- **Case & Format Normalization**: Valid base32 Stellar addresses (`^G[A-Z2-7]{55}$`) are normalized to uppercase; operator handles are trimmed and lowercased so mixed-case inputs never bypass cutoffs.
- **Precedence Order**: Global emergency cutoffs (`global_security_event`) are evaluated before subject cutoffs (`subject_revoked_by_security_event`), which are evaluated before individual token nonces (`token_nonce_revoked`).
- **Rollback / False-Alarm Recovery**: Calling `POST /api/admin/security-events/reinstate` (or `registry.reinstateSubject`) removes the active cutoff immediately while keeping historical revocation records intact in the audit trail.
