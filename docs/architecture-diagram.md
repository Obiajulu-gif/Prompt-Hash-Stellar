# PromptHash Stellar — End-to-End Architecture

This guide is the visual companion to [architecture.md](./architecture.md). It
diagrams how the four moving parts of PromptHash Stellar fit together and walks
through the three core flows — **listing**, **purchase**, and **unlock** — at the
message level.

The diagrams below are written in [Mermaid](https://mermaid.js.org/) and render
inline on GitHub.

## Contents

- [System overview](#system-overview)
- [Component responsibilities](#component-responsibilities)
- [Encryption and wallet verification model](#encryption-and-wallet-verification-model)
- [Flow 1 — Listing a prompt](#flow-1--listing-a-prompt)
- [Flow 2 — Purchasing access](#flow-2--purchasing-access)
- [Flow 3 — Unlocking a purchased prompt](#flow-3--unlocking-a-purchased-prompt)
- [Environment variables](#environment-variables)

## System overview

The smart contract is the single source of truth for ownership and access
rights. The frontend, the serverless unlock service, and the optional Express
indexer all defer to it.

```mermaid
flowchart TB
    subgraph Client["Browser (src/)"]
        UI["React 19 UI<br/>browse / sell / profile"]
        Crypto["promptCrypto.ts<br/>AES-GCM + sealed-box wrap"]
        Wallet["Stellar wallet<br/>Freighter / signing"]
        Client_SDK["promptHashClient.ts<br/>Soroban RPC client"]
    end

    subgraph Serverless["Vercel serverless (api/)"]
        Challenge["api/auth/challenge.ts<br/>issue HMAC challenge"]
        Unlock["api/prompts/unlock.ts<br/>verify + decrypt"]
    end

    subgraph Chain["Stellar / Soroban"]
        Contract["prompt-hash contract<br/>listings + access state"]
        Native["native XLM asset<br/>SAC"]
    end

    subgraph Offchain["Optional off-chain"]
        Express["server/<br/>read-only index, reviews, webhooks"]
        IPFS["IPFS / Pinata<br/>large ciphertext payloads"]
    end

    UI --> Crypto
    UI --> Wallet
    UI --> Client_SDK
    Crypto -. "ipfs:// ref for >4KB" .-> IPFS
    Client_SDK -->|"create_prompt / buy_prompt / reads"| Contract
    Wallet -->|"sign tx"| Contract
    Contract -->|"transfer stroops"| Native
    UI -->|"request challenge"| Challenge
    UI -->|"signed unlock request"| Unlock
    Unlock -->|"has_access (RPC simulation)"| Contract
    Unlock -. "fetch ciphertext" .-> IPFS
    Express -. "read-only mirror" .-> Contract
```

## Component responsibilities

| Layer | Path | Responsibility |
|-------|------|----------------|
| Frontend | `src/` | Wallet connection, client-side encryption, marketplace browsing, listing management, unlock initiation |
| Soroban contract | `contracts/prompt-hash` | Authoritative ownership, purchase rights, payment routing, fee config |
| Unlock / auth service | `api/auth/challenge.ts`, `api/prompts/unlock.ts` | Mint challenge tokens, verify wallet signatures, check on-chain access, decrypt and integrity-check plaintext |
| Off-chain indexer | `server/` | Read-only indexing, preview analytics, reviews, webhook dispatch (never writes access state) |
| Off-chain storage | IPFS / Pinata | Optional store for encrypted payloads larger than the on-chain cap |

The contract is the **only** component permitted to grant, revoke, or modify
access. The unlock service trusts `has_access`, not any database.

## Encryption and wallet verification model

Two independent cryptographic guarantees protect a prompt:

1. **Confidentiality** — the plaintext is encrypted in the browser and can only
   be recovered by the unlock service's private key.
2. **Authorization** — plaintext is only released to a wallet that both proves
   key ownership (signature) and holds on-chain access (`has_access`).

```mermaid
flowchart LR
    PT["Prompt plaintext"] -->|"AES-GCM 256"| CT["Ciphertext + IV"]
    AES["Random AES key"] --> CT
    AES -->|"crypto_box_seal<br/>(unlock public key)"| WK["Wrapped key"]
    CT --> Store["On-chain record<br/>(or ipfs:// ref)"]
    WK --> Store

    Store -.->|"unlock"| Open["crypto_box_seal_open<br/>(unlock private key)"]
    Open --> AES2["Recovered AES key"]
    AES2 -->|"AES-GCM decrypt"| PT2["Plaintext"]
    PT2 -->|"SHA-256"| Check{"hash == on-chain<br/>content hash?"}
    Check -->|"yes"| Deliver["Return to buyer"]
    Check -->|"no"| Reject["INTEGRITY_FAILURE"]
```

Key facts (see `src/lib/crypto/promptCrypto.ts` and `api/prompts/unlock.ts`):

- Prompt bodies use **AES-GCM 256** with a per-prompt random key and IV.
- The AES key is wrapped with a libsodium **sealed box** (`crypto_box_seal`)
  against `PUBLIC_UNLOCK_PUBLIC_KEY`; only `UNLOCK_PRIVATE_KEY` can unwrap it.
- After decrypting, the service recomputes a **SHA-256** content hash and
  compares it with the hash stored on-chain, rejecting tampered payloads.
- Wallet verification is a **challenge-response**: the service issues a
  short-lived HMAC token (`CHALLENGE_TOKEN_SECRET`), the wallet signs it, and
  the unlock endpoint verifies the signature before reading access state.

## Flow 1 — Listing a prompt

```mermaid
sequenceDiagram
    actor Creator
    participant UI as Frontend (src/)
    participant Crypto as promptCrypto.ts
    participant Wallet
    participant Contract as Soroban contract

    Creator->>UI: Enter title, preview, price, full prompt
    UI->>Crypto: encryptPromptPlaintext(prompt)
    Crypto-->>UI: ciphertext + IV + content hash
    UI->>Crypto: wrapPromptKey(aesKey, unlock public key)
    Crypto-->>UI: sealed (wrapped) key
    Note over UI: Payloads over the on-chain cap are<br/>uploaded to IPFS, leaving an ipfs:// ref
    UI->>Wallet: request signature for create_prompt
    Wallet-->>UI: signed transaction
    UI->>Contract: create_prompt(metadata, ciphertext, wrapped key, hash)
    Contract-->>UI: prompt id
    UI-->>Creator: Listing published
```

## Flow 2 — Purchasing access

```mermaid
sequenceDiagram
    actor Buyer
    participant UI as Frontend (src/)
    participant Wallet
    participant Contract as Soroban contract
    participant Native as Native XLM (SAC)

    Buyer->>UI: Click Buy on a listing
    UI->>Wallet: request approval for buy_prompt
    Wallet-->>UI: signed transaction
    UI->>Contract: buy_prompt(prompt_id)
    Contract->>Native: transfer seller amount (stroops)
    Contract->>Native: transfer platform fee (stroops)
    Contract->>Contract: record buyer access rights
    Contract-->>UI: success
    UI-->>Buyer: Purchase confirmed (now unlockable)
```

## Flow 3 — Unlocking a purchased prompt

```mermaid
sequenceDiagram
    actor Buyer
    participant UI as Frontend (src/)
    participant Wallet
    participant Challenge as api/auth/challenge.ts
    participant Unlock as api/prompts/unlock.ts
    participant Contract as Soroban contract

    Buyer->>UI: Open purchased prompt
    UI->>Challenge: request challenge(prompt_id, address)
    Challenge-->>UI: HMAC-signed, time-bound token
    UI->>Wallet: sign challenge message
    Wallet-->>UI: signature
    UI->>Unlock: POST { token, signature, address, prompt_id }
    Unlock->>Unlock: verify token + signature
    Unlock->>Contract: has_access(address, prompt_id) via RPC simulation
    Contract-->>Unlock: true / false
    alt access granted
        Unlock->>Unlock: unwrap AES key, AES-GCM decrypt
        Unlock->>Unlock: SHA-256 integrity check vs on-chain hash
        Unlock-->>UI: plaintext prompt
        UI-->>Buyer: Prompt revealed
    else access denied or integrity failure
        Unlock-->>UI: error (unauthorized / integrity_failure)
        UI-->>Buyer: Unlock rejected
    end
```

## Environment variables

The full template lives in [`.env.example`](../.env.example) (testnet defaults)
and [`env.mainnet.example`](../env.mainnet.example) (mainnet). Variables
prefixed `PUBLIC_` are exposed to the browser; the rest are server-only and must
never be committed.

### Frontend and shared

| Variable | Scope | Purpose |
|----------|-------|---------|
| `PUBLIC_STELLAR_NETWORK` | Frontend | Active network (`TESTNET` / `PUBLIC` / `FUTURENET`); drives the testnet badge |
| `PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Frontend | Network passphrase used when signing transactions |
| `PUBLIC_STELLAR_RPC_URL` | Frontend | Soroban RPC endpoint |
| `PUBLIC_STELLAR_HORIZON_URL` | Frontend | Horizon endpoint for account and asset queries |
| `PUBLIC_PROMPT_HASH_CONTRACT_ID` | Frontend + server | Deployed prompt-hash contract id |
| `PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID` | Frontend + server | Native XLM Stellar Asset Contract id |
| `PUBLIC_STELLAR_SIMULATION_ACCOUNT` | Frontend + server | Account used for read-only RPC simulation (e.g. `has_access`) |
| `PUBLIC_UNLOCK_PUBLIC_KEY` | Frontend | Public key the browser wraps AES keys against |
| `PUBLIC_CHAT_API_BASE` | Frontend (optional) | External chat gateway used by the UI |
| `PUBLIC_PINATA_JWT` | Frontend (optional) | Upload-scoped Pinata JWT for off-chain ciphertext storage |
| `PUBLIC_SENTRY_DSN` | Frontend (optional) | Browser error capture |

### Unlock / auth service (server-only)

| Variable | Purpose |
|----------|---------|
| `CHALLENGE_TOKEN_SECRET` | HMAC secret for signing challenge tokens |
| `UNLOCK_PUBLIC_KEY` | Public half of the unlock key pair |
| `UNLOCK_PRIVATE_KEY` | Private key that unwraps AES keys and decrypts prompts (keep secret) |
| `PINATA_GATEWAY` | Optional IPFS gateway used to fetch off-chain ciphertext |
| `REDIS_URL` | Optional distributed rate-limit backing store (falls back to in-memory) |
| `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | Optional backend error monitoring |

### Optional secret rotation

| Variable | Purpose |
|----------|---------|
| `ADMIN_ROTATION_TOKEN` | Authorizes rotation operations |
| `CHALLENGE_TOKEN_SECRET_PREVIOUS` | Previous HMAC secret accepted during the grace window |
| `CHALLENGE_TOKEN_ROTATION_TIMESTAMP` | When rotation began (ms) |
| `CHALLENGE_TOKEN_GRACE_PERIOD_MS` | How long the previous secret stays valid (default `300000`) |

See [docs/secret-rotation.md](./secret-rotation.md) for the rotation runbook and
[docs/environments.md](./environments.md) for per-environment setup.
