# PromptHash Stellar

PromptHash Stellar is a Soroban-based marketplace for selling reusable AI prompt licenses with XLM payments and wallet-verified unlocks.

## Overview

PromptHash Stellar is an in-development creator marketplace built on Stellar. It lets creators publish encrypted prompt assets, expose only public preview metadata on-chain, and sell access rights to buyers without transferring ownership of the underlying content.

This repository includes:

- a Soroban smart contract for prompt listing, pricing, purchase tracking, and fee routing
- a Vite + React frontend for browsing, buying, listing, and managing prompt licenses
- serverless unlock endpoints that verify wallet ownership and on-chain access before returning plaintext

The product is intentionally designed around prompt licensing rather than NFT transfer. That matches the actual use case: creators want repeated sales, buyers want reliable access, and the platform needs transparent settlement on Stellar.

## Problem Statement

AI prompt creators increasingly monetize high-value workflows, but the current tooling is weak:

- prompt files are sold off-platform with poor proof of purchase
- content is either fully exposed before payment or hidden behind opaque centralized paywalls
- NFT-style ownership transfer does not match reusable prompt licensing
- buyers and ecosystem partners cannot easily verify payment logic, fees, or access rules

This creates a trust and distribution gap for creator economy products on-chain.

## Solution

PromptHash Stellar turns prompt packs into encrypted, contract-backed digital goods:

- creators submit a preview, price, and encrypted prompt payload
- the Soroban contract stores listing metadata, tracks purchase rights, and enforces XLM fee splits
- buyers purchase access in XLM
- buyers sign a short-lived wallet challenge
- the unlock service checks `has_access` on-chain, verifies the wallet signature, decrypts the ciphertext, and returns plaintext only to authorized wallets

## Why This Project Matters

PromptHash Stellar addresses a concrete gap between AI workflows and blockchain commerce. It gives creators a way to sell digital knowledge products with transparent payment rails while keeping delivery gated by verifiable wallet-based access. For Stellar, it expands utility beyond transfers into creator payments, programmable commerce, and application-layer access control.

## Core Features

- Encrypted prompt listings with public preview metadata
- Soroban contract for listing creation, purchase rights, creator catalog, buyer catalog, and fee management
- XLM-denominated purchases with contract-enforced seller/platform splits
- Wallet-based access verification using signed challenge messages
- Unlock flow with integrity checking against a stored content hash
- Creator dashboard for price updates and sale activation/deactivation
- Buyer profile for reopening previously purchased prompt licenses

## How It Works

### Listing flow

1. A creator connects a Stellar wallet.
2. The browser encrypts the full prompt with AES-GCM.
3. The AES key is wrapped against the unlock service public key.
4. The app submits `create_prompt` to Soroban with the encrypted payload, wrapped key, preview metadata, content hash, and XLM-denominated price.

### Purchase flow

1. A buyer browses public listings from contract state.
2. The app approves native asset spend and calls `buy_prompt`.
3. The contract transfers XLM from buyer to seller and fee wallet.
4. The contract records purchase rights and increments sales count.

### Unlock flow

1. The buyer requests a challenge token for a prompt.
2. The wallet signs the challenge message.
3. The unlock endpoint verifies token validity, wallet signature, and on-chain `has_access`.
4. The service unwraps the encrypted key, decrypts the ciphertext, recomputes the hash, and returns plaintext only if the integrity check matches.

## Stellar Ecosystem Alignment

PromptHash Stellar is strongly aligned with Stellar and Soroban:

- it uses Soroban contracts for stateful commerce rather than treating Stellar as a passive payment rail
- it settles purchases in XLM, increasing native asset utility
- it benefits from Stellar's low transaction costs and fast settlement for digital goods
- it fits Stellar's focus on practical financial utility by turning digital licensing into a transparent marketplace flow

## Specific Benefits To The Stellar Blockchain

### How it increases utility on Stellar

- Adds a new digital goods and creator economy use case for XLM
- Uses Soroban for programmable access control and revenue splitting
- Encourages wallet activity beyond simple transfers
- Creates demand for contract interactions tied to real content purchases

### How it can drive adoption

