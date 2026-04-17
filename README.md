# PromptHash Stellar

Soroban-native marketplace for encrypted AI prompt licensing with XLM settlement and wallet-verified access control.

## Overview

PromptHash Stellar is an early-stage application for selling reusable AI prompt assets on Stellar without exposing the underlying content before payment. Creators publish a public preview and an encrypted payload, buyers pay in XLM, and the unlock flow releases plaintext only after wallet signature verification and an on-chain access check.

The product is intentionally modeled as licensing, not collectible transfer. That fits how prompt creators monetize in practice: they need repeat sales, fee transparency, and reliable buyer access rather than secondary-market NFT semantics.

This repository includes:

- a Soroban smart contract for listing creation, pricing, purchasing, fee routing, and access checks
- a React and Vite frontend for browsing, listing, buying, and unlocking prompt assets
- serverless challenge and unlock endpoints that verify wallet ownership before releasing plaintext

## Problem Statement

Prompt creators and workflow designers increasingly sell high-value prompt packs, but current distribution is weak in three ways:

- payment and delivery usually happen off-platform with limited proof of purchase
- buyers either see too much before paying or rely on opaque centralized access controls
- reusable digital licenses are often forced into token-transfer models that do not fit the product

For Stellar, this leaves a practical digital commerce category underdeveloped: programmable access to digital goods paid for in XLM.

## Solution

PromptHash Stellar combines Soroban contract state, wallet authentication, and encrypted content delivery:

- creators list encrypted prompts with preview metadata and an XLM-denominated price
- a Soroban contract stores listing state, purchase rights, creator indexes, and platform fee rules
- buyers purchase access using Stellar wallets
- an unlock endpoint verifies a short-lived signed challenge and checks `has_access` on-chain before decrypting content

This design keeps payment, access rights, and fee logic transparent on Stellar while limiting plaintext delivery to authorized wallets.

## Why This Project Matters

PromptHash Stellar gives Stellar a concrete creator-economy use case beyond simple transfers. It shows how Soroban can support application-layer commerce where payment, rights management, and gated delivery all depend on contract state. The same pattern can extend beyond prompts to research reports, operating playbooks, templates, datasets, and other encrypted digital goods.

## Core Features

- Encrypted prompt listings with public preview metadata
- Soroban contract for prompt creation, purchasing, pricing, and sale-state management
- XLM-denominated checkout with contract-enforced seller and platform fee routing
- Wallet-based unlock flow using signed challenge messages
- Integrity verification by recomputing the prompt hash after decryption
- Creator and buyer catalog views sourced from contract reads
- In-development frontend for listing, discovery, purchase, and unlock actions

## How It Works

### Listing Flow

1. A creator connects a Stellar wallet.
2. The browser encrypts the prompt plaintext with AES-GCM.
3. The AES key is wrapped against the unlock service public key.
4. The app calls `create_prompt` with encrypted content, preview metadata, content hash, and price in stroops.

### Purchase Flow

1. A buyer browses public listings from contract state.
2. The app approves native asset spend and submits `buy_prompt`.
3. The contract transfers the seller amount and platform fee in XLM.
4. The contract records the purchase right for the buyer wallet.

### Unlock Flow

1. The buyer requests a short-lived challenge token for a prompt.
2. The wallet signs the challenge message.
3. The unlock endpoint verifies the token, signature, and `has_access` response from Soroban.
4. The service unwraps the AES key, decrypts the payload, verifies the hash, and returns plaintext to the authorized buyer.

## Stellar Ecosystem Alignment

PromptHash Stellar is designed around the strengths of Stellar and Soroban:

- low-fee settlement makes smaller digital purchases commercially viable
- fast confirmation improves checkout and unlock UX
- Soroban provides the stateful logic needed for access rights, fee routing, and listing management
- Stellar wallets become the identity and payment primitive for creator commerce flows

## Specific Benefits To The Stellar Blockchain

### How It Increases Utility On Stellar

- turns XLM into a settlement asset for digital licensing, not only transfers
- drives repeated wallet interactions tied to real application usage
- creates a reusable pattern for gated digital goods backed by Soroban state

### How It Can Drive Adoption

- gives creators a straightforward way to monetize digital knowledge products on Stellar
- gives buyers a clearer purchase-and-access experience than manual off-chain delivery
- demonstrates a product category that can onboard non-crypto-native users through a simple pay-to-unlock flow

### Why Stellar Is The Right Blockchain

- low transaction costs support micro-commerce and impulse purchases
- Soroban contract execution is sufficient for rights tracking and fee management without overcomplicating the stack
- Stellar's payments-first orientation fits creator payouts and cross-border usage

### Strategic Ecosystem Value

PromptHash Stellar is useful beyond the immediate prompt marketplace. It can serve as a reference implementation for:

- creator economy applications on Soroban
- encrypted content delivery with wallet-authenticated access
- contract-based revenue sharing and licensing flows
- new forms of application monetization that settle in XLM

## Why It Is Valuable For Developers, Users, And The Ecosystem

### Developers

- provides a practical Soroban example that combines contract logic, frontend wallet UX, and off-chain unlock verification
- offers reusable patterns for wallet challenge auth, encrypted payload handling, and contract-backed access rights

### Users

- creators retain control of their intellectual property while selling repeat licenses
- buyers get verifiable purchase rights tied to their wallet instead of a platform-only account

