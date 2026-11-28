# Policy Simulation with Affected-Record Previews

Provides side-effect-free dry-run evaluation of governance, pricing, and operational policies across PromptHash Stellar marketplace records before changes are executed.

```bash
# Preview fee adjustment policy
npm run policy:simulate -- --policy=fee_adjustment --param.newFeePercentage=0.08

# Preview price limits across marketplace listings
npm run policy:simulate -- --policy=price_limit --param.maxPrice=100

# Preview creator quarantine or suspension
npm run policy:simulate -- --policy=creator_suspension --param.creatorAddress=G... --param.action=quarantine

# Preview bulk refund with platform treasury impact
npm run policy:simulate -- --policy=bulk_refund --param.promptId=prompt_123

# Verify confirmation token against drift
npm run policy:simulate -- --policy=fee_adjustment --param.newFeePercentage=0.08 --verify-token=<token>
```

Exit code is `0` when simulation succeeds or token matches without drift, `1` on validation failure, `2` on unauthorized access, and `3` on selection bounds or token drift.

---

## Architecture and Guarantees

1. **Zero Side Effects**: Simulation executes purely in-memory. Zero database mutations occur during preview.
2. **Bounded Complexity**:
   - `MAX_EVALUATION_RECORDS = 10,000`: Scans exceeding this ceiling are rejected with `selection_too_large` (HTTP 422) to prevent denial-of-service.
   - `MAX_PREVIEW_RECORDS = 100`: Affected record diffs returned in the preview window are bounded to 100 items while maintaining accurate aggregate metrics.
3. **Cryptographic Confirmation Token**: Produces an HMAC-SHA256 signature binding the policy ID, actor ID, affected record IDs, record versions, and total XLM impact. Any subsequent execution step verifies this token to prevent Time-Of-Check to Time-Of-Use (TOCTOU) drift.
4. **Reversibility and Rollback Analysis**: Each policy identifies reversible vs irreversible effects (such as Soroban smart contract status changes or on-chain settlement clawbacks).
5. **Strict Authorization**: Requires `policy:evaluate` or `admin` permission scopes.

---

## Supported Policy Types

| Policy Type | Target Resource | Key Parameters | Typical Impact | Reversibility |
|-------------|-----------------|----------------|----------------|---------------|
| `fee_adjustment` | `prompts` | `newFeePercentage`, `effectiveDate` | Future transaction fee delta | Reversible for future sales; irreversible for past settlements |
| `price_limit` | `prompts` | `maxPrice`, `minPrice`, `targetTag` | Listing price ceiling/floor diffs | Reversible via version snapshot restore |
| `creator_suspension` | `prompts`, `users` | `creatorAddress`, `action` (`quarantine` or `retire`) | Search index delisting, capability freeze | Reversible if quarantined; irreversible if retired on Soroban |
| `bulk_refund` | `purchases` | `promptId`, `refundTreasuryReserveXlm` | Treasury payouts, license revocations | Irreversible once executed on-chain |
| `custom_rule` | Any resource | `predicate`, `action`, `parameters` | Evaluates composite predicate rules | Inferred from destructive flags and predicates |

---

## Severity Classification Matrix

| Severity | Definition | Examples |
|----------|------------|----------|
| `low` | Minor operational changes with zero financial loss | Price floor adjustments under 10 XLM, informational tagging |
| `medium` | Noticeable listing or fee changes | Price caps, platform fee changes under 2%, catalog index re-ordering |
| `high` | Substantial revenue impact or listing delisting | Platform fee changes over 2%, creator quarantine, access restrictions |
| `critical` | Irreversible ledger finality or treasury fund movements | Status transitions to `retired` on Soroban ledger, bulk refunds |

---

## Rollback Procedures