- Gives creators a straightforward on-ramp to monetize AI assets on Stellar
- Gives buyers a simple XLM purchase flow for digital work products
- Provides a pattern that can extend to templates, datasets, reports, and other encrypted digital goods

### Why Stellar is the right blockchain

- Low fees make smaller digital content purchases viable
- Fast settlement improves checkout UX for access-controlled content
- Soroban supports the contract logic needed for licensing and fee routing
- Stellar is well suited to globally accessible creator payments and micro-commerce

### Strategic ecosystem value

PromptHash Stellar can serve as a reusable reference implementation for:

- creator economy applications on Soroban
- encrypted digital goods marketplaces
- wallet-authenticated unlock flows
- XLM-based application monetization patterns

## Why It Is Valuable For Developers, Users, And The Ecosystem

### Developers

- Demonstrates a complete Soroban application with frontend, contract, and gated delivery flow
- Provides a practical reference for wallet auth, contract reads/writes, and server-assisted decryption
- Establishes a reusable design pattern for access rights instead of token transfer semantics

### Users

- Creators can monetize reusable prompt IP while retaining ownership
- Buyers get verifiable purchase rights with a cleaner flow than off-platform prompt sales
- Access is controlled by wallet ownership instead of an opaque centralized account system

### Ecosystem

- Broadens the category of applications being built on Stellar
- Showcases practical XLM commerce
- Creates a template for future applications in education, research content, consulting assets, and workflow automation packs

## Technical Architecture

PromptHash Stellar currently uses a three-part architecture:

### 1. Soroban smart contract

Located in `contracts/prompt-hash`.

Responsibilities:

- prompt creation
- price updates
- listing activation/deactivation
- purchase tracking
- creator and buyer prompt indexing
- fee wallet configuration
- contract upgrade path

Key methods implemented today:

- `create_prompt`
- `buy_prompt`
- `has_access`
- `get_prompt`
- `get_all_prompts`
- `get_prompts_by_creator`
- `get_prompts_by_buyer`
- `update_prompt_price`
- `set_prompt_sale_status`

### 2. Frontend application

Located in `src`.

The frontend handles wallet connection, client-side encryption before listing, marketplace browsing, contract-backed purchases, creator dashboard actions, and buyer unlock requests.

### 3. Unlock and API layer

Implemented through `api/auth/challenge.ts` and `api/prompts/unlock.ts`, with an additional Express workspace under `server/`.

The serverless unlock flow handles challenge token issuance, signature verification, on-chain access verification, key unwrap, prompt decryption, and plaintext integrity validation.

#### Observability & Production Hardening

The unlock service is hardened for production use with the following features:
- **Rate Limiting**: Request-level limits keyed by IP and wallet to prevent brute-force and DDoS attacks.
- **Structured Logging**: JSON-formatted logs with request ID tracking and sensitive data redaction.
- **Operational Metrics**: Real-time tracking of unlock success/failure rates, invalid signatures, and rate limit hits.
- **Health Monitoring**: Dedicated `/api/health` endpoint for uptime and configuration verification.
- **Incident Response**: Documented runbooks and debugging procedures located in `docs/operations/`.

## Proposed Tech Stack

- Soroban smart contracts in Rust
- Stellar SDK and Stellar Base for blockchain interaction
- React 19 + TypeScript + Vite for frontend
- Tailwind CSS and Radix UI primitives for interface components
- React Query for client-side data fetching
- libsodium + Web Crypto for encryption and key wrapping
- Vercel serverless functions for unlock/auth endpoints
- Optional Express service workspace for external chat/proxy integrations

## Smart Contract / Blockchain Interaction

The Soroban contract stores encrypted prompt data and commercial metadata directly on-chain. The full plaintext is never stored in readable form. Purchases are settled in Stellar's native asset contract, and access control is determined by contract state rather than a centralized database.

The current contract data model includes:

- prompt ID
- creator address
- image URL
- title
- category
- preview text
- encrypted prompt payload
- encryption IV
- wrapped AES key
- content hash
- price in stroops
- active status
- sales count

## Installation

### Prerequisites

- Node.js 22+
- Yarn 4+ (Corepack enabled)
- Rust toolchain
- Stellar CLI with Soroban support

### Install dependencies

```bash
yarn install
cd server && npm install && cd ..
```

