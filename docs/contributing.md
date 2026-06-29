# Contributor Local Development Guide

This guide documents the local setup required to work on the PromptHash Stellar frontend, Soroban contract, and serverless unlock endpoints.

## Prerequisites

Install these tools before running the project locally:

- **Node.js 22 or newer** for the Vite React application and serverless API tests.
- **Yarn 4.x** through Corepack. Run `corepack enable` and let Yarn use the version pinned in `package.json`.
- **Rust 1.89.0** through rustup. The repository pins this toolchain in `rust-toolchain.toml`.
- **wasm32v1-none Rust target** for Soroban-compatible builds: `rustup target add wasm32v1-none`.
- **Stellar CLI with Soroban support** for contract build/deploy workflows and local network operations.
- **GitHub-compatible shell environment** such as bash, zsh, WSL, or a Linux/macOS terminal.

You can run `yarn check:setup` after installing dependencies to validate local tools and required environment variables without printing secret values.

## Install dependencies

From the repository root:

```bash
yarn install
```

The optional Express workspace under `server/` has its own npm lockfile:

```bash
cd server
npm install
cd ..
```

## Environment variables

Create a local environment file from the checked-in template:

```bash
cp .env.example .env
```

Fill in the values below before running the frontend or unlock endpoints:

| Variable                                  | Required for         | Notes                                                                                         |
| ----------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| `STELLAR_SCAFFOLD_ENV`                    | contract tooling     | Use `development` locally unless you have a custom Soroban scaffold environment.              |
| `XDG_CONFIG_HOME`                         | contract tooling     | Defaults to `.config` in the template to keep local Stellar config inside the repo workspace. |
| `PUBLIC_STELLAR_NETWORK`                  | frontend, unlock API | Usually `TESTNET` for contributor development.                                                |
| `PUBLIC_STELLAR_NETWORK_PASSPHRASE`       | frontend, unlock API | Must match the selected Stellar network.                                                      |
| `PUBLIC_STELLAR_RPC_URL`                  | frontend, unlock API | Testnet default is `https://soroban-testnet.stellar.org`.                                     |
| `PUBLIC_STELLAR_HORIZON_URL`              | frontend             | Testnet default is `https://horizon-testnet.stellar.org`.                                     |
| `PUBLIC_PROMPT_HASH_CONTRACT_ID`          | frontend, unlock API | Set to the deployed prompt-hash Soroban contract ID you want to exercise.                     |
| `PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID` | frontend, unlock API | Native XLM SAC contract ID for the selected network.                                          |
| `PUBLIC_STELLAR_SIMULATION_ACCOUNT`       | frontend, unlock API | Public account used for read/simulation calls.                                                |
| `PUBLIC_UNLOCK_PUBLIC_KEY`                | frontend             | Public key paired with the unlock service encryption key.                                     |
| `CHALLENGE_TOKEN_SECRET`                  | unlock API           | Long random secret used to sign wallet-auth challenge tokens.                                 |
| `UNLOCK_PUBLIC_KEY`                       | unlock API           | Base64 public key for prompt key wrapping.                                                    |
| `UNLOCK_PRIVATE_KEY`                      | unlock API           | Base64 private key used by the serverless unlock endpoint to unwrap prompt keys.              |
| `REDIS_URL`                               | unlock API, optional | Enables shared rate limiting; when omitted, development falls back to in-memory limiting.     |

Never commit a populated `.env` file or real unlock private keys.

## Run the frontend locally

Start the Vite development server from the repository root:

```bash
yarn dev
```

The command runs `scripts/check-local-setup.mjs --warn-only` first, then starts Vite. Keep the browser wallet, contract ID, RPC URL, and selected network aligned; a testnet wallet cannot buy from a mainnet contract and vice versa.

Useful frontend validation commands:

```bash
yarn lint
yarn test:frontend --run api/prompts/unlock.test.ts src/lib/auth/challenge.test.ts src/lib/crypto/promptCrypto.test.ts
yarn build
```

## Run Soroban contract tests locally

Run the prompt-hash contract tests from the repository root:

```bash
cargo test -p prompt-hash
```

If contract dependencies or toolchains fail to resolve, confirm that rustup is using the pinned toolchain and that the target is installed:

```bash
rustup show
rustup target add wasm32v1-none
```

The contract tests use Soroban SDK test utilities and a mock asset contract, so they do not require a live Stellar RPC server.

## Configure and test unlock endpoints locally

The unlock service is implemented as Vercel-style serverless functions in `api/auth/challenge.ts` and `api/prompts/unlock.ts`.

1. Populate `.env` with the Stellar, challenge-token, and unlock key variables listed above.
2. Ensure `PUBLIC_PROMPT_HASH_CONTRACT_ID`, `PUBLIC_STELLAR_RPC_URL`, `PUBLIC_STELLAR_NETWORK_PASSPHRASE`, and `PUBLIC_STELLAR_SIMULATION_ACCOUNT` point at a contract/account that can answer `has_access` reads.
3. Run the API unit tests:

```bash
yarn test:frontend -- api/prompts/unlock.test.ts src/lib/auth/challenge.test.ts src/lib/crypto/promptCrypto.test.ts
```

4. For end-to-end manual testing, start the frontend with `yarn dev`, buy or seed access for a prompt on the configured network, then use the UI unlock flow. The endpoint verifies the challenge token, wallet signature, on-chain access, key unwrap, decryption, and content hash before returning plaintext.

## Troubleshooting

- **`yarn check:setup` reports placeholder environment values**: replace `CXXXX...`, `GXXXX...`, and `BASE64_...` placeholders in `.env` with real development values.
- **Vite starts but contract reads fail**: verify that `PUBLIC_STELLAR_NETWORK_PASSPHRASE`, `PUBLIC_STELLAR_RPC_URL`, and `PUBLIC_PROMPT_HASH_CONTRACT_ID` all reference the same network.
- **Wallet prompts never appear**: confirm your browser wallet is connected to the same Stellar network as `PUBLIC_STELLAR_NETWORK`.
- **Unlock returns unauthorized or access denied**: confirm the wallet that signs the challenge has purchased the prompt and that `PUBLIC_STELLAR_SIMULATION_ACCOUNT` can simulate contract reads.
- **Unlock decryption fails**: ensure `UNLOCK_PRIVATE_KEY` matches `PUBLIC_UNLOCK_PUBLIC_KEY` and the prompt was encrypted with the matching public key.
- **Contract tests fail after a Rust upgrade**: run `rustup override unset` from the repo if you have a conflicting local override, then retry with the pinned `rust-toolchain.toml`.

## Pull request checks

Every pull request is expected to pass the same checks that CI runs:

```bash
yarn lint
yarn test:frontend --run api/prompts/unlock.test.ts src/lib/auth/challenge.test.ts src/lib/crypto/promptCrypto.test.ts
yarn build
cargo test -p prompt-hash
```

Run the relevant subset locally before pushing, and run the full set when touching shared frontend, API, or contract code.
