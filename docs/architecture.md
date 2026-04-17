# PromptHash Stellar Architecture

## System Components

PromptHash Stellar uses a three-layer architecture that keeps commercial state on Soroban, encryption in the client, and plaintext release behind a wallet-authenticated unlock service.

## 1. Soroban Contract Layer

Path: `contracts/prompt-hash`

Responsibilities:

- persist prompt listing records
- route XLM payments and platform fees
- record creator and buyer indexes
- expose contract reads for marketplace and access queries
- support administrative fee updates and contract upgrades

Key methods currently implemented:

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

## 2. Frontend Application Layer

Path: `src`

Responsibilities:

- connect Stellar wallets
- encrypt prompt plaintext before submission
- submit Soroban transactions for creation and purchase
- render browse, seller, and buyer views
- initiate the unlock challenge flow

Key modules:

- `src/pages/sell/CreatePromptForm.tsx`
- `src/pages/sell/MyPrompts.tsx`
- `src/pages/browse/PromptModal.tsx`
- `src/lib/stellar/promptHashClient.ts`
- `src/lib/crypto/promptCrypto.ts`
- `src/lib/auth/challenge.ts`

## 3. Unlock And Auth Layer

Paths:

- `api/auth/challenge.ts`
- `api/prompts/unlock.ts`

Responsibilities:

- create short-lived unlock challenges
- verify signed challenge messages
- confirm purchase rights through `has_access`
- unwrap the encrypted prompt key
- decrypt the ciphertext and validate the stored content hash

## Data Flow

### Create Listing

1. Creator enters listing metadata and plaintext prompt content.
2. Browser generates an AES key and encrypts the prompt locally.
3. Browser wraps the AES key with the unlock service public key.
4. Frontend calls `create_prompt` with encrypted content, metadata, and price.

### Buy Listing

1. Buyer selects a listing and authorizes native asset spend.
2. Frontend calls `buy_prompt`.
3. Contract transfers the seller amount and the platform fee in stroops.
4. Contract records the buyer entitlement.

### Unlock Purchased Prompt

1. Buyer requests a challenge token for a prompt ID.
2. Buyer signs the challenge message with the wallet.
3. Unlock endpoint verifies token validity, signature, and on-chain access.
4. Service decrypts the payload and returns plaintext if the integrity check succeeds.

## Security Model

The current design separates payment, rights, and delivery:

- encrypted payloads are stored on-chain rather than plaintext
- the browser performs the initial encryption step
- the unlock service only releases plaintext after wallet proof and contract proof both succeed

Operational assumptions:

- the unlock private key must be kept secret
- the challenge secret must be rotated and stored securely
- network configuration and contract IDs must match the deployment environment

## Scalability Notes

The current read path pulls listing data directly from contract methods. That is acceptable for demo and submission environments, but a larger deployment will likely require:

- indexing and caching
- pagination and more selective reads
- search infrastructure
- moderation and abuse handling

## Deployment Shape

The current repo is structured for a lightweight deployment:

- Vite frontend and serverless API handlers
- Soroban contract deployed to Stellar testnet today and mainnet later
- optional `server/` workspace for auxiliary integrations
