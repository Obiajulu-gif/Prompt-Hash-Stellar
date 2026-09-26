# Built on Stellar: A Soroban Prompt Marketplace Case Study

## Introduction

PromptHash is a decentralized prompt marketplace built on Stellar's Soroban smart contract platform. Creators list encrypted AI prompts with on-chain pricing, and buyers purchase perpetual or time-limited access using any Stellar asset. The platform handles payment routing, access control, and content delivery without a centralized database for ownership records.

This case study examines why Soroban was chosen and the technical advantages it provides for digital-content commerce.

## Why Soroban

### Native Asset Integration

Stellar's asset model treats every issued asset — XLM, USDC, ARS, or any custom token — as a first-class citizen through the Stellar Asset Contract (SAC) standard. PromptHash prompts can be priced in any SAC-compatible asset without deploying custom token contracts or managing bridge infrastructure. A single `token::StellarAssetClient` interface handles transfers regardless of the underlying asset.

### Built-in Authentication

Soroban's auth framework eliminates the need for custom signature verification. Every mutating contract function calls `require_auth()` on the caller address, and the runtime enforces that the transaction was signed by the corresponding keypair. There is no `msg.sender` pattern to get wrong and no signature recovery to implement.

### Predictable Execution Costs

Soroban uses a metered execution model where every instruction, storage read, and storage write has a deterministic cost. Contract authors can reason about worst-case costs at development time rather than discovering gas surprises in production.

## Gas Efficiency of the Purchase Flow

The `buy_prompt` function completes the entire purchase lifecycle in a single transaction invocation:

```
1. Validate listing (active, not duplicate, supply check)
2. Apply voucher discount (if provided)
3. Validate payment amount >= required price
4. Validate referrer constraints
5. Set reentrancy guard
6. Calculate fee, referral, and creator splits
7. Execute transfer_from: buyer → creator
8. Execute transfer_from: buyer → fee_wallet
9. Execute transfer_from: buyer → referrer (if present)
10. Increment sales count
11. Grant purchase access record
12. Clear reentrancy guard
13. Emit PromptPurchased event
14. Emit PromptTipped event (if overpayment)
```

All 14 steps execute atomically. If any step fails — insufficient balance, invalid voucher, arithmetic overflow — the entire transaction reverts with no partial state changes.

### Comparison with EVM

On Ethereum or EVM-compatible chains, the same flow typically requires two transactions:

1. **Approve**: The buyer approves the marketplace contract to spend their ERC-20 tokens.
2. **Buy**: The marketplace contract calls `transferFrom` to move tokens.

This two-step pattern doubles the transaction count, introduces a window where the approval exists but the purchase hasn't happened, and requires the frontend to manage multi-step transaction sequences. Soroban's `transfer_from` with contract-level authorization handles both in one call.

## Security Model

### Authorization

Every state-mutating function in the PromptHash contract begins with explicit authorization:

- `create_prompt`: `creator.require_auth()`
- `buy_prompt`: `buyer.require_auth()`
- `set_fee_percentage`: `#[only_owner]` macro (admin-only via OpenZeppelin's Ownable)
- `set_pause_status`: `#[only_owner]`
- `add_voucher`: `creator.require_auth()` + ownership check against prompt record

### Reentrancy Protection

The contract implements a storage-based reentrancy guard that is set before any token transfers and cleared after all state mutations are complete. This prevents cross-contract callback attacks during the `transfer_from` calls.

```
set_reentrancy_guard()       ← blocks re-entry
  ├─ transfer_from (creator)
  ├─ transfer_from (fee_wallet)
  ├─ transfer_from (referrer)
  ├─ update prompt state
  └─ grant purchase record
clear_reentrancy_guard()     ← re-enables entry
```

### Checked Arithmetic

Every multiplication, addition, and subtraction in fee calculations uses Rust's `checked_mul`, `checked_add`, and `checked_sub` methods. Overflow returns a typed `ArithmeticOverflow` error instead of silently wrapping. The test suite verifies this with prices near `i128::MAX / 10_000`.

### Emergency Circuit Breaker

An owner-controlled pause mechanism blocks all state-mutating operations (create, buy, lease, update) while allowing read-only queries (get_prompt, has_access, get_all_prompts) to continue. This enables rapid response to discovered vulnerabilities without destroying the ability to query existing data.

## Architecture

```
┌─────────────────┐         ┌──────────────────────────┐
│  Creator Browser │         │      Buyer Browser       │
│                  │         │                          │
│  encrypt prompt  │         │  select prompt + pay     │
│  submit listing  │         │  unlock after purchase   │
└────────┬─────────┘         └────────────┬─────────────┘
         │                                │
         │  create_prompt(pricing)        │  buy_prompt(payment)
         │                                │
         ▼                                ▼
┌──────────────────────────────────────────────────────┐
│                  Soroban Contract                     │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │ Listings │  │ Purchases│  │ Fee/Referral Config │ │
│  │ (Prompt) │  │ (Access) │  │                    │ │
│  └──────────┘  └──────────┘  └────────────────────┘ │
│                                                      │
│  transfer_from ──► SAC (XLM, USDC, ARS, etc.)       │
└──────────────────────────────────────────────────────┘
         │
         │  has_access query
         ▼
┌──────────────────┐
│  Unlock Service  │
│                  │
│  verify access   │
│  decrypt prompt  │
│  return content  │
└──────────────────┘
```

## Multi-Currency Design

Each prompt stores its pricing asset address directly in the on-chain record:

```rust
pub struct Prompt {
    // ... content fields ...
    pub price_stroops: i128,
    pub asset: Address,      // SAC address (XLM, USDC, ARS, etc.)
    // ... metadata fields ...
}
```

When a buyer purchases a prompt, the contract reads the asset from the listing and constructs a `StellarAssetClient` for that specific token. This means:

- A creator can list a prompt for 5 USDC, and the buyer pays in USDC.
- Another creator can list in XLM, and the buyer pays in XLM.
- Fee splits and referral commissions use the same asset as the listing.
- No DEX routing or cross-asset swaps are needed at the contract level.

The SAC standard guarantees that any Stellar-issued asset exposes the same `transfer`, `transfer_from`, `approve`, `balance`, and `decimals` interface. The contract validates this during listing creation by calling `decimals()` on the provided asset address.

## Comparison with Alternative Approaches

| Aspect | Soroban (PromptHash) | EVM/Solidity | Off-chain Only |
|--------|---------------------|--------------|----------------|
| Payment | Single-tx atomic | 2-tx approve+buy | Credit card / PayPal |
| Access records | On-chain, verifiable | On-chain, verifiable | Database, trust-dependent |
| Multi-currency | Native via SAC standard | Custom ERC-20 per token | Platform-managed |
| Auth model | Built-in `require_auth` | `msg.sender` patterns | Session tokens |
| Content encryption | Client-side, key on-chain | Client-side, key on-chain | Server-side |
| Dispute resolution | Immutable purchase records | Immutable purchase records | Chargeback risk |

## Test Coverage

The contract maintains a comprehensive test suite covering:

- Basic CRUD operations (create, read, update status/price)
- Multi-buyer access and fee tracking
- Zero-fee and maximum-fee edge cases
- Arithmetic safety with near-overflow prices
- Referral commission splitting with 3-way payment routing
- Emergency pause blocking mutations while allowing reads
- Tipping (overpayment above listing price)
- Single-use voucher discounts with combined referral scenarios
- Multi-currency purchases and leases across different SAC assets
- Lease expiration with time-based access control

All tests run against mock SAC tokens registered in the Soroban test environment, verifying exact balance changes for every participant in every transaction.
