# Maintainer Operational Health Dashboard & Exception Diagnostics

_Issue #814 — Unresolved Failures, Stale Jobs, Reconciliation Drift, and Incident Monitoring_

## 1. Overview

Maintainers need continuous visibility into operational health, background queue health, financial settlement reconciliation, and unresolved errors without manually querying MongoDB or reviewing fragmented logs.

The Operational Health Framework aggregates actionable diagnostics into a unified report and dashboard while ensuring sensitive credentials (private keys, seed words, bearer tokens) are strictly redacted.

---

## 2. Core Health Categories & Indicators

| Health Category | Source Models / Services | Severity Trigger | Action Required |
|---|---|---|---|
| **Unresolved Exceptions** | `InboundWebhookEvent`, `QuarantinedEvent`, `JobRecord` (DLQ) | Failed webhooks, dead-letter jobs | Inspect failure message, check external endpoint/signature, trigger requeue |
| **Stale Background Jobs** | `JobRecord` | Jobs in `processing` or `pending` &gt; 15 minutes | Check worker health, inspect `lastError`, trigger restart or retry |
| **Reconciliation Drift** | `LedgerEntry`, `PayoutStatement`, `IndexerState` | Unsettled payout entries missing `stellarTxRef`, indexer lag &gt; 10 ledgers | Verify Soroban contract balance, trigger ledger sync / payout run |
| **Active Incidents** | `Report`, `SupportCase`, `QuarantinedEvent` | Open user reports, policy violations, security alerts | Review evidence, take moderation or dispute resolution action |

---

## 3. Data Redaction & Security Protection

All endpoints and CLI reports automatically run through `sanitizeSensitiveData`:
- **Stellar Secret Keys (`S...`)**: Masked as `[REDACTED_SECRET_KEY]`.
- **Authorization & Bearer Tokens**: Masked as `Bearer [REDACTED_TOKEN]`.
- **API Keys & Passwords**: Masked as `[REDACTED]`.
- **Reporter PII & Raw Headers**: Scrubbed before maintainer presentation.

---

## 4. API Endpoints

### Maintainer Health Endpoint (Requires `health:read` admin scope)
- **`GET /api/admin/operational-health`**:
  ```json
  {
    "success": true,
    "report": {
      "timestamp": "2026-09-27T02:00:00.000Z",
      "status": "HEALTHY",
      "summary": {
        "totalUnresolvedExceptions": 0,
        "staleJobsCount": 0,
        "reconciliationDriftCount": 0,
        "activeIncidentsCount": 0
      },
      "categories": { ... }
    }
  }
  ```

### Lightweight Monitoring Summary
- **`GET /api/admin/operational-health/summary`**:
  Returns aggregate status code (`HEALTHY`, `DEGRADED`, `CRITICAL`) and counts for alerting integrations.

---

## 5. Maintainer CLI Diagnostic Tool

Run the diagnostic scanner directly in your terminal:

```bash
# Formatted human-readable report
npx ts-node server/scripts/maintainerHealthReport.ts

# Machine-readable JSON output
npx ts-node server/scripts/maintainerHealthReport.ts --json
```

**Exit Codes**:
- `0`: HEALTHY (All checks passed, zero critical exceptions)
- `1`: DEGRADED (Non-critical exceptions or stale jobs detected)
- `2`: CRITICAL (Dead-letter jobs, large settlement drift, or active escalations)

---

## 6. Frontend Dashboard

Access the UI dashboard at `/admin/operational-health` or via the Admin Control Center:
- Actionable KPI cards with drill-down tabs.
- Deep-links directly to affected entities (`/api/jobs/:id`, `/api/webhooks/events/:id`).
- Real-time status badge and live refresh.