| Scenario | Can Rollback | Procedure | Recovery Window |
|----------|--------------|-----------|-----------------|
| Protocol fee change | Yes | Restore original fee percentage in contract configuration | Immediate |
| Price limit cap | Yes | Restore previous `priceXlm` using `VersionedRecord` audit log | Any time |
| Creator quarantine | Yes | Clear quarantine flag and re-enable active status in admin panel | Any time |
| Creator Soroban retirement | No | Smart contract status `retired` is cryptographically immutable | Irreversible |
| On-chain bulk refund | No | Stellar ledger payments cannot be reversed once finalized | Irreversible |
| Buyer tokenized license | No | Cryptographic prompt unlock entitlement cannot be revoked | Irreversible |

---

## Drift Detection and Safe Retries

When a policy change preview is confirmed, the engine computes:
$$\text{token} = \text{HMAC-SHA256}(\text{secret}, \text{canonicalJson}(\text{plan}))$$

The canonical payload includes:
- Policy identifier and target resource
- Operator actor ID
- Sorted array of affected record IDs and versions: `[{ id, version }]`
- Total projected XLM financial impact

If an operator or background worker attempts to apply a policy change with a confirmation token:
1. The engine re-scans candidate records.
2. If any record version has incremented (e.g. from `v1` to `v2`) or if financial impact diverges, the verification fails (`confirmation_mismatch_or_drift`).
3. The execution is halted safely, requiring a refreshed simulation preview.

---

## HTTP API Endpoints

All endpoints are mounted under `/api/admin/policy-simulation` and require `requireAdminScope("policy:evaluate")`.

### 1. Preview Policy Simulation
- **Endpoint**: `POST /api/admin/policy-simulation/preview`
- **Request Body**:
```json
{
  "policyChange": {
    "type": "price_limit",
    "parameters": {
      "maxPrice": 100
    },
    "reason": "Cap prompt prices at 100 XLM",
    "scheduledBy": "ops-admin"
  },
  "candidateRecords": [
    { "id": "p1", "version": 1, "priceXlm": 150, "status": "active" }
  ]
}
```
- **Response** (`200 OK`):
```json
{
  "policyChange": { ... },
  "scannedCount": 1,
  "affectedCount": 1,
  "isIrreversible": false,
  "severityCounts": { "low": 0, "medium": 1, "high": 0, "critical": 0 },
  "affectedRecords": { "users": 1, "prompts": 1, "purchases": 0, "settlements": 0, "totalXlmImpact": 50 },
  "sideEffects": [ ... ],
  "rollbackConstraints": [ ... ],
  "preview": {
    "affectedPreviews": [
      {
        "recordId": "p1",
        "version": 1,
        "statusBefore": "active",
        "statusAfter": "active",
        "diffs": [{ "field": "priceXlm", "before": 150, "after": 100 }],
        "severity": "medium",
        "isIrreversible": false,
        "violationReason": "Price 150 XLM exceeds ceiling of 100 XLM",
        "estimatedFinancialImpactXlm": 50
      }
    ]
  },
  "confirmationToken": "6f7e105d..."
}
```

### 2. Verify Confirmation Token
- **Endpoint**: `POST /api/admin/policy-simulation/verify-token`
- **Request Body**:
```json
{
  "token": "6f7e105d...",
  "simulationResult": { ... }
}
```
- **Response** (`200 OK`):
```json
{
  "valid": true,
  "message": "Confirmation token matches simulation plan with zero record drift."
}
```

---

## Edge Cases and Failure Modes

- **Exceeding selection ceiling**: If input candidate records exceed 10,000, `selection_too_large` is thrown (HTTP 422). Operators should shard candidate evaluation into distinct batches.
- **Treasury depletion during bulk refunds**: If requested refunds exceed available treasury reserves, risks are elevated to `critical` and execution requires manual treasury replenishment.
- **Record version drift**: If concurrent transactions modify records while simulation is in review, token verification safely rejects execution with code 3.
- **Operator permissions**: Operators lacking `policy:evaluate` or `admin` scopes receive exit code 2 / HTTP 403.
