# Security Model and Threat Architecture

This document outlines the security assumptions, potential attack vectors, and mitigation strategies for the PromptHash Stellar ecosystem.

## Security Architecture

The system relies on a hybrid architecture combining on-chain state (Soroban) with off-chain gated delivery (Unlock Service).

### Trust Boundaries
1.  **Client (Browser)**: Responsible for initial encryption and wallet interaction. Trusted to not leak the plaintext before it's encrypted.
2.  **Soroban Contract**: Trusted source of truth for "who owns what". Enforces XLM payments and immutable entitlement records.
3.  **Unlock Service**: Responsible for key unwrapping and decryption. Trusted to verify on-chain state before releasing content.

---

## Threat Model

### 1. Service-in-the-Middle (Replay Attacks)
**Scenario:** An attacker intercepts a signed challenge and attempts to use it later to unlock content.
**Mitigation:**
- **Nonces**: Every challenge includes a unique `nonce` (UUID) that the server tracks (or signs into the token).
- **TTL (Time-to-Live)**: Challenge tokens are short-lived (e.g., 5 minutes). Even if intercepted, the window of opportunity is small.
- **Server Signature**: The challenge token is signed by the server's secret, preventing attackers from forging their own valid challenges.

### 2. Double-Spend / Lack of Entitlement
**Scenario:** A user attempts to unlock content without paying, or after a transaction was reverted.
**Mitigation:**
- **On-Chain Verification**: The Unlock Service MUST query the Soroban contract's `has_access` method before performing any decryption. This ensures that the buyer's address is permanently recorded as having purchase rights.
- **Finality**: The service should wait for transaction finality (successful ledger inclusion) before acknowledging a purchase.

### 3. Server Compromise
**Scenario:** An attacker gains access to the Unlock Service's private key.
**Mitigation:**
- **Encrypted-at-Rest**: Content stored on-chain is encrypted with AES keys that are wrapped. Even with the service private key, the attacker still needs to fetch the encrypted payload from the blockchain.
- **Separation of Concerns**: The service does not store a master key for all prompts; it only holds the key used for wrapping.

### 4. Malicious Creator (Content Mismatch)
**Scenario:** A creator sells a "Gold Prompt" but puts garbage in the encrypted payload.
**Mitigation:**
- **Content Hash**: The contract stores a SHA-256 hash of the intended plaintext. When the buyer unlocks, the service re-hashes the result. If it doesn't match, the buyer has proof of fraud.
- **Reputation**: (Future) Community ratings and escrow systems can mitigate this further.

---

## Access Control Logic

The `has_access` logic in the contract is the primary gatekeeper:
```rust
fn has_access(env: Env, user: Address, prompt_id: u128) -> Result<bool, Error> {
    let prompt = Storage::require_prompt(&env, prompt_id)?;
    Ok(prompt.creator == user || Storage::has_purchase(&env, prompt_id, &user))
}
```
This ensures that ONLY the original creator or a verified buyer can ever trigger the unlock flow successfully.
