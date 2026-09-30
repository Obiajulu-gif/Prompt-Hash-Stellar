# Security Policy

## Reporting a Vulnerability

Please reach out to the team using GitHub's own security mechanism to submit an anonymous report.

---

# PromptHash Soroban Contract - Threat Model & Security Review

## 1. Threat Model Overview

### Actors

| Actor             | Capabilities                                         | Trust Level    |
| ----------------- | ---------------------------------------------------- | -------------- |
| Admin             | Set fee %, fee wallet, upgrade contract              | Highly Trusted |
| Creator           | Create prompts, modify own prompts, set price/status | Trusted        |
| Buyer             | Purchase prompts, access purchased content           | Semi-Trusted   |
| Off-chain Service | Index events, track unlocks                          | Semi-Trusted   |
| Malicious Caller  | Attempt exploits, griefing                           | Untrusted      |

## 2. Identified Risks & Mitigations

### Risk 1: Reentrancy in Purchase Flow

**Severity:** High  
**Vector:** `buy_prompt` performs two token transfers sequentially
**Mitigation:** Implement non-reentrant guard (State::DuringPurchase variant)

### Risk 2: Prompt ID Enumeration

**Severity:** Medium
**Vector:** Sequential prompt IDs allow enumeration
**Mitigation:** Use random/pseudorandom IDs (deferred, documented)

### Risk 3: Storage Growth DoS

**Severity:** Medium
**Vector:** No limits on purchases per prompt
**Mitigation:** Add max purchases cap in Prompt struct

### Risk 4: Fee Percentage Race Condition

**Severity:** Low
**Vector:** Fee can be changed during ongoing purchase
**Mitigation:** Snapshots fee at purchase start

### Risk 5: Upgrade Without Timelock

**Severity:** High
**Vector:** Immediate upgrade possible by admin
**Mitigation:** Document as known risk, consider timelock (deferred)

### Risk 6: Missing Prompt Existence Check

**Severity:** Medium
**Vector:** Operations on non-existent prompts return NotFound
**Mitigation:** Already handled via require_prompt()

### Risk 7: Arithmetic Overflow in Sales Count

**Severity:** Low
**Vector:** sales_count is u32, could overflow ~4B sales
**Mitigation:** Change to u64

### Risk 8: Fee Validation on Set

**Severity:** Low
**Vector:** Fee is validated (<= MAX_BPS), good
**Mitigation:** None needed

## 3. Security Fixes Applied

1. Added reentrancy guard to prevent double-spend during buy_prompt
2. Added max purchases limit to prevent storage spam
3. Changed sales_count to u64 to prevent overflow
4. Snapshotted fee percentage at purchase start
5. Added additional overflow checks in arithmetic paths
6. Backup SHA-256 Checksum Validation & Integrity Protection (#607): Added SHA-256 manifest generation and pre-restore integrity validation (checksum & NDJSON line validation) with dry-run support to prevent corrupted data injection. See [Disaster Recovery Runbook](docs/operations/disaster-recovery.md).

## 4. Deferred Risks (Future Work)

- Prompt enumeration protection (requires UX changes)
- Upgrade timelock (requires governance)
- Rate limiting on create_prompt (requires additional research)

## 5. Acceptance Criteria Status

- [x] Written threat model exists
- [x] Security findings fixed or documented
- [x] Purchase, entitlement, admin fee, fee wallet covered
- [x] Disaster recovery & backup integrity verification documented
- [x] Review completes before release

## 6. API Authentication Notes

### Webhook Subscription Endpoint (`/api/webhooks`)

This endpoint registers, reads, updates, and deletes a creator's
`PromptPurchased` webhook subscription, which controls where sale-notification
deliveries are routed.

**Authentication requirement (as of this update):** creating, updating
(`POST`), and removing (`DELETE`) a subscription now requires a signed proof of
wallet ownership for the `walletAddress` in the request. The signature is
verified using the same challenge/signature primitives used by the unlock
flow (`src/lib/auth/challenge.ts`):

1. The client first requests a challenge token from `/api/auth/challenge`
   with `promptId` set to the sentinel value `"webhook-registration"`.
2. The client signs the returned `challenge` message with the wallet that
   owns `walletAddress`.
3. The `POST`/`DELETE` body must include `token` (the challenge token) and
   `signedMessage` (the base64 wallet signature over the challenge message).

The server rejects requests missing these fields (`MISSING_FIELDS`, 400) and
requests whose signature does not match `walletAddress` (`INVALID_SIGNATURE`,
401). Challenge tokens are short-lived and single-use (nonce replay
protection), so a valid proof cannot be replayed.

**`GET` (read) is unauthenticated but privacy-protected:** it never returns the
signing `secret`, and it only returns the delivery `url` to a caller that
proves ownership of `walletAddress`. Unauthenticated callers receive the
subscription metadata (e.g. `events`, `active`) without the `url`.

**Rationale:** previously the endpoint keyed subscriptions solely on a
client-supplied `walletAddress` with no ownership proof, allowing anyone who
knew a creator's address to hijack or DoS their notification delivery.
