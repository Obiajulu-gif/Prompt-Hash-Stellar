# PromptHash Stellar — Product Journeys

This document explains how PromptHash works from both the **creator** and **buyer** perspectives. It is written for new contributors who want to understand the product flow before changing code.

---

## Table of Contents

1. [Overview](#overview)
2. [Creator Journey](#creator-journey)
3. [Buyer Journey](#buyer-journey)
4. [Technical Boundaries](#technical-boundaries)
5. [Related Files and Issues](#related-files-and-issues)

---

## Overview

PromptHash Stellar is a marketplace where creators sell reusable AI prompt licenses and buyers purchase access in XLM. The key design principle is that **the full prompt is never stored in plaintext** — it is encrypted in the browser before anything touches the blockchain.

Three layers work together:

| Layer | What it does |
|---|---|
| **Soroban contract** | Stores encrypted prompt data, tracks purchase rights, enforces XLM fee splits |
| **Frontend (React/Vite)** | Handles wallet connection, encryption, browsing, purchases, and unlock requests |
| **Unlock service (serverless)** | Verifies wallet ownership and on-chain access before returning plaintext |

---

## Creator Journey

### Step 1 — Connect a Stellar wallet

The creator visits `/sell` and connects a Stellar wallet using the Stellar Wallets Kit. The app needs a connected wallet address and a `signTransaction` function before any listing can be submitted.

**Component:** `src/pages/sell/page.tsx`, `src/hooks/useWallet.ts`

### Step 2 — Fill in the listing form

The creator fills in the listing form at `/sell`:

- **Image URL** — a cover image shown on browse cards
- **Title** — up to 120 characters, shown publicly
- **Category** — selected from a predefined list
- **Preview text** — up to 280 characters, shown publicly before purchase
- **Full prompt** — the private content that buyers unlock after purchase
- **Price in XLM** — the purchase price

**Component:** `src/pages/sell/CreatePromptForm.tsx`

A listing quality checklist runs before submission to catch weak or missing metadata. Required fields block submission; recommended improvements show as non-blocking warnings.

### Step 3 — Browser-side encryption

When the creator clicks "Create prompt listing", the browser:

1. Generates a random AES-GCM key.
2. Encrypts the full prompt with that key.
3. Wraps (encrypts) the AES key against the unlock service's public key so only the unlock service can unwrap it.
4. Computes a SHA-256 content hash of the plaintext for integrity verification later.

The plaintext never leaves the browser unencrypted.

**Library:** `src/lib/crypto/promptCrypto.ts`

### Step 4 — Submit to Soroban

The app calls `create_prompt` on the Soroban contract with:

- public metadata (image, title, category, preview, price)
- encrypted payload and IV
- wrapped AES key
- content hash

The transaction is signed by the creator's wallet and submitted to the Stellar network.

**Contract method:** `create_prompt` in `contracts/prompt-hash/src/contract.rs`  
**Client helper:** `src/lib/stellar/promptHashClient.ts`

### Step 5 — Manage listings

After publishing, the creator can:

- Update the price with `update_prompt_price`
- Toggle the listing active/inactive with `set_prompt_sale_status`
- View their catalog from the creator dashboard

**Component:** `src/pages/sell/MyPrompts.tsx`

### Creator journey sequence

```
Creator
  │
  ├─ Connect wallet (/sell)
  ├─ Fill listing form
  ├─ [Checklist validates quality]
  ├─ Browser encrypts full prompt (AES-GCM)
  ├─ Browser wraps AES key (unlock service public key)
  ├─ Call create_prompt on Soroban contract
  ├─ Wallet signs and submits transaction
  └─ Listing appears on /browse
```

---

## Buyer Journey

### Step 1 — Browse listings

The buyer visits `/browse`. The frontend reads all active prompt listings directly from the Soroban contract using `get_all_prompts`. Each card shows the public metadata: image, title, category, preview text, and price.

**Component:** `src/pages/browse/FetchAllPrompts.tsx`, `src/pages/browse/PromptCard.tsx`

### Step 2 — View prompt details

Clicking a card opens a modal with the full public preview and the purchase button.

**Component:** `src/pages/browse/PromptModal.tsx`

### Step 3 — Purchase in XLM

The buyer clicks "Buy". The app:

1. Approves the native XLM asset spend.
2. Calls `buy_prompt` on the Soroban contract.
3. The contract transfers XLM from the buyer to the seller and the platform fee wallet.
4. The contract records the buyer's purchase rights on-chain.

**Contract method:** `buy_prompt` in `contracts/prompt-hash/src/contract.rs`

### Step 4 — Request a challenge token

To unlock the prompt, the buyer's wallet must prove ownership. The frontend calls `POST /api/auth/challenge` with the buyer's wallet address and the prompt ID. The server returns a short-lived signed challenge token.

**API handler:** `api/auth/challenge.ts`

### Step 5 — Sign the challenge

The frontend asks the buyer's wallet to sign the challenge message. This produces a `signedMessage` that proves the buyer controls the wallet address.

### Step 6 — Unlock the prompt

The frontend calls `POST /api/prompts/unlock` with:

- `token` — the challenge token
- `promptId`
- `address` — the buyer's wallet address
- `signedMessage` — the wallet signature

The unlock service:

1. Verifies the challenge token has not expired.
2. Verifies the wallet signature matches the address.
3. Calls `has_access` on the Soroban contract to confirm the buyer purchased the prompt.
4. Unwraps the AES key using the unlock service's private key.
5. Decrypts the ciphertext.
6. Recomputes the content hash and compares it to the stored hash (integrity check).
7. Returns the plaintext only if all checks pass.

**API handler:** `api/prompts/unlock.ts`

### Step 7 — Read the prompt

The plaintext is displayed in the browser. The buyer can return to `/profile` to reopen any previously purchased prompt.

### Buyer journey sequence

```
Buyer
  │
  ├─ Browse /browse (reads contract state)
  ├─ Click prompt card → view modal
  ├─ Click "Buy"
  │    ├─ Approve XLM spend
  │    └─ Call buy_prompt on Soroban contract
  │         └─ Contract records purchase rights
  │
  ├─ Click "Unlock"
  │    ├─ POST /api/auth/challenge  → challenge token
  │    ├─ Wallet signs challenge message
  │    └─ POST /api/prompts/unlock
  │         ├─ Verify token (not expired)
  │         ├─ Verify wallet signature
  │         ├─ Check has_access on contract
  │         ├─ Unwrap AES key
  │         ├─ Decrypt ciphertext
  │         └─ Integrity check (content hash)
  │
  └─ Plaintext displayed in browser
```

---

## Technical Boundaries

Understanding which layer owns which responsibility helps contributors find the right place to make changes.

### Soroban contract (`contracts/prompt-hash/`)

- Stores all prompt metadata and encrypted payload on-chain
- Enforces purchase rights and XLM fee splits
- Exposes read methods (`get_prompt`, `has_access`, `get_all_prompts`) used by both frontend and unlock service
- Does **not** handle encryption, decryption, or wallet signature verification

### Frontend (`src/`)

- Handles wallet connection via Stellar Wallets Kit
- Performs all client-side encryption before any data leaves the browser
- Reads contract state for browsing
- Initiates purchases and unlock requests
- Does **not** store secrets or perform decryption

### Unlock service (`api/auth/`, `api/prompts/`)

- Issues and verifies short-lived challenge tokens
- Verifies wallet signatures
- Calls the Soroban contract to confirm on-chain access
- Holds the unlock service private key for AES key unwrapping
- Performs decryption and integrity checking server-side
- Returns plaintext only to verified, authorized wallets
- Does **not** expose sensitive error details to the client

### Error codes

The challenge and unlock endpoints return stable error codes so the frontend can show accurate recovery states:

| HTTP status | Meaning | Frontend action |
|---|---|---|
| `400` | Missing or malformed request fields | Show field-level error |
| `401` | Invalid wallet signature | Ask buyer to retry signing |
| `403` | Prompt access not purchased | Direct buyer to purchase flow |
| `429` | Rate limit exceeded | Show retry-after guidance |
| `500` | Configuration or integrity error | Show generic error, do not retry automatically |

Expired challenge tokens surface as `400` with an `expired` message. The frontend should detect this and request a fresh challenge automatically.

---

## Related Files and Issues

| File | Purpose |
|---|---|
| `src/pages/sell/CreatePromptForm.tsx` | Creator listing form with quality checklist |
| `src/pages/browse/FetchAllPrompts.tsx` | Reads all prompts from contract |
| `src/pages/browse/PromptModal.tsx` | Purchase and unlock UI |
| `src/pages/sell/MyPrompts.tsx` | Creator dashboard |
| `api/auth/challenge.ts` | Challenge token issuance |
| `api/prompts/unlock.ts` | Prompt unlock and decryption |
| `src/lib/crypto/promptCrypto.ts` | AES-GCM encryption helpers |
| `src/lib/stellar/promptHashClient.ts` | Soroban contract client |
| `contracts/prompt-hash/src/contract.rs` | Soroban contract implementation |
| `docs/architecture.md` | System architecture overview |
| `docs/api-reference.md` | Challenge-response protocol details |
| `docs/frontend-testing.md` | Frontend test patterns |
| `docs/creator-onboarding.md` | Creator workflow guide |

**Related issues:**

- [#154](https://github.com/Obiajulu-gif/Prompt-Hash-Stellar/issues/154) — Listing quality checklist before publication
- [#155](https://github.com/Obiajulu-gif/Prompt-Hash-Stellar/issues/155) — Standardize challenge and unlock API error codes
- [#157](https://github.com/Obiajulu-gif/Prompt-Hash-Stellar/issues/157) — One-command local setup validation
- [#159](https://github.com/Obiajulu-gif/Prompt-Hash-Stellar/issues/159) — Buyer and creator journey documentation (this file)
