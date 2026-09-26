# Maintainer Guide: Content Integrity Verification & Payload Recovery (#460)

## Overview

The content integrity service periodically audits stored encrypted prompt data against its recorded SHA-256 content digest. It detects payload corruption, data degradation, or missing payload entries without exposing sensitive plaintext, encryption IVs, or secret keys.

---

## Architecture & Security Principles

1. **Zero-Leak Logging**:
   - Integrity audits compute the SHA-256 digest over the encrypted payload directly.
   - Audit logs output strictly prompt IDs, verification status (`ok`, `corrupted`, `missing`, `unreachable`), and hex hash digests.
   - Plaintext prompts, symmetric AES key material, and IV values are **never logged or written to disk**.

2. **State Preservation**:
   - Integrity rechecks evaluate data health without mutating listing availability (`isActive`) or purchase states.
   - Maintainers receive diagnostic reports (`integrityStatus` and `integrityError`) to take corrective action while keeping valid purchase entitlements intact.

---

## Triggering Integrity Rechecks

### CLI Background Sweep
To execute a background sweep across all stored prompt listings:
```bash
npx tsx server/src/scripts/checkIntegrity.ts
```

### Admin HTTP Endpoints
Maintainers can query or trigger audits via administrative API endpoints:
- **Fetch Audit Report**: `GET /api/prompts/admin/integrity-report`
- **Trigger Audit Sweep**: `POST /api/prompts/admin/integrity-check`
- **Trigger Single Prompt Audit**: `POST /api/prompts/admin/integrity-check` with body `{"promptId": "<prompt_id>"}`

---

## Status Classification & Diagnostic Matrix

| Status | Cause | Impact | Action Required |
| :--- | :--- | :--- | :--- |
| `ok` | Payload SHA-256 matches recorded `contentHash` | Normal operation | None |
| `missing` | Encrypted payload field is `null` or empty string | Buyers cannot decrypt prompt payload | Restore payload from snapshot/on-chain event |
| `corrupted` | Payload SHA-256 does not match recorded `contentHash` | Decryption will fail or produce invalid text | Investigate storage modification & restore |
| `unreachable` | Prompt ID not found in storage | Indexer mismatch | Re-index prompt from Soroban contract event |

---

## Payload Recovery Steps

### 1. Identify Affected Listings
Run an audit sweep or query the report endpoint to extract failing prompt IDs:
```bash
curl -X GET http://localhost:5000/api/prompts/admin/integrity-report
```

### 2. Verify On-Chain Contract Event Logs
Cross-reference the affected `onChainId` with the Soroban contract `PromptCreated` or `ListingRevised` event payload:
- Retrieve the original `encrypted_prompt` and `content_hash` from the contract event topic / data on Stellar network.

### 3. Restore Payload in Storage
Once verified against the original event signature, restore the encrypted payload in the storage document and re-trigger integrity verification:
```bash
curl -X POST http://localhost:5000/api/prompts/admin/integrity-check \
  -H "Content-Type: application/json" \
  -d '{"promptId": "<affected_id>"}'
```

---

## Scheduled Job Configuration

To automate periodic daily audits, schedule `checkIntegrity.ts` in your crontab or job orchestrator:
```cron
# Run daily content integrity audit at 02:00 UTC
0 2 * * * cd /var/app/Prompt-Hash-Stellar && npx tsx server/src/scripts/checkIntegrity.ts >> /var/log/prompt-integrity.log 2>&1
```
