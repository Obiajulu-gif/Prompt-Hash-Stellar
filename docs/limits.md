# Platform Limits and Quota Controls

This document describes every cap, quota, and rate limit enforced by Prompt Hash
Stellar — on-chain, server-side, and at the HTTP layer — so operators, creators,
and contributors can reason about what each value actually bounds and when it is
applied.

---

## Table of contents

1. [On-chain supply caps (per listing)](#1-on-chain-supply-caps-per-listing)
2. [On-chain contract constants](#2-on-chain-contract-constants)
3. [Planned: operator-level global volume cap](#3-planned-operator-level-global-volume-cap)
4. [Server-side expensive-operation quotas](#4-server-side-expensive-operation-quotas)
5. [HTTP-layer rate limiters](#5-http-layer-rate-limiters)
6. [Getter reference](#6-getter-reference)
7. [Wave-change note](#7-wave-change-note)

---

## 1. On-chain supply caps (per listing)

### What a cap bounds

A listing's `max_supply` field is the **total number of new access units** that
can ever be granted for that listing. Once `sales_count >= max_supply` the
contract refuses any further acquisition. A value of `0` means unlimited.

> **Example**: if a creator sets `max_supply = 100`, at most 100 distinct buyers
> can hold an active entitlement for that listing. Once the 100th sale is
> recorded the contract returns `Error::MaxSupplyReached` for every subsequent
> purchase attempt, regardless of price or buyer identity.

The same field exists on `Bundle` (bundles a set of prompts under one SKU) and
`AccessPass` (time-gated catalog access), each enforced identically.

### The effective cap rule

```
effective_cap = max_supply   (set by the creator per listing; 0 = unlimited)
```

There is currently **no contract-level global override** that can raise or lower
this value from outside the listing. The operator cannot silence or supersede a
creator's per-listing cap via any on-chain call that exists today (see
[§ 3](#3-planned-operator-level-global-volume-cap) for the planned addition).

### Enforcement point

Every acquisition path runs through the `reserve_supply` helper defined in
`contracts/prompt-hash/src/contract.rs` **before the payment token transfer**:

```rust
fn reserve_supply(sales_count: u64, max_supply: u64) -> Result<u64, Error> {
    if max_supply > 0 {
        ensure(sales_count < max_supply, Error::MaxSupplyReached)?;
    }
    sales_count.checked_add(1).ok_or(Error::ArithmeticOverflow)
}
```

The paths that call `reserve_supply` are:

| Call path | Notes |
|-----------|-------|
| `execute_buy` → `execute_buy_with_required_price` | Direct prompt purchase; called twice — fast-fail before voucher validation and again on a fresh fetch inside the reentrancy guard |
| `lease_prompt` | Timed-access lease |
| `buy_bundle` | Called per-prompt in the bundle |
| `buy_access_pass` | Uses `reserve_pass_supply` (same logic, `u32` counters) |

`transfer_license` (secondary-market resale) intentionally does **not** call
`reserve_supply`. A resale moves an already-reserved unit between owners; it
does not create a new entitlement.

### Lowering a cap after sales have started

`set_prompt_max_supply` enforces:

```rust
ensure(
    max_supply == 0 || max_supply >= prompt.sales_count,
    Error::MaxSupplyBelowCommitted,
)?;
```

A creator cannot set `max_supply` below the number of units already sold.
Setting it to `0` at any time re-opens unlimited sales.

---

## 2. On-chain contract constants

These values are compiled into the contract binary and cannot be changed without
a contract upgrade. They are listed here so operators know what "cannot be
configured away" means for each bound.

| Constant | Value | What it bounds |
|----------|-------|----------------|
| `DEFAULT_FEE_BPS` | `500` (5 %) | Initial platform fee applied at contract construction |
| `MAX_PLATFORM_FEE` | `1 000` (10 %) | Hard ceiling on `set_fee_percentage`; any stored fee above this is clamped by `migrate_platform_fee_bound` |
| `MAX_BPS` | `10 000` | Denominator for all basis-point calculations |
| `MAX_BULK_PURCHASE_SIZE` | `20` | Maximum number of prompt IDs accepted in a single `buy_prompts_bulk` call; prevents unbounded simulation cost per transaction |
| `MAX_SPLITS` | `10` | Maximum co-creator revenue-split recipients per listing |
| `MAX_TAGS` | `8` | Maximum search tags per listing |
| `MAX_BUNDLE_PROMPTS` | `20` | Maximum prompts in a single bundle |
| `MAX_ENCRYPTED_PROMPT_LEN` | `4 096` chars | On-chain ciphertext length (use IPFS off-chain path for larger payloads) |
| `MAX_TITLE_LEN` | `120` chars | Listing title |
| `MAX_PREVIEW_LEN` | `280` chars | Listing preview text |
| `DISPUTE_WINDOW_SECS` | `259 200` (3 days) | Window after purchase within which a buyer may open a dispute |

None of these are exposed via a getter; they are part of the compiled ABI. If any
value needs to change, follow the contract-upgrade procedure in
[`docs/operations/contract-upgrades.md`](operations/contract-upgrades.md) and
acknowledge the change in
[`contracts/prompt-hash/MIGRATION.md`](../contracts/prompt-hash/MIGRATION.md).

---

## 3. Planned: operator-level global volume cap

> **Status: not yet implemented.** The functions described in this section
> (`set_global_volume_cap`, `get_global_volume_cap`) do not exist in the current
> contract. This section documents the intended design so operators and
> contributors share a common mental model before the implementation lands.

### Motivation

Platform operators need a way to impose a ceiling on total units sold across all
listings — for example, to throttle a launch wave or to cap total platform
liability during a promotional period — without requiring every creator to update
their individual `max_supply`.

### Intended model

```
effective_cap_for_listing = min(listing.max_supply, global_volume_cap)
```

When `global_volume_cap > 0`, `reserve_supply` will use whichever limit is
smaller: the per-listing cap or the platform-wide override. A
`global_volume_cap` of `0` will mean "no platform override" (the per-listing
value is authoritative), preserving backward compatibility with existing listings
that already set `max_supply = 0` for unlimited sales.

### Const default

Until the implementation ships, the effective global cap is **unbounded**
(`u64::MAX`). The per-listing `max_supply` remains the sole enforced limit.
Setting a global cap via `set_global_volume_cap` before the contract fix lands
will have **no effect** — the override cannot be read by enforcement code that
does not yet exist.

Operators must not rely on `set_global_volume_cap` for real access control until
the corresponding contract change is merged and the deployment upgraded.

### Planned getters (post-implementation)

| Function | Storage scope | Returns |
|----------|--------------|---------|
| `get_global_volume_cap() -> u64` | Instance (contract-wide) | Active platform cap; `0` = no cap |
| `get_contract_config() -> ContractConfig` | Instance | Struct bundling fee percentage, fee wallet, XLM SAC address, pause state, referral percentage, and global volume cap |

`get_contract_config` will be a read-only convenience getter that aggregates all
`InstanceStorage` fields into one call, removing the need for multiple separate
RPC round-trips during operator dashboards and health probes.

---

## 4. Server-side expensive-operation quotas

The TypeScript server enforces quotas on operations with significant storage,
compute, or external-API cost via
`server/src/services/policyLimitService.ts` (`PolicyLimitService`).

### Override precedence

When evaluating whether a request is allowed, the service checks for an active
scoped override in this order, using the first match:

```
wallet  →  apiKey  →  ip  →  global  →  defaultLimit (from POLICIES table)
```

Overrides are time-bounded and audit-logged. A `global:*:<operation>` override
applies to all actors for that operation. Use `policyLimitService.addOverride()`
with `scopeType: "global"` to set one.

### Policy table

| Operation | Category | Default limit | Window | Type |
|-----------|----------|--------------|--------|------|
| `STORAGE_PROMPT_PAYLOAD` | Storage | 64 KB | — | Per-request size cap |
| `STORAGE_BULK_IMPORT` | Storage | 50 items | — | Per-request size cap |
| `INDEXING_REINDEX_CATALOG` | Indexing | 2 triggers | 1 hour | Rate |
| `INDEXING_DEEP_SEARCH` | Indexing | 500 records (offset) | — | Depth cap |
| `COMPUTE_AI_IMPROVE` | Compute | 10 calls | 15 min | Rate |
| `COMPUTE_SAFETY_SCAN` | Compute | 30 calls | 1 min | Rate |
| `COMPUTE_SIMILARITY_CHECK` | Compute | 20 calls | 1 min | Rate |
| `EXTERNAL_WEBHOOK_DELIVERY` | External | 60 dispatches | 1 min | Rate |
| `EXTERNAL_HORIZON_QUERY` | External | 120 calls | 1 min | Rate |

Size-cap operations (`isSizeLimit: true`) are evaluated against `costOrSize` in
a single call — there is no time window. Rate operations count per actor key
within the window and reset atomically when the window expires.

### Inspecting quota status (maintainers)

```typescript
import { policyLimitService } from "server/src/services/policyLimitService";

const status = policyLimitService.getStatus();
// { policies: PolicyDefinition[], activeOverrides: PolicyOverride[] }
```

To inspect quota usage for a specific actor and operation, call
`policyLimitService.evaluate({ operation, actor })` with read-only `costOrSize: 0`
to observe current window state without incrementing the counter. (Note: this is
a workaround until a dedicated `peek` method is added.)

---

## 5. HTTP-layer rate limiters

Defined in `server/src/middleware/rateLimiter.ts`. All limits are in-memory with
optional Redis backing (`REDIS_URL` environment variable). Keyed by
`x-wallet-address` header, falling back to IP.

| Limiter export | Action tag | Window | Max requests |
|----------------|-----------|--------|-------------|
| `globalLimiter` | `global` | 15 min | 100 |
| `authLimiter` | `auth` | 15 min | 20 |
| `apiKeyManagementLimiter` | `api-key-management` | 1 hour | 20 |
| `publishLimiter` | `publish` | 15 min | 5 |
| `purchaseLimiter` | `purchase` | 1 min | 10 |
| `reviewLimiter` | `review` | 1 min | 5 |
| `reportLimiter` | `report` | 1 min | 5 |
| `chatLimiter` | `chat` | 1 min | 30 |
| `strictLimiter` | `strict` | 1 min | 10 |

Webhook requests carrying a valid `x-webhook-signature` (or equivalent)
header bypass all limiters via the `isLegitimateWebhook` check.

Blocked events are stored in a ring buffer of 500 entries and accessible via
`getBlockedRateLimitEvents({ action?, limit?, sinceMs? })` for admin observability.

---

## 6. Getter reference

This table answers "which call do I make to read a given cap value at runtime?"

| Value | Layer | How to read |
|-------|-------|-------------|
| Per-listing supply cap | On-chain | `get_prompt(prompt_id).max_supply` — field on the returned `Prompt` struct |
| Per-listing sales count | On-chain | `get_prompt(prompt_id).sales_count` — compare with `max_supply` to get remaining |
| Bundle supply cap | On-chain | `get_bundle(bundle_id).max_supply` |
| Access pass supply cap | On-chain | `get_access_pass(pass_id).max_supply` |
| Platform fee percentage | On-chain | `get_fee_percentage() -> u32` (basis points; divide by 100 for percent) |
| Fee wallet | On-chain | `get_fee_wallet() -> Option<Address>` |
| XLM SAC address | On-chain | `get_xlm_sac() -> Option<Address>` |
| Pause state | On-chain | `is_paused() -> bool` |
| Referral percentage | On-chain | `get_referral_percentage() -> u32` |
| Global volume cap *(planned)* | On-chain | `get_global_volume_cap() -> u64` — **not yet implemented** |
| Full operator config *(planned)* | On-chain | `get_contract_config() -> ContractConfig` — **not yet implemented** |
| Policy quota status | Server | `policyLimitService.getStatus()` |
| Active rate-limit blocks | Server | `getBlockedRateLimitEvents()` |

---

## 7. Wave-change note

The term **wave** in this repository refers to a PR batch name
(`STELLAR_WAVE_IMPROVEMENTS.md`) covering issues #801, #809, #810, and #811
(RBAC, API contract documentation, notification system, and accessibility). It
has no connection to any time-windowed launch wave or epoch-based volume-cap
mechanism in the marketplace.

When the planned `set_global_volume_cap` / `get_global_volume_cap` contract
changes land, this document will be updated with:

- The exact contract version / git tag they ship in
- The confirmed `ContractConfig` struct shape
- The enforcement logic diff (where `reserve_supply` reads the override)
- A `MIGRATION.md` acknowledgement if the storage-key shape is breaking

Until that update is published, the per-listing `max_supply` field is the sole
enforced cap. The `DEFAULT_FEE_BPS = 500` and `MAX_PLATFORM_FEE = 1_000`
constants compiled into the contract are the only operator-observable global
parameters today.

---

*Cross-references: [environments.md](environments.md) · [operations/mainnet-deployment.md](operations/mainnet-deployment.md) · [abi-versioning-policy.md](abi-versioning-policy.md) · [contracts/prompt-hash/MIGRATION.md](../contracts/prompt-hash/MIGRATION.md)*
