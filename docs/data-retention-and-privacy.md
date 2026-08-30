# Off-Chain Data Retention and Privacy Guide

This document outlines how PromptHash stores, retains, and secures off-chain marketplace and unlock metadata. It clarifies the boundaries between immutable on-chain data and mutable off-chain state.

## On-Chain vs. Off-Chain Responsibilities

**Permanently On-Chain:**
- Prompt hashes and content integrity proofs.
- Ownership transfers and licensing rights.
- Payment transactions (XLM) and ledger history.

**Stored Off-Chain:**
- Rich marketplace metadata (titles, descriptions, categories).
- Prompt card images and preview media.
- User profiles, reputation scores, and reviews.
- Delivery status, analytics, and diagnostic logs.

## Stored Public and Wallet-Scoped Fields

### Public Fields
- **Marketplace Listings**: Titles, descriptions, tags, and prices.
- **Creator Profiles**: Display names, bios, and public avatars.
- **Reviews**: Public ratings and feedback left by buyers.

### Wallet-Scoped (Private/Sensitive) Fields
- **Unlock Materials**: The actual unencrypted prompt content delivered upon purchase.
- **Challenge Nonces**: Temporary cryptographic tokens used for wallet authentication.
- **Purchase History**: Off-chain fulfillment status linking a specific wallet to a purchased asset.

## Retention Expectations

- **Challenges & Nonces**: Stored temporarily in memory/Redis and expire after 5 minutes. Never persisted to long-term storage.
- **Fulfillment & Unlock Records**: Retained indefinitely to allow buyers to re-download purchased materials, unless an explicit deletion request is made.
- **Payout Statements**: Generated on demand from purchase and refund events. They are recomputed, not stored, and may be regenerated for any period within the purchase history retention window (creators: see the [creator publishing guide](./creator-publishing-guide.md)).
- **Analytics & Indexed Records**: Aggregated analytics are retained permanently. Raw indexed events mirror the blockchain and are retained to allow fast querying without hitting the RPC node.
- **Diagnostic Logs**: Retained for 30 days. Logs are heavily redacted (see below).

## Deletion, Backup, and Redaction Behaviour

- **Deletion**: Users may request deletion of their off-chain profile data. Upon deletion, their username and bio are removed, but their on-chain wallet address remains visible in the ledger history.
- **Backup**: MongoDB collections containing marketplace metadata are backed up daily. Backups are retained for 90 days.
- **Redaction**: All diagnostic and application logs automatically scrub sensitive fields. IP addresses, session tokens, and the raw text of unlocked prompts are **never** written to disk.

## Sensitive Logging Restrictions
Contributors must ensure that application logs never capture:
- The actual prompt text (except for the public preview snippet).
- Cryptographic signatures or authentication nonces.
- Personally identifiable information (PII) beyond the public Stellar public key.