## Local Development Setup

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Fill in the required Stellar and unlock-service variables.
3. Start the frontend:

```bash
yarn dev
```

4. Optional: run the auxiliary Node server:

```bash
cd server
npm run dev
```

5. Run contract tests:

```bash
cargo test -p prompt-hash
```

6. Run the frontend test suite:

```bash
yarn test:frontend
```

## Environment Variables

See `.env.example` for the full template. Main variables:

- `PUBLIC_STELLAR_NETWORK`
- `PUBLIC_STELLAR_NETWORK_PASSPHRASE`
- `PUBLIC_STELLAR_RPC_URL`
- `PUBLIC_STELLAR_HORIZON_URL`
- `PUBLIC_PROMPT_HASH_CONTRACT_ID`
- `PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID`
- `PUBLIC_STELLAR_SIMULATION_ACCOUNT`
- `PUBLIC_UNLOCK_PUBLIC_KEY`
- `CHALLENGE_TOKEN_SECRET`
- `UNLOCK_PUBLIC_KEY`
- `UNLOCK_PRIVATE_KEY`

## Usage

### For creators

- Connect a Stellar wallet
- Create a prompt listing from `/sell`
- Set preview metadata and price
- Let the app encrypt and publish the listing on Soroban
- Manage price and sale status from the creator dashboard

### For buyers

- Browse listings from `/browse`
- Buy prompt access in XLM
- Unlock the purchased prompt with wallet signature verification
- Reopen purchased prompts from `/profile`

## Frontend Integration Tests

The frontend suite uses Vitest + jsdom + React Testing Library to cover the main marketplace journeys without a live wallet extension or live Soroban environment.

Run it with:

```bash
yarn test:frontend
```

Coverage currently includes:

- disconnected wallet and wrong-network UI handling
- create-listing validation and mocked contract submission
- purchase and unlock behavior with mocked wallet and unlock boundaries
- unlock failure recovery with retry
- creator dashboard refresh after React Query invalidation

Contributor notes:

- Use [`src/test/render.tsx`](./src/test/render.tsx) to render components with router, wallet, and React Query providers.
- Reuse fixtures from [`src/test/fixtures/prompts.ts`](./src/test/fixtures/prompts.ts) for realistic prompt records.
- Mock wallet, contract, and unlock boundaries instead of relying on live chain dependencies.
- Prefer integration coverage around real flow components such as `CreatePromptForm`, `FetchAllPrompts`, `PromptModal`, and `MyPrompts`.

See `docs/frontend-testing.md` for the recommended pattern when adding new frontend coverage.

## Roadmap

- Mainnet-ready deployment configuration
- Better indexing and search beyond direct contract reads
- Prompt analytics for creators
- Support for stable asset pricing in addition to XLM
- Moderation and abuse-reporting flows
- Stronger seller reputation and verification signals

## Future Improvements

- SEP-compatible identity and creator profiles
- Prompt bundles and subscription-style access passes
- Revenue-sharing splits for co-creators
- Encrypted off-chain blob support for larger content assets
- Better caching and pagination for high-volume marketplaces
- Additional developer docs and deployment automation

## Contribution Guidelines

Contributions are welcome, especially in the following areas:

- Soroban contract hardening and testing
- frontend UX for wallet and purchase flows
- indexing/search strategy
- unlock-service security review
- creator onboarding and marketplace moderation

See `CONTRIBUTING.md` for workflow details.

## License

This repository is licensed under the Apache License 2.0. See `LICENSE`.

## Maintainer

Maintained by the PromptHash Stellar team for Drip Wave submission and ongoing open-source development.

## GitHub Preparation

- Recommended repository name: `prompt-hash-stellar`
- Suggested short description: `Soroban-based prompt licensing marketplace with XLM payments and wallet-verified unlocks`
- Suggested topics: `stellar`, `soroban`, `xlm`, `creator-economy`, `ai-prompts`, `marketplace`, `blockchain`, `rust`, `react`, `vercel`
- Suggested release title for `v0.1.0`: `Prompt licensing marketplace foundation on Stellar`

### Suggested commit messages

- `docs: rewrite repository for Drip Wave submission`
- `docs: add architecture and ecosystem overview`
- `chore: align package metadata with PromptHash Stellar`
