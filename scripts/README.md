# Soroban Deployment & Upgrade Scripts

This directory contains scripts to automate the deployment, initialization, and upgrade of the `PromptHash` contract.

## Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup#install-the-stellar-cli) installed.
- Rust and Soroban target installed (`rustup target add wasm32-unknown-unknown`).

## Scripts

### 1. `deploy.sh`
Deploys and initializes the contract to a specified network. It also automatically updates your `.env` and `.env.local` files.

**Usage:**
```bash
# Deploy to testnet (default)
./scripts/deploy.sh

# Deploy to local network
./scripts/deploy.sh local
```

**Environment Variables:**
- `NETWORK`: Target network (`testnet`, `local`). Defaults to `testnet`.
- `ADMIN_ALIAS`: Alias for the admin identity. Defaults to `admin`.
- `FEE_WALLET_ALIAS`: Alias for the fee wallet identity. Defaults to `fee_wallet`.

### 2. `upgrade.sh`
Upgrades an existing contract instance with a new Wasm version.

**Usage:**
```bash
# Upgrade on testnet
./scripts/upgrade.sh

# Upgrade on local
./scripts/upgrade.sh local
```

**Note:** Ensure `CONTRACT_ID` is set in your `.env` file or passed as an environment variable.

### 3. `verify.sh`
Performs a comprehensive check of the deployed contract's configuration (owner, fee settings, XLM SAC, etc.).

**Usage:**
```bash
./scripts/verify.sh local
```

### 4. `preflight_upgrade.py`
Blocks network-affecting upgrades on unacknowledged breaking interface changes. See `docs/operations/contract-upgrades.md` and `contracts/prompt-hash/MIGRATION.md`.

### 5. `dry-run-migration.py` (#712)
Previews the storage-migration effect of an upgrade **without writing state**:
classifies the pending diff as `no-op`/`additive`/`incompatible` and reports
affected key families, expected writes, TTL implications, and rollback notes.

```bash
python3 scripts/dry-run-migration.py report          # human-readable
python3 scripts/dry-run-migration.py report --json   # machine-readable
python3 scripts/dry-run-migration.py self-test       # classifier coverage
```

## Environment Consistency

The `deploy.sh` script synchronizes the following variables across `.env` and `.env.local`:
- `PUBLIC_STELLAR_NETWORK`
- `PUBLIC_STELLAR_NETWORK_PASSPHRASE`
- `PUBLIC_STELLAR_RPC_URL`
- `PUBLIC_PROMPT_HASH_CONTRACT_ID`
- `PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID`

This ensures that the frontend and backend are always pointing to the correct contract instance.

## Upgrade Flow Assumptions

- The `upgrade` function can only be called by the current contract owner.
- The new Wasm hash must be installed on the network first (handled by the script).
- Contract state is preserved during the upgrade.
