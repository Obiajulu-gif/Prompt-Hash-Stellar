# Creator Publishing and Payout Guide

This guide walks creators through publishing prompts on PromptHash and understanding their payout statements.

## Publishing a Prompt

1. Connect your wallet from the top navigation bar.
2. Open **Sell Prompt** from the creator menu and fill in the form: title, description, one or more content blocks, category, tags, and the sale price in XLM.
3. Review the preview and confirm. The prompt is registered on-chain via the PromptHash smart contract, and its marketplace metadata is indexed off-chain for search and discovery.
4. Your prompt appears in the marketplace. You can pause sales, change the price, or retire a listing at any time from **My Prompts**.

## The Platform Fee

PromptHash charges a **5% platform fee** on every sale. A purchase of `100 XLM` therefore yields:

- **Gross Amount**: `100 XLM`
- **Platform Fee**: `5 XLM`
- **Creator Amount**: `95 XLM`

The creator amount is paid out to your configured payout address on the Stellar network.

## Refunds

If a transaction is reversed by a dispute and the buyer is refunded, that purchase appears as a **refund** line on your statement instead of a sale. Refund lines have negative amounts, and the corresponding platform fee is credited back so the fee you keep matches the sales that actually stand.

## Payout Statements

Your statement reconciles every sale, fee, and refund for a given period under one balance identity:

```
net settlement = gross sales - platform fees - refunds
```

A statement is only marked as **balanced** when that identity holds exactly.

### Statement Levels

- **Settled**: every line has an on-chain transaction hash, so the payout was delivered.
- **Pending**: one or more sales have not yet been settled.
- **Failed**: one or more transactions failed without a settlement transaction. Contact support if you see this.

### Status Codes

Each line carries a per-line settlement status:

- **Settled** — the payout transaction hash is recorded.
- **Pending** — the sale is awaiting settlement.
- **Failed** — the transaction did not succeed.

### Exporting

Open **Payout Settings** from the profile menu to see a live summary and per-line table. Use **Export CSV** (or `GET /api/prompts/creator/:walletAddress/payout-statement?format=csv`) to download a spreadsheet including gross, fee, and net amounts plus each line's settlement status and transaction hash.

Statements are generated on demand from your purchase history; they are recomputed rather than stored, and can be scoped to a period with the `startDate` and `endDate` query parameters.