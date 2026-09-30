# Data Retention & Operational Data Cleanup Policy

_Issue #815 — Classification, Archival/Scrubbing Windows, Legal Hold Protection, and Dry-Run Verification_

## 1. Overview

Operational data in Prompt Hash Stellar (inbound webhooks, quarantined events, job artifacts, export CSVs, support tickets, and audit trails) must be retained long enough to support audits, incident investigations, and support resolution without unbounded storage growth or indefinite PII accumulation.

---

## 2. Data Classification & Retention Matrix

| Data Classification | Category / Collections | Retention Period | Action | Protection / Legal Hold Exceptions |
|---|---|---|---|---|
| **Telemetry & Prompt Events** | `InboundWebhookEvent`, `QuarantinedEvent` | **30 days** | Archive & Scrub | Protected if `retentionHold: true` or unresolved/pending replay |
| **Export Artifacts** | `JobRecord` (`export_csv`) | **30 days** | Archive & Scrub | Protected if active export job is still running |
| **Support Evidence & Cases** | `Report`, `SupportCase` | **365 days** (post-resolution) | Archive & Scrub | Protected if under active dispute (`status: open / investigating`) or `retentionHold: true` |
| **Audit Logs** | `AuditLog` | **Permanent** | Preserve | Never eligible for automated cleanup |
| **Financial Records** | `LedgerEntry`, `PayoutStatement` | **Permanent** | Preserve | Never eligible for automated cleanup |
| **Blockchain Transactions** | `Purchase`, `Entitlement`, `IndexerState` | **Permanent** | Preserve | Never eligible for automated cleanup |

---

## 3. Scrubbing & Archival Behavior

When eligible records exceed their retention cutoff:
1. **Inbound Webhook Events**: Scrub `rawBody`, `rawHeaders`, and set `archivedAt: Date`.
2. **Quarantined Events**: Unset `rawTopic`, `rawValue`, `rawXdr`, `errorDetails`, and set `archivedAt: Date`.
3. **Export CSVs**: Reset payload to `{ version: 1, archived: true }`, clear `attemptHistory` & `lastError`.
4. **Support Reports & Cases**: Redact `reporterAddress: "[REDACTED]"`, clear `evidence` array and internal notes.

---

## 4. Protected Records & Legal Hold

Records are strictly exempt from automated retention cleanup when:
- **Explicit Retention Hold**: Record has `retentionHold: true`.
- **Active Incident / Open Case**: Status is `open`, `investigating`, or `escalated`.
- **Financial Settlement Imbalance**: Record is tied to an unsettled payout ledger entry.
- **Audit Requirement**: Any record in the permanent preservation class (`auditLogs`, `financialRecords`, `blockchainRecords`).

---

## 5. Running Retention Cleanup

### Dry-Run Mode (Safety Check)
To calculate and preview how many records would be affected without modifying the database:

```bash
# Via CLI script
npx ts-node server/scripts/enqueueRetentionCleanup.ts --dry-run
```

Output reports document counts per category:
```json
{
  "inboundWebhookEvents": { "archived": 12, "dryRun": true },
  "quarantinedEvents": { "archived": 2, "dryRun": true },
  "exports": { "archived": 5, "dryRun": true },
  "supportEvidence": { "archived": 1, "dryRun": true }
}
```

### Scheduled / Live Execution
The worker processes daily retention cleanup jobs enqueued via:
```bash
npx ts-node server/scripts/enqueueRetentionCleanup.ts
```
