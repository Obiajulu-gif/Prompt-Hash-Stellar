# Contributor diagnostics

One command verifies a local checkout: tooling, dependencies, environment config, seed/fixture data, and the external services the app assumes.

```bash
yarn diagnose                 # full run, including network probes
yarn diagnose --offline       # skip all network probes
yarn diagnose --json          # machine-readable report
yarn diagnose --strict        # warnings fail too (CI)
yarn diagnose --fix           # safe fixes only (see below)
yarn diagnose --verbose       # also list passing checks
```

Exit code is `0` when there are no failures, `1` otherwise. Secret values are never printed; only key names and reasons.

`yarn check:setup` remains the fast pre-build gate. `yarn diagnose` is the deeper, contributor-facing superset.

## What is checked

| Group | Checks |
|-------|--------|
| tooling | Node 22+, Yarn 4+, Rust + `wasm32-unknown-unknown`, Stellar CLI, git identity |
| dependencies | `node_modules`, `server/node_modules`, `yarn.lock` |
| env | required vars set and not placeholders, address/URL/base64 formats, network ↔ passphrase, RPC/Horizon host ↔ network, `PUBLIC_UNLOCK_PUBLIC_KEY` = `UNLOCK_PUBLIC_KEY`, RPC quorum range, `.env.example` secret reuse |
| seed | prompt/failure fixtures, ABI fixture is valid JSON, preview seed script keeps its production guardrail, environment would not block seeding |
| network | Soroban RPC `getHealth` + `getNetwork`, Horizon root + passphrase, MongoDB/Redis TCP reachability (if configured), chat gateway (if configured) |

Env values are read from `.env`, then `server/.env`, then the process environment (same precedence as `check:setup`).

## Failure modes and fixes

Every warning/failure prints a `→` fix. The catalog lives in `FIXES` in `scripts/contributor-diagnostics.mjs`.

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `PUBLIC_STELLAR_NETWORK_PASSPHRASE does not match` | Copied testnet passphrase into a mainnet config (or vice versa) | Use the passphrase block matching your network in `.env.example` |
| `RPC/Horizon serves a different network than configured` | URL and passphrase disagree; wallet signs for the wrong network and transactions are rejected | Fix whichever side is wrong; never sign until this is green |
| `points at TESTNET but PUBLIC_STELLAR_NETWORK is PUBLIC` | Half-migrated env switch | Switch all four network vars together |
| `PUBLIC_UNLOCK_PUBLIC_KEY differs from UNLOCK_PUBLIC_KEY` | Keypair rotated on one side only; unlock verification fails for buyers | Align both; see `docs/secret-rotation.md` |
| `secret(s) still use .env.example defaults` | Example secrets reused | Warning locally, **failure on PUBLIC network**. Generate unique secrets |
| `Soroban RPC unreachable` | Outage, VPN/firewall, 5s timeout | Retry, check status.stellar.org, or switch `PUBLIC_STELLAR_RPC_URL` |
| `Horizon unreachable` | Warning only; balances degrade, purchases do not | Retry or switch Horizon URL |
| `MongoDB unreachable` | Container not running | `docker compose up -d mongo` |
| `preview seed script lost its production guardrail` | `seedPreview.mjs` edited/merged badly | Restore from git; never seed without the guardrail |
| `yarn seed:preview will refuse to run` | `APP_ENV`/`VERCEL_ENV`/`NODE_ENV` is production-like | Unset it; see `docs/operations/preview-seed-data.md` |

## Edge cases

- **Offline / air-gapped**: use `--offline`; network checks report `skip`, which never fails the run.
- **Slow networks**: each probe times out after 5 seconds and reports a timeout instead of hanging.
- **Placeholder contract ID**: `C` followed by 55 `A`s (shipped in `.env.example`) is treated as unset, so a fresh clone fails until a contract is deployed (`./scripts/deploy.sh`).
- **`MAINNET`** is rejected: the frontend schema only accepts `PUBLIC`, `FUTURENET`, `TESTNET`, `LOCAL` (and deprecated `STANDALONE`).
- **Self-hosted RPC** with a neutral hostname cannot be classified from the URL; the `getNetwork` passphrase probe still catches a mismatch.
- **Ledger-level checks** (contract actually deployed, account funded) are intentionally out of scope; use `yarn verify:smoke`.

## Rollback and recovery

`--fix` is deliberately narrow: it only copies `.env.example` to `.env` when `.env` does not exist, and never overwrites. To undo, delete `.env`. The command reads files and makes read-only network calls; it writes nothing else, so there is no state to roll back.

If the diagnostics themselves misbehave (for example a new required variable not yet in the catalog), fall back to `yarn check:setup`, and revert the change to `scripts/contributor-diagnostics.mjs`. The command is not part of `prebuild`, so a bug in it cannot block builds.

## Tests

`src/test/contributorDiagnostics.test.ts` covers each check group with injected `fetch`, command runner, and TCP probe, so it runs offline in `yarn test`.

Run `yarn diagnose --help` for accepted flags. Invalid options exit with code 2 before any checks or writes. If another process creates `.env` while `--fix` is running, diagnostics leave that file intact and continue.
