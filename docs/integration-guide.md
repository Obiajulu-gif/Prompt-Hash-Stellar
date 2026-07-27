# PromptHash Developer Integration Guide — Issue #110

This guide shows third-party developers how to fetch prompts, buy licenses, and verify ownership using the `@prompthash/sdk` package and the REST API directly.

---

## Installation

```bash
npm install @prompthash/sdk @stellar/stellar-sdk
# or
yarn add @prompthash/sdk @stellar/stellar-sdk
```

---

## Quick Start

```typescript
import { PromptHashClient } from "@prompthash/sdk";

const client = new PromptHashClient({
  apiUrl: "https://api.prompthash.io",
  network: "mainnet", // or "testnet"
});
```

---

## Fetching Prompts

### List prompts (with community ranking)

```typescript
// Sorted by upvotes (community governance rank)
const prompts = await client.listPrompts({ sort: "upvotes", limit: 20 });

console.log(prompts);
// [{ id, title, image, rating, upvotes, owner, priceUSDC }, ...]
```

### Get a single prompt

```typescript
const prompt = await client.getPrompt("64abc123def456");
console.log(prompt.title, prompt.priceUSDC);
```

---

## Buying a License

PromptHash uses a two-step flow: the buyer submits a Stellar transaction on-chain, then records it with the backend to claim their license.

```typescript
import {
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const server = new Server("https://soroban-testnet.stellar.org");
const buyerKeypair = Keypair.fromSecret("S...");

// 1. Build and submit the on-chain purchase transaction
// (Exact call depends on the PromptHash contract ABI — see contracts/prompt_hash)
const txHash = await submitOnChainPurchase(promptId, buyerKeypair);

// 2. Record the purchase with the backend
const result = await client.recordPurchase(promptId, buyerKeypair.publicKey(), txHash);
if (result.success) {
  console.log("License granted!");
}
```

---

## Verifying License Ownership

Before showing a buyer the decrypted prompt content, verify they hold a license:

```typescript
const licensed = await client.hasLicense(promptId, buyerWallet);
if (!licensed) {
  throw new Error("Unlicensed access");
}
// Proceed with unlock flow
```

---

## License Verification Flow (Unlock Service)

The full license verification challenge-response flow:

```
1. Client calls GET /api/unlock/:promptId?wallet=G... → receives { nonce }
2. Client signs the nonce with Freighter wallet
3. Client calls POST /api/unlock/:promptId → { signature, wallet }
4. Server verifies signature against on-chain purchase record
5. Server returns the decryption key (valid for 60 seconds)
6. Client decrypts prompt content in-browser
```

---

## Community Voting (Governance)

```typescript
// Cast an upvote (buyer wallets only)
const voteResult = await client.upvote(promptId, buyerWallet);
console.log("Total upvotes:", voteResult.upvotes);

// Get top-ranked prompts
const top = await client.getTopPrompts(10);
console.log(top); // [{ promptId, upvotes }, ...]
```

---

## REST API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/prompts` | List prompts (`?page=1&limit=20&sort=upvotes`) |
| `GET` | `/api/prompts/:id` | Get prompt by ID |
| `POST` | `/api/prompts/:id/purchase` | Record a purchase |
| `GET` | `/api/prompts/:id/license` | Check license (`?wallet=G...`) |
| `GET` | `/api/unlock/:id` | Get challenge nonce |
| `POST` | `/api/unlock/:id` | Submit signed challenge, receive key |
| `POST` | `/api/governance/vote/:id` | Cast upvote |
| `DELETE` | `/api/governance/vote/:id` | Remove upvote |
| `GET` | `/api/governance/votes/:id` | Get vote count |
| `GET` | `/api/governance/top` | Top-ranked prompts |

Full OpenAPI spec: [docs/api-reference.md](./api-reference.md)

---

## Error Handling

All SDK methods throw typed errors. The REST API returns `{ error: string }` with appropriate HTTP status codes:

- `400` — Missing or invalid parameters
- `403` — Not authorised (e.g. non-buyer attempting to vote)
- `404` — Resource not found
- `409` — Conflict (e.g. duplicate vote)

---

## TypeScript Types

```typescript
import type { PromptInfo, PurchaseResult, ClientConfig } from "@prompthash/sdk";
```
