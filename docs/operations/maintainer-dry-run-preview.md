# Maintainer Dry-Run Preview for Destructive Actions (#1140)

## Overview

Destructive maintainer actions—such as bulk prompt retirement, pricing overrides, or administrative status shifts—can introduce irreversible state transitions on the Soroban smart contract ledger or result in major financial impacts.

The **Dry-Run Preview API** (`/api/admin/dry-run`) provides an authenticated, side-effect-free preview endpoint enabling maintainers to inspect exact field diffs, aggregate financial impacts in XLM, and irreversible state flags before confirming execution.

---

## Architecture & API Specification

### 1. Preview Evaluation: `POST /api/admin/dry-run/evaluate`

Evaluates candidate records against a declared maintainer policy without persisting any changes.

- **Required Scope**: `policy:evaluate` or `admin`
- **Request Body**:
  ```json
  {
    "policy": {
      "id": "policy-retire-deprecated",
      "name": "Retire Deprecated Prompts",
      "targetResource": "prompts",
      "predicate": { "field": "status", "operator": "eq", "value": "paused" },
      "action": "inactivity_retire",
      "parameters": { "targetStatus": "retired" },
      "requiredPermission": "policy:evaluate",
      "isDestructive": true
    },
    "records": [
      { "id": "p1", "version": 2, "status": "paused", "priceXlm": 100 }
    ],
    "options": {
      "maxRecords": 5000,
      "maxPreview": 100
    }
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "policyId": "policy-retire-deprecated",
      "scannedCount": 1,
      "affectedCount": 1,
      "unaffectedCount": 0,
      "irreversibleCount": 1,
      "totalFinancialImpactXlm": 0,
      "severitySummary": { "low": 0, "medium": 0, "high": 0, "critical": 1 },
      "affectedPreviews": [
        {
          "recordId": "p1",
          "version": 2,
          "diffs": [{ "field": "status", "before": "paused", "after": "retired" }],
          "severity": "critical",
          "isIrreversible": true,
          "financialImpactXlm": 0
        }
      ],
      "confirmationToken": "hmac_sha256_hex_token"
    }
  }
  ```

---

### 2. Execution Confirmation: `POST /api/admin/dry-run/confirm`

Executes the previously evaluated destructive action using the issued HMAC confirmation token.

- **Required Scope**: `policy:evaluate` or `admin`
- **Request Body**:
  ```json
  {
    "confirmationToken": "hmac_sha256_hex_token",
    "policyId": "policy-retire-deprecated",
    "targetResource": "prompts",
    "affectedRecordSummaries": [{ "id": "p1", "version": 2 }],
    "totalFinancialImpactXlm": 0
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Destructive maintainer action successfully confirmed and executed",
    "executedRecordsCount": 1,
    "policyId": "policy-retire-deprecated",
    "executedAt": "2026-11-22T10:00:00.000Z"
  }
  ```

---

## Failure Modes, Edge Cases, and Recovery

### 1. Record Drift Protection (`409 Conflict`)
- **Problem**: If another operator or user updates a record (advancing its version number) between preview generation and confirmation, executing the stale plan could corrupt state.
- **Enforcement**: The HMAC confirmation token cryptographically commits to the exact list of record IDs and version numbers. If any version differs, the endpoint returns `409 Conflict` with `confirmation_mismatch`.
- **Recovery / Retry Procedure**:
  1. Catch HTTP `409` in the administrative client.
  2. Re-fetch the current database state for candidate records.
  3. Call `POST /api/admin/dry-run/evaluate` to generate a fresh preview and new `confirmationToken`.
  4. Prompt the maintainer with updated diffs before retrying `POST /api/admin/dry-run/confirm`.

### 2. Candidate Selection Bounds (`400 Bad Request`)
- **Limit**: By default, record scans are capped at `MAX_EVALUATION_RECORDS = 10,000` to prevent memory and event-loop exhaustion.
- **Response**: Returns `400 Bad Request` with `code: "selection_too_large"`.
- **Mitigation**: Operators must partition queries by date range, creator address, or status before running dry-run evaluations.

### 3. Smart Contract Irreversibility & Rollbacks
- **Constraint**: Status transitions to `retired` on the Soroban smart contract are permanent. Once published to the Stellar ledger, they cannot be rolled back.
- **Guardrails**:
  - Previews explicitly identify irreversible steps (`isIrreversible: true`).
  - Maintainer UI must display high-severity warnings for any plan where `irreversibleCount > 0`.
  - In the event of an unintended execution of reversible properties (e.g. price ceilings or tag restrictions), operators can execute an inverse policy using a new dry-run confirmation cycle.

---

## Authorization & Security

- **Fail-Closed Auth**: Requests lacking a valid Bearer token or signed by an unconfigured secret fail with `401 Unauthorized` or `503 Service Unavailable`.
- **RBAC Scopes**: Requires `policy:evaluate` or administrative superuser scope (`admin`). Tokens carrying only read permissions (e.g., `prompts:read`) are denied.
- **Audit Logging**: Every evaluation and confirmation event is logged to the tamper-evident audit ledger (`services/auditTrail.ts`) recording the actor identity, IP, policy ID, and affected record count.