### Ecosystem

- expands the range of serious consumer and prosumer applications on Stellar
- demonstrates how Soroban can support practical digital commerce, not only financial primitives

## Technical Architecture

PromptHash Stellar is organized into three layers.

### 1. Soroban Smart Contract

Path: `contracts/prompt-hash`

Responsibilities:

- store prompt listings and metadata
- route XLM payments and platform fees
- record purchase rights
- expose catalog and access query methods
- support administrative fee updates and future contract upgrades

Key contract methods currently implemented:

- `create_prompt`
- `buy_prompt`
- `has_access`
- `get_prompt`
- `get_all_prompts`
- `get_prompts_by_creator`
- `get_prompts_by_buyer`
- `update_prompt_price`
- `set_prompt_sale_status`
- `set_fee_percentage`
- `set_fee_wallet`
- `upgrade`

### 2. Frontend Application

Path: `src`

Responsibilities:

- wallet connection and transaction signing
- client-side encryption before prompt submission
- marketplace browsing and filtering
- creator listing management
- buyer-side unlock requests

### 3. Unlock / API Layer

Paths:

- `api/auth/challenge.ts`
- `api/prompts/unlock.ts`

Responsibilities:

- issue short-lived challenge tokens
- verify wallet signatures
- confirm on-chain access rights
- unwrap encrypted AES keys
- decrypt prompt payloads and validate integrity

## Proposed Tech Stack

- Rust + Soroban SDK for smart contracts
- Stellar SDK and Stellar Base for transaction and RPC interaction
- React 19, TypeScript, and Vite for the frontend
- Tailwind CSS and Radix UI for application UI primitives
- React Query for client-side data access
- Web Crypto and `libsodium-wrappers` for encryption and key wrapping
- Vercel serverless functions for challenge and unlock endpoints
- optional Node/Express workspace for auxiliary service integrations

## Smart Contract / Blockchain Interaction

PromptHash Stellar stores encrypted prompt data and commercial metadata on-chain. Plaintext is never written to contract state. Purchases are settled through Stellar's native asset contract, and prompt access is determined by contract state rather than a centralized entitlement database.

The current prompt record includes:

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
- Yarn 4 or npm
- Rust toolchain
- Stellar CLI with Soroban support

### Install Dependencies

```bash
yarn install
cd server && npm install && cd ..
```

## Local Development Setup

1. Copy `.env.example` to `.env`.
2. Fill in the required testnet contract and unlock-service values.
3. Start the frontend:

```bash
yarn dev
```

4. Optional: run the auxiliary Node workspace:

```bash
cd server
npm run dev
```

5. Run validation locally:

```bash
yarn test
yarn build
cargo test -p prompt-hash
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `PUBLIC_STELLAR_NETWORK` | Frontend Stellar network selector |
| `PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Network passphrase used by wallet and RPC clients |
| `PUBLIC_STELLAR_RPC_URL` | Soroban RPC endpoint |
| `PUBLIC_STELLAR_HORIZON_URL` | Horizon endpoint |
| `PUBLIC_PROMPT_HASH_CONTRACT_ID` | Deployed PromptHash contract ID |
| `PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID` | Stellar native asset contract ID |
| `PUBLIC_STELLAR_SIMULATION_ACCOUNT` | Simulation account used for frontend contract interactions |
| `PUBLIC_UNLOCK_PUBLIC_KEY` | Public key used in the browser for key wrapping |
| `PUBLIC_CHAT_API_BASE` | Optional external chat gateway used by the current UI |
| `CHALLENGE_TOKEN_SECRET` | Secret used to mint and verify unlock challenge tokens |
| `UNLOCK_PUBLIC_KEY` | Unlock service public key |
| `UNLOCK_PRIVATE_KEY` | Unlock service private key |

## Usage

### Create A Prompt Listing

1. Connect a Stellar wallet on testnet.
2. Enter listing metadata and the full prompt content in the seller flow.
3. The frontend encrypts the prompt locally and submits the listing to Soroban.

### Purchase And Unlock A Prompt

1. Browse public listings and select a prompt.
2. Purchase access in XLM.
3. Request an unlock challenge, sign it with the buyer wallet, and retrieve plaintext after access verification succeeds.

## Roadmap

### Phase 1: Review Environment

- stabilize the current testnet flow end to end
- improve contract and frontend test coverage
- refine listing UX, unlock reliability, and developer setup

### Phase 2: Ecosystem Readiness

- add indexing, pagination, and more efficient discovery flows
- improve creator analytics and payout transparency
- harden operational handling for secrets, monitoring, and deployment

### Phase 3: Product Expansion

- support richer license models such as bundles and versioned prompt packs
- generalize the unlock pattern to adjacent digital goods
- prepare a mainnet readiness checklist and deployment process

## Future Improvements

- seller analytics and sales export tooling
- moderation and abuse-reporting workflows
- better search and recommendation infrastructure
- SDK helpers for other Stellar builders implementing gated-content flows
- support for additional Stellar assets where they improve specific payment corridors

## Contribution Guidelines

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Licensed under Apache-2.0. See [LICENSE](./LICENSE).

## Maintainer

Maintained by [@Obiajulu-gif](https://github.com/Obiajulu-gif).

Project status: active early-stage repository and submission candidate for the Drip Wave maintainer track. The current codebase is a working foundation, not a production-hardened deployment.
