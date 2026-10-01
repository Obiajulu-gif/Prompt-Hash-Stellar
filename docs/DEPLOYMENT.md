# Deployment Guide

This document is the top-level deployment reference for Prompt Hash Stellar.
It consolidates pointers to per-environment runbooks, configuration requirements,
and the platform limits that operators must understand before going live.

For the full step-by-step mainnet procedure see
[`docs/operations/mainnet-deployment.md`](operations/mainnet-deployment.md).

---

## Quick-reference: deployment checklist

Before promoting any environment to production, verify each of the following:

- [ ] All required `PUBLIC_*` environment variables are set and pass `yarn check:setup`
- [ ] `PUBLIC_STELLAR_NETWORK` is explicitly `PUBLIC` (not `TESTNET` or `LOCAL`)
- [ ] `PUBLIC_PROMPT_HASH_CONTRACT_ID` is a deployed, initialized contract (`C…` 56 chars)
- [ ] `CHALLENGE_TOKEN_SECRET` is a cryptographically random string (≥ 32 bytes), not the placeholder from `.env.example`
- [ ] `UNLOCK_PUBLIC_KEY` / `UNLOCK_PRIVATE_KEY` are a freshly generated NaCl keypair, not the base64 dummy values
- [ ] `RECEIPT_SIGNING_PUBLIC_KEY` / `RECEIPT_SIGNING_PRIVATE_KEY` are a real Ed25519 keypair
- [ ] `server/.env` is configured if the draft/buyer MongoDB API is in use (`MONGODB_URI` is set and reachable)
- [ ] TTL readiness check passes: `node scripts/check-ttl-readiness.mjs` exits `0`
- [ ] Contract preflight passes: `python3 scripts/preflight_upgrade.py check` exits `0`
- [ ] `yarn build` succeeds (runs `check:policy` and `check:setup` as prebuild gates)

> **Fail-fast guarantee**: `src/lib/env.ts` validates all nine `PUBLIC_*` frontend
> variables via a Zod schema at build time. In production mode, any missing or
> invalid variable causes an immediate parse error — the build will not produce
> an artifact and the server will not start. There is no silent fallback to
> testnet defaults in production.

---

## Environment-specific guides

| Environment | Guide |
|-------------|-------|
| Mainnet | [`docs/operations/mainnet-deployment.md`](operations/mainnet-deployment.md) |
| Testnet / local dev | [`docs/environments.md`](environments.md) |
| Contract upgrades | [`docs/operations/contract-upgrades.md`](operations/contract-upgrades.md) |
| Secret rotation | [`docs/secret-rotation.md`](secret-rotation.md) |
| TTL renewal | [`docs/ttl-renewal-operations.md`](ttl-renewal-operations.md) |

---

## Platform limits operators must review before go-live

All caps, quotas, and rate limits enforced by the platform are documented in
**[`docs/limits.md`](limits.md)**. The sections most relevant to deployment are:

### On-chain supply caps

Each listing's `max_supply` field is the only enforced cap on units sold for that
listing today. The contract constants — `DEFAULT_FEE_BPS = 500` (5 % platform
fee), `MAX_PLATFORM_FEE = 1 000` (10 % ceiling), and `MAX_BULK_PURCHASE_SIZE = 20`
— are compiled into the binary and cannot be changed without a contract upgrade.

See [`docs/limits.md § 1`](limits.md#1-on-chain-supply-caps-per-listing) and
[`docs/limits.md § 2`](limits.md#2-on-chain-contract-constants).

### Planned global volume cap (not yet live)

The `set_global_volume_cap` and `get_global_volume_cap` contract functions are
**not yet implemented**. Calling them will fail. The effective global cap is
currently unbounded — per-listing `max_supply` is the sole ceiling.

When this feature lands the section above will be updated with the exact contract
version, the `ContractConfig` struct shape, and any required `MIGRATION.md`
acknowledgement. Do not configure a global cap expecting enforcement until that
update is published.

See [`docs/limits.md § 3`](limits.md#3-planned-operator-level-global-volume-cap).

### Server-side quotas and HTTP rate limits

The TypeScript server enforces storage, compute, and external-API quotas via
`PolicyLimitService` (9 operations with per-actor windowed or size-based limits)
and a separate set of HTTP-layer rate limiters (9 named limiters keyed by wallet
address or IP). Both systems support in-memory operation with optional Redis
backing (`REDIS_URL`).

See [`docs/limits.md § 4`](limits.md#4-server-side-expensive-operation-quotas)
and [`docs/limits.md § 5`](limits.md#5-http-layer-rate-limiters).

---

## Configuration validation

Run any of these at any time to validate the deployment configuration:

```bash
# Check all required env vars are present and valid (exits 1 on failure)
yarn check:setup

# Scan for production policy violations — stubs, mocks, testnet fallbacks
yarn check:policy

# Both checks run automatically as a prebuild gate
yarn build
```

The server also exposes a non-sensitive readiness attestation at runtime:

```http
GET /api/readiness
```

```json
{
  "ready": true,
  "network": "PUBLIC",
  "manifestHash": "a1b2c3d4e5f67890",
  "promptHashContractId": "CB...",
  "nativeAssetContractId": "CD...",
  "simulationAccount": "GA...",
  "timestamp": 1785305900000
}
```

`ready: false` means one or more chain-critical variables (`PUBLIC_STELLAR_NETWORK`,
`PUBLIC_STELLAR_RPC_URL`, `PUBLIC_PROMPT_HASH_CONTRACT_ID`, etc.) are missing,
contain a placeholder value, or do not match the expected network. The server
rejects all non-health requests until this is resolved.

---

## Related documents

- [`docs/limits.md`](limits.md) — all enforced caps and quotas
- [`docs/environments.md`](environments.md) — full variable matrix by environment
- [`docs/security-model.md`](security-model.md) — trust boundaries and threat model
- [`docs/DOMAIN_INVARIANTS.md`](DOMAIN_INVARIANTS.md) — invariants the contract upholds
- [`contracts/prompt-hash/MIGRATION.md`](../contracts/prompt-hash/MIGRATION.md) — breaking-change log
