# Contributing & Local Setup — Prompt-Hash-Stellar

Welcome! Thanks for wanting to contribute. This guide helps you get the repo running locally (frontend + Soroban contracts) quickly and safely.

Table of contents
- Prerequisites
- Quick checks
- Step-by-step setup
- Environment variables (.env.example)
- Run the app & contracts
- Project structure overview
- Testing
- How to contribute (PRs, style, tests)

---

## 1) Prerequisites (install these first)

- **Node.js** — LTS (recommended v18+)
  - Check: `node -v`
- **A package manager** — npm (comes with Node), or yarn, or pnpm (optional)
  - Check: `npm -v` or `yarn -v` or `pnpm -v`
- **Rust toolchain (stable)** and cargo
  - Check: `rustc --version` and `cargo --version`
- **Soroban CLI** (for Soroban contract tooling)
  - Install: `cargo install --locked soroban-cli` (see Soroban docs)
  - Check: `soroban --version`
- (Recommended for wallet integration/testing) **Freighter Wallet** browser extension or equivalent Stellar wallet
- **Git**

---

## 2) Quick checks

Run these to confirm environment is ready:

```bash
node -v
npm -v        # or yarn -v / pnpm -v
rustc --version
cargo --version
soroban --version
git --version
```

If any command is missing, follow the relevant official install docs (Node, Rust, Soroban).

---

## 3) Step-by-step local setup

1. Clone the repository
   ```bash
   git clone https://github.com/0xSlink/Prompt-Hash-Stellar.git
   cd Prompt-Hash-Stellar
   ```

2. Install frontend dependencies
   - Using npm:
     ```bash
     npm install
     ```
   - Or with pnpm:
     ```bash
     pnpm install
     ```
   - Or yarn:
     ```bash
     yarn install
     ```

3. Contracts toolchain (build & test)
   ```bash
   cd contracts/prompt-hash
   # build wasm
   cargo build --release
   # run contract unit tests (requires cargo + soroban dev dependencies)
   cargo test
   cd ../..
   ```

4. Create environment file
   - Copy example and fill secrets:
     ```bash
     cp .env.example .env
     ```
   - See the `.env.example` section below for schema.

5. Start the dev server (frontend)
   ```bash
   # from repo root
   npm run dev
   # or
   pnpm dev
   # or
   yarn dev
   ```
   Open http://localhost:3000

6. Optional: run a local Soroban node or use testnet
   - If you want full local integration testing, follow Soroban docs to run a local network or target `testnet` RPC via `SOROBAN_RPC_URL`.

---

## 4) Example `.env.example` schema

Create `.env` from `.env.example`. **Never commit secrets.**

```env
# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_APP_ENV=development

# Soroban / Stellar
SOROBAN_RPC_URL=https://rpc.testnet.soroban.stellar.org
SOROBAN_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=${SOROBAN_RPC_URL}

# Wallet / App keys (for local testing only — DO NOT COMMIT)
# DEPLOYER_SECRET should be kept private. Use key management or .env on developers' machines only.
DEPLOYER_SECRET=<ed25519-secret>
ADMIN_ADDRESS=<G... stellar address>

# Optional analytic or 3rd party keys
# EXAMPLE: SENTRY_DSN=...
```

---

## 5) Project structure (quick map)

Root overview (trimmed):

```
/ (repo root)
├─ src/                         # Next.js frontend
│  ├─ pages/                    # Pages router (page components)
│  │  ├─ prompts/[id].tsx       # Prompt preview page (new)
│  │  └─ ...                    # other pages
│  ├─ components/               # Reusable React components (PurchaseProgress, UI)
│  └─ styles/                   # Tailwind / global styles
├─ contracts/                   # Soroban smart contracts (Rust)
│  └─ prompt-hash/
│     ├─ src/                   # Rust contract source, storage, events, tests
│     ├─ Cargo.toml
│     └─ tests/                 # Contract tests (unit)
├─ package.json                 # Frontend scripts & dependencies
├─ Cargo.toml (workspace)       # Rust workspace config
├─ .env.example                 # Example env file
└─ README.md
```

Folder descriptions (1-line):
- `/src/pages` — Next.js pages (routing). Add route files here.
- `/src/components` — UI components (PurchaseProgress modal, Prompt card).
- `/contracts` — Rust/Soroban contracts and tests. Build and test with `cargo`.
- `/scripts` — utility scripts (if present).
- `.github/` — CI, PR templates, issue templates.

---

## 6) Testing

- Frontend unit / integration tests (if present):
  ```bash
  npm test        # or yarn test / pnpm test
  ```

- Contract tests:
  ```bash
  cd contracts/prompt-hash
  cargo test
  ```

- Lint / format:
  - Frontend: `npm run lint` / `npm run format`
  - Rust: `cargo fmt` / `cargo clippy`

---

## 7) How to contribute (PR checklist)

When opening a PR:
- Create a feature branch off `main` (or `develop` if used): `git checkout -b feat/your-feature`
- Keep commits focused & atomic.
- Add or update tests for new logic (frontend unit tests / contract tests).
- Run linters & formatters locally.
- Update docs (if new behavior or env vars).
- In PR description: explain what you changed, why, and how to test manually.
- Tag reviewers and add an issue reference if applicable.

---

## 8) Security & best practices

- **Never** commit secrets or private keys. Use `.env` locally and add `.env` to `.gitignore`.
- Use a hardware wallet / Freighter for real transactions.
- Prefer testnet for development and manual testing.

---

## 9) Need help?

- Open an issue with the `help wanted` label.
- Join the project discussions or ping maintainers in the issue/PR.

Thanks for contributing — your help makes Prompt-Hash-Stellar better!
