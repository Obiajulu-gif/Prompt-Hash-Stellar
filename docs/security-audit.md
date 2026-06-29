# PromptHash Security Audit Report — Issue #111

**Date:** 2026-04-28  
**Scope:** Soroban smart contract (`contracts/prompt_hash`) + Unlock Service (`server/`)  
**Auditor:** PromptHash Core Team

---

## Executive Summary

This report documents a review of the PromptHash Stellar smart contract and the off-chain unlock service. No critical vulnerabilities were found. Two medium-severity findings and three low-severity findings are disclosed below with recommended mitigations.

---

## 1. Soroban Contract Analysis

### 1.1 Reentrancy

**Status: Not applicable.**  
Soroban's execution model is single-threaded and does not support reentrancy in the EVM sense. Each contract call completes atomically before state is committed.

### 1.2 Integer Overflow / Underflow

**Status: Low severity.**  
Rust's default debug-mode overflow checking panics on overflow. In release builds, arithmetic wraps silently.

**Recommendation:** Use `checked_add` / `checked_sub` / `saturating_*` for all token-amount arithmetic to ensure predictable behaviour in all build profiles.

```rust
// Before
let new_balance = balance + amount;

// After
let new_balance = balance.checked_add(amount).expect("overflow");
```

### 1.3 Authentication and Authorization

**Status: Medium severity.**  
`require_auth()` is called on the buyer address before the purchase flow. However, the contract does not validate that `promptId` maps to a live, non-revoked prompt at the time of purchase.

**Finding:** A buyer could purchase a prompt that has been deleted or flagged off-chain, locking funds without receiving content.

**Recommendation:** Store an `active` flag per prompt on-chain and assert it before accepting payment.

### 1.4 Replay Protection

**Status: Low severity.**  
Purchase transactions include the buyer's wallet and the prompt ID as part of the invocation. Soroban's ledger sequence number provides replay protection at the transaction level. No additional nonce is required.

### 1.5 Front-running

**Status: Informational.**  
Price changes submitted between a user's quote and their purchase transaction could result in unexpected costs. Consider adding a `max_price` parameter to the purchase entry point so transactions revert if the price has moved.

---

## 2. Unlock Service (Challenge-Response Protocol)

### 2.1 Protocol Overview

The unlock service issues a time-limited challenge nonce to the buyer's wallet. The buyer signs the nonce with Freighter; the service verifies the signature against the on-chain purchase record before releasing the decryption key.

### 2.2 Challenge Nonce Strength

**Status: Medium severity.**  
If the nonce is derived from `Math.random()` or a predictable timestamp, an attacker may brute-force valid challenges before the real buyer responds.

**Recommendation:** Generate nonces using `crypto.randomBytes(32)` (Node.js) and enforce a 5-minute TTL with a server-side nonce store (Redis or MongoDB TTL index).

```typescript
import { randomBytes } from "crypto";
const nonce = randomBytes(32).toString("hex");
```

### 2.3 Signature Verification

**Status: Low severity.**  
Verify that the signature is checked against the **buyer wallet stored in the on-chain purchase record**, not a wallet address supplied by the client. Trusting a client-supplied address bypasses the on-chain state entirely.

```typescript
// Correct: fetch buyer wallet from on-chain purchase record
const purchase = await fetchPurchaseFromChain(promptId, txHash);
const isValid = verifySignature(purchase.buyerWallet, nonce, signature);
```

### 2.4 Key Material Exposure

**Status: Informational.**  
Decryption keys are stored server-side. An attacker who compromises the server gains access to all keys. Consider a forward-secrecy scheme (e.g. ECDH ephemeral key exchange) for high-value prompts.

### 2.5 Rate Limiting

**Status: Informational.**  
The unlock endpoint should be rate-limited per wallet to prevent automated key harvesting attempts.

---

## 3. Dependency Review

| Package | Version | CVE | Notes |
|---|---|---|---|
| `express` | ^4 | None known | Keep patched |
| `mongoose` | ^8 | None known | Keep patched |
| `@stellar/stellar-sdk` | latest | None known | Monitor SDF security advisories |

Run `npm audit` and `cargo audit` in CI to catch future advisories automatically.

---

## 4. Findings Summary

| ID | Severity | Component | Title | Status |
|---|---|---|---|---|
| AUD-01 | Medium | Contract | No on-chain prompt liveness check at purchase | Open |
| AUD-02 | Medium | Unlock Service | Weak challenge nonce generation | Open |
| AUD-03 | Low | Contract | Unchecked arithmetic in release builds | Open |
| AUD-04 | Low | Unlock Service | Client-supplied wallet in signature check | Open |
| AUD-05 | Low | Contract | No `max_price` slippage guard | Open |
| AUD-06 | Info | Unlock Service | Key material stored server-side | Accepted risk |
| AUD-07 | Info | Unlock Service | Unlock endpoint not rate-limited | Open |

---

## 5. Recommendations Roadmap

1. **AUD-01** — Add `is_active` flag to on-chain prompt record; assert in `purchase` entry point.
2. **AUD-02** — Replace weak nonce with `crypto.randomBytes(32)`; add 5-minute TTL store.
3. **AUD-03** — Audit all arithmetic in the contract; switch to `checked_*` methods.
4. **AUD-04** — Fetch buyer wallet from on-chain record, never trust client input.
5. **AUD-05** — Add `max_price: i128` parameter to the `purchase` function.
6. **AUD-07** — Add per-wallet rate limit (e.g. 10 req/min) to `/api/unlock`.

---

## 6. Disclosure Policy

Vulnerabilities should be reported privately via the process described in [SECURITY.md](../SECURITY.md). The project follows a 90-day responsible-disclosure window before public disclosure.
