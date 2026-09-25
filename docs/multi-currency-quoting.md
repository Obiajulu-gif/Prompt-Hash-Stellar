# Multi-Currency Stellar Price Quoting & Protection (#760)

## Overview
PromptHash pricing supports safe multi-currency Stellar price quotes that expire predictably and protect both buyers and sellers from stale conversion rates, slippage, and floating point math bugs during purchase settlement.

## Scope & Architectural Principles
1. **Integer-Safe Asset Amount Handling**: All quote calculations convert base XLM Stroops into target asset units using deterministic integer arithmetic (`(baseStroops * rateNumerator) / rateDenominator`), preventing floating point precision loss across Javascript and Soroban smart contract runtimes.
2. **Predictable Expiry Protection**: Every price quote is issued with a fixed Time-To-Live (TTL, default 60 seconds). Expired quotes are strictly prohibited from settling purchases on-chain or in the client SDK.
3. **Slippage Ceiling**: Quotes calculate a ceiling max charge with ceiling rounding (`+0.5%` or configurable BPS) to protect buyers against market fluctuations while ensuring full authorization coverage.
4. **Buyer-Facing UI Breakdown**: Before signing any transaction in their wallet, buyers view an interactive breakdown showing the selected asset, exchange rate, expiry countdown, platform fee, creator net, and maximum authorized charge.

---

## Supported Asset Configuration

Supported Stellar assets are configured in `src/lib/checkout/priceQuoter.ts`:

| Asset Code | Asset Name | Issuer Address / Type | Decimals | Exchange Rate (Base: 1 XLM) | Default TTL | Default Slippage BPS |
| font-mono | font-mono | font-mono | font-mono | font-mono | font-mono | font-mono |
| **XLM** | Stellar Lumens | Native (`null`) | 7 | `1.0 XLM` | 60s | 50 BPS (0.5%) |
| **USDC** | USD Coin | `GA5ZSEJYB37JRC5AVCIA5XYG4DZ6NMTCDD75B2B4VPP6QLY4VMKS74JD` | 7 | `0.12 USDC` | 60s | 50 BPS (0.5%) |
| **EURC** | Euro Coin | `GDHU6WR2E7VWVHJH2B5NZEWNZT27N5DXZC3UY4K2Q4Q4Q4Q4Q4Q4Q4Q4` | 7 | `0.11 EURC` | 60s | 50 BPS (0.5%) |

### Adding New Stellar Assets
To register additional assets, add an entry to `SUPPORTED_ASSET_CONFIGS` in `priceQuoter.ts`:

```typescript
export const SUPPORTED_ASSET_CONFIGS: Record<string, SupportedAssetConfig> = {
  // ...
  PYUSD: {
    code: "PYUSD",
    name: "PayPal USD",
    issuer: "G...",
    decimals: 7,
    rateNumerator: 120_000n,
    rateDenominator: 1_000_000n,
    defaultSlippageBps: 50,
    defaultTtlSeconds: 60,
  },
};
```

---

## Technical Specifications

### 1. Integer-Safe Math Formulas
- **Target Asset Units**:
  $$\text{rawQuoteUnits} = \frac{\text{baseStroops} \times \text{rateNumerator}}{\text{rateDenominator}}$$
  *(If $\text{baseStroops} > 0$ and division rounds to $0$, $\text{rawQuoteUnits}$ is floored at $1\text{ unit}$)*

- **Slippage Buffer & Max Ceiling**:
  $$\text{slippageUnits} = \left\lceil \frac{\text{rawQuoteUnits} \times \text{slippageBps}}{10000} \right\rceil = \frac{\text{rawQuoteUnits} \times \text{slippageBps} + 9999}{10000}$$
  $$\text{maxChargeUnits} = \text{rawQuoteUnits} + \text{slippageUnits}$$

- **Platform Fee & Creator Payout**:
  $$\text{platformFeeUnits} = \frac{\text{rawQuoteUnits} \times \text{feeBps}}{10000}$$
  $$\text{creatorPayoutUnits} = \text{rawQuoteUnits} - \text{platformFeeUnits}$$

---

## Validation & Error Handling

When settling a purchase via `PromptHashClient.purchasePrompt` or `validateQuoteForPurchase`:

1. **Quote Expiry Check** (`QUOTE_EXPIRED`):
   If `now >= quote.expiresAt`, validation fails with error:
   > *"Expired quotes cannot be used for purchase settlement. Please refresh quote."*

2. **Asset Mismatch Check** (`QUOTE_ASSET_MISMATCH`):
   If `quote.quoteAsset !== requestedAsset`, validation fails with error:
   > *"Quote asset mismatch: quote is for USDC, but purchase requested XLM."*

3. **Prompt Mismatch Check** (`QUOTE_PROMPT_MISMATCH`):
   If `quote.promptId !== targetPromptId`, validation fails.

4. **Max Charge Ceiling Check** (`QUOTE_CHARGE_EXCEEDED`):
   If actual charge exceeds `quote.maxChargeAmountUnits`, validation fails.

---

## Verification & Testing Guide

Run the multi-currency quoting test suite using Vitest:

```bash
npx vitest run src/lib/checkout/priceQuoter.test.ts
npx vitest run src/test/wallet/MultiCurrencyQuoteBreakdown.test.tsx
```

### Validation Checklist
- [x] Expired quotes cannot be used for purchase settlement.
- [x] Quote UI displays asset, amount, expiry, and fees.
- [x] Tests cover quote expiry, asset mismatch, and rounding behavior.
- [x] Integer-safe asset amount handling without floating-point math issues.
- [x] Deterministic quote generation in test suites.
