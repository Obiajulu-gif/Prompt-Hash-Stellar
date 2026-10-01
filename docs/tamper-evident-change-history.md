# Tamper-Evident Change History for Critical Domain Records

## Overview

In Prompt Hash Stellar, critical domain mutations—such as ownership handoffs, payment/payout adjustments, access entitlement changes, and API permissions—must provide verifiable, immutable change histories. Relying solely on mutable database timestamps is insufficient for investigating user disputes, auditing financial transactions, or debugging complex integration regressions.

This document describes the tamper-evident change history architecture implemented in `server/src/models/ChangeHistoryEntry.ts` and `server/src/services/changeHistory.ts` (#830).

---

## Scoped Critical Records

The following record types are tracked whenever mutations occur that affect ownership, money, permissions, or user access:

| Record Type | Description | Critical Fields Monitored |
| :--- | :--- | :--- |
| `prompt` | AI Prompt listings | `owner`, `creator`, `price`, `currency`, `lifecycleState`, `payoutSplits`, `moderationStatus` |
| `ownership_transfer` | Off-chain listing handoffs | `promptId`, `fromWallet`, `toWallet`, `status`, `expiresAt`, `decidedAt`, `rejectionReason` |
| `entitlement` | Buyer access rights | `userAddress`, `promptId`, `status`, `grantedAt`, `revokedAt`, `revocationReason` |
| `api_key` | System / integration API keys | `keyId`, `userId`, `scopes`, `status`, `expiresAt` |
| `payout_statement` | Payout statements to creators | `creatorAddress`, `amount`, `currency`, `status`, `reconciled` |
| `ledger_entry` | Financial ledger transactions | `creatorAddress`, `amount`, `currency`, `entryType`, `stellarTxRef`, `reconciled` |

---

## Tamper-Evident Architecture & Cryptographic Chaining

Every critical mutation produces an immutable, append-only `ChangeHistoryEntry` linked chronologically and cryptographically to the preceding record:

```
+-------------------------------------------------------------------------------+
| ChangeHistoryEntry (Seq 1)                                                    |
|  recordType: "prompt"                                                         |
|  recordId: "prompt-101"                                                       |
|  previousHash: 0000000000000000000000000000000000000000000000000000000000000000|
|  beforeState: null                                                            |
|  afterState: { owner: "GALICE", price: 50, status: "DRAFT" }                  |
|  recordHash: SHA-256(canonicalJson({ seq: 1, ... }))                          |
+---------------------------------------+---------------------------------------+
                                        | (previousHash = seq1.recordHash)
                                        v
+-------------------------------------------------------------------------------+
| ChangeHistoryEntry (Seq 2)                                                    |
|  recordType: "prompt"                                                         |
|  recordId: "prompt-101"                                                       |
|  previousHash: <seq1.recordHash>                                              |
|  beforeState: { owner: "GALICE", price: 50, status: "DRAFT" }                  |
|  afterState: { owner: "GALICE", price: 50, status: "PUBLISHED" }              |
|  recordHash: SHA-256(canonicalJson({ seq: 2, ... }))                          |
+-------------------------------------------------------------------------------+
```

### Deterministic Hashing
Hash generation uses `canonicalJson` to sort object keys recursively and eliminate whitespace inconsistencies. The digest includes:
1. `recordType` and `recordId`
2. Incremental `sequence`
3. `operation` (`create`, `update`, `transfer`, `revoke`, `delete`)
4. `actor` (wallet address or administrative subject)
5. `reason` (mandatory rationale for the mutation)
6. `beforeState` (snapshot prior to mutation, null on create)
7. `afterState` (snapshot following mutation)
8. `previousHash`
9. `createdAt` (normalized ISO-8601 timestamp)

---

## Verification & Anomaly Detection

`ChangeHistoryService.verifyChain` evaluates history sequences to detect tampering or irregularities:

1. **Content Tampering Detection**: Recomputes the SHA-256 digest of each entry. If an attacker modifies snapshots, actor, or reason in the database, the stored `recordHash` will fail verification.
2. **Missing Record Detection**: Verifies that `sequence` starts at `1` and increments strictly by `1`. Any gap (e.g. sequence 1 followed immediately by sequence 3) triggers a sequence mismatch error.
3. **Out-of-Order / Reordering Detection**: Enforces monotonic timestamps (`createdAt[i] >= createdAt[i - 1]`). Reordered records or backdated insertions trigger timestamp regression errors.
4. **Broken Chain Linkage**: Verifies `previousHash` links exactly to the preceding entry's `recordHash`.
5. **State Continuity Verification**: Verifies that each entry's `beforeState` matches the prior entry's `afterState`.

---

## Usage Examples

### Recording a Mutation
```typescript
import { ChangeHistoryService } from "../services/changeHistory";

await ChangeHistoryService.recordMutation({
  recordType: "prompt",
  recordId: "prompt-1",
  operation: "update",
  beforeState: { owner: "GALICE", price: 10, status: "DRAFT" },
  afterState: { owner: "GALICE", price: 10, status: "PUBLISHED" },
  actor: "GALICE",
  reason: "Listing completed verification and was published",
});
```

### Verifying Record History
```typescript
const result = await ChangeHistoryService.verifyRecordHistory("prompt", "prompt-1");
if (!result.valid) {
  console.error("Tampering or anomalies detected:", result.errors);
}
```
