# PromptHash Stellar Architecture

## System Components

PromptHash Stellar is organized into three main layers.

## 1. Soroban Contract Layer

Path: `contracts/prompt-hash`

Responsibilities:

- store prompt listing records
- track creator-owned listings
- track buyer purchase rights
- route XLM payments and platform fees
- expose read methods for marketplace views

Core contract methods:

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
- `pause`
- `unpause`
- `is_paused`

## 2. Frontend Application Layer

Path: `src`

Responsibilities:

- wallet connection and transaction signing
- client-side encryption before contract submission
- marketplace browsing and filtering
- creator listing management
- buyer unlock initiation

Important modules:

- `src/pages/sell/CreatePromptForm.tsx`
- `src/pages/browse/PromptModal.tsx`
- `src/pages/sell/MyPrompts.tsx`
- `src/lib/stellar/promptHashClient.ts`
- `src/lib/crypto/promptCrypto.ts`

## 3. Unlock / Auth Layer

Paths:

- `api/auth/challenge.ts`
- `api/prompts/unlock.ts`

Responsibilities:

- mint challenge tokens
- verify wallet signature on unlock requests
- read contract access state
- unwrap the encrypted AES key
- decrypt the prompt payload
- validate content integrity by hash

## Data Flow

### Create listing

1. User enters title, preview, category, image URL, price, and full prompt text.
2. Browser encrypts prompt plaintext with AES-GCM.
3. Browser wraps the AES key using the unlock service public key.
4. App submits the encrypted payload and metadata to Soroban.

### Buy listing

1. Buyer approves native asset spend.
2. App submits `buy_prompt`.
3. Contract moves seller and fee amounts in stroops.
4. Contract records purchase rights for the buyer.

### Unlock purchased prompt

1. Buyer requests a challenge token for a specific prompt.
2. Wallet signs the challenge message.
3. Unlock endpoint verifies token, signature, and `has_access`.
4. Service decrypts prompt plaintext and returns it to the buyer.

## Security Model

The current design intentionally separates concerns:

- Soroban stores encrypted prompt content and access state
- the browser performs initial prompt encryption
- the server only releases plaintext after both wallet proof and contract proof succeed

Important assumptions:

- the unlock service private key must remain secret
- the challenge secret must be rotated and stored securely
- contract IDs and network settings must be configured correctly per environment

### Circuit Breaker (Emergency Pause)

The contract includes a global pause mechanism controlled by the admin authority.

When paused:

- `buy_prompt`, `create_prompt`, `set_prompt_sale_status`, and `update_prompt_price` return `Error::ContractPaused` (code 19)
- Read-only methods (`get_prompt`, `get_all_prompts`, `has_access`, etc.) continue to work
- Admin operations (`set_fee_percentage`, `set_fee_wallet`, `upgrade`) remain callable so the admin can reconfigure or deploy fixes during an incident
- `ProtocolPaused` and `ProtocolUnpaused` events are emitted for indexer and monitoring consumption

The pause flag is stored in instance storage (not persistent) since it is a global singleton tied to the contract instance.

## Scalability Notes

The current frontend reads marketplace data directly from contract methods. This is acceptable for early-stage demos and review environments, but a production deployment will likely need:

- indexing and caching
- pagination
- search infrastructure
- moderation and abuse handling

## Deployment Shape

The current repository supports a lightweight deployment model:

- frontend + serverless unlock endpoints on Vercel
- contract deployed to Stellar testnet or future mainnet target
- optional auxiliary Express server for external chat/proxy services
