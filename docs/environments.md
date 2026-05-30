# Environment Setup Guide

PromptHash Stellar uses a **root `.env`** for the frontend and serverless unlock API, **`environments.toml`** for Soroban contract tooling, and an optional **`server/.env`** for the MongoDB-backed API.

Run the validator at any time:

```bash
yarn check:setup
```

It never prints secret values — only whether each variable is set and valid.

---

## Quick start (local development)

```bash
cp .env.example .env
# Fill in contract ID, simulation account, and unlock keys after deploy
cp server/.env.example server/.env   # if using draft/buyer API features
yarn check:setup
yarn dev
```

---

## Environment matrix

| Variable group | Local dev | Testnet | Preview (Vercel) |
|----------------|-----------|---------|-------------------|
| `PUBLIC_STELLAR_NETWORK` | `TESTNET` or `LOCAL` | `TESTNET` | `TESTNET` |
| `PUBLIC_STELLAR_RPC_URL` | testnet or `http://localhost:8000/soroban/rpc` | `https://soroban-testnet.stellar.org` | testnet RPC |
| `PUBLIC_PROMPT_HASH_CONTRACT_ID` | from `yarn deploy` / `.stellar` artifacts | deployed testnet contract | preview deploy ID |
| `CHALLENGE_TOKEN_SECRET` | long random string | platform secret | Vercel env secret |
| `UNLOCK_*` keys | base64 NaCl keypair | production unlock keys | preview keys |
| `MONGODB_URI` | local MongoDB | Atlas / hosted URI | preview DB URI |
| `STELLAR_SCAFFOLD_ENV` | `development` | `staging` or `testing` | `staging` |

### Local

- Frontend: `yarn dev` (Vite on port 5173)
- Contract: `stellar scaffold build` / `scripts/deploy.sh` with `STELLAR_SCAFFOLD_ENV=development`
- Unlock API: Vercel dev or local serverless emulator with root `.env`
- Optional backend: `cd server && npm run dev` with `server/.env`

### Testnet

- Set all `PUBLIC_STELLAR_*` URLs to testnet endpoints (see `.env.example`)
- Deploy contract to testnet and copy `PUBLIC_PROMPT_HASH_CONTRACT_ID` into `.env`
- Generate unlock keypair; set matching `PUBLIC_UNLOCK_PUBLIC_KEY` (frontend) and `UNLOCK_PUBLIC_KEY` / `UNLOCK_PRIVATE_KEY` (serverless)
- Use a hosted `MONGODB_URI` if running the auxiliary server

### Preview (Vercel)

- Configure the same variables in the Vercel project **Environment Variables** panel for **Preview**
- `PUBLIC_CHAT_API_BASE` can point to a staging gateway
- `CHALLENGE_TOKEN_SECRET` must be unique per preview environment
- Contract ID should match the preview/testnet deployment used by that branch

---

## Required variables

### Frontend (`PUBLIC_*`)

| Variable | Required | Notes |
|----------|----------|-------|
| `PUBLIC_STELLAR_NETWORK` | Yes | `TESTNET`, `MAINNET`, or `LOCAL` |
| `PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Yes | Must match RPC network |
| `PUBLIC_STELLAR_RPC_URL` | Yes | Soroban RPC endpoint |
| `PUBLIC_STELLAR_HORIZON_URL` | Yes | Horizon endpoint |
| `PUBLIC_PROMPT_HASH_CONTRACT_ID` | Yes | 56-char contract ID (`C…`) |
| `PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID` | Yes | Native XLM SAC ID |
| `PUBLIC_STELLAR_SIMULATION_ACCOUNT` | Yes | `G…` account for read simulation |
| `PUBLIC_UNLOCK_PUBLIC_KEY` | Yes | Base64 public key for key wrapping |

### Serverless unlock API

| Variable | Required | Notes |
|----------|----------|-------|
| `CHALLENGE_TOKEN_SECRET` | Yes | HMAC secret for challenge tokens |
| `UNLOCK_PUBLIC_KEY` | Yes | Must match `PUBLIC_UNLOCK_PUBLIC_KEY` |
| `UNLOCK_PRIVATE_KEY` | Yes | Base64 private key for unwrap |

### Contract tooling

| Variable / file | Required | Notes |
|-----------------|----------|-------|
| `STELLAR_SCAFFOLD_ENV` | Yes | `development`, `testing`, or `staging` |
| `XDG_CONFIG_HOME` | Yes | Usually `.config` |
| `environments.toml` | Yes | Network + contract scaffold config |
| Stellar CLI | Recommended | `stellar --version` |

### Optional

| Variable | Used by |
|----------|---------|
| `PUBLIC_CHAT_API_BASE` | Chat UI |
| `REDIS_URL` | Rate limiting (in-memory fallback) |
| `ADMIN_ROTATION_TOKEN` | Secret rotation admin |
| `CHALLENGE_TOKEN_SECRET_PREVIOUS` | Rotation grace period |
| `MONGODB_URI` | `server/` draft & buyer APIs |

---

## Validation hooks

```bash
yarn check:setup          # strict — exits 1 on missing required vars
yarn check:setup --warn-only   # never exits 1 (used before dev)
yarn build                # runs check:setup via prebuild
```

CI runs `yarn check:setup` on pull requests (see `.github/workflows/frontend.yml`).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `PUBLIC_PROMPT_HASH_CONTRACT_ID still has a placeholder` | Run deploy script or paste deployed contract ID |
| `UNLOCK_PUBLIC_KEY invalid format` | Generate base64 NaCl keypair; see `docs/secret-rotation.md` |
| `Missing keys from .env.example` | Add any keys listed by `yarn check:setup` |
| `environments.toml not found` | Ensure repo root checkout is complete |
| Draft/buyer API 500 | Set `MONGODB_URI` in `server/.env` and start MongoDB |
