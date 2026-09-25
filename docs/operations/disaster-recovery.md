# Disaster Recovery & Backup Integrity Runbook

_Issues #135 & #607 — Automated Backup, Checksum Validation, Dry-Run Verification, and Disaster Recovery Runbook_

---

## 1. Overview

The PromptHash indexer DB stores off-chain prompt metadata, entitlement receipts, indexer state pointers, and audit logs in MongoDB. To ensure zero data loss and fast recovery during database loss or corruption, PromptHash provides an automated backup and checksum-verified restore service.

### Recovery Paths & SLA

| Recovery Path | Use Case | RTO | Integrity Mechanism |
|---|---|---|---|
| **S3 / Local Restore** | DB loss, data corruption, migration | < 3 minutes | SHA-256 Checksum + NDJSON Line Validation |
| **Ledger Re-index** | Severe corruption, missing backups | ~15–60 min | On-chain Stellar Event Replay |

---

## 2. Backup Integrity Architecture

```
[MongoDB Database]
       │
       ▼ (exports NDJSON)
[SHA-256 Hash Computation] ──► manifest.json (contains SHA-256 per collection)
       │
       ▼ (gzip compression)
[s3://bucket/backups/<timestamp>/]
       ├── manifest.json
       ├── prompts.ndjson.gz
       ├── purchases.ndjson.gz
       ├── indexerstates.ndjson.gz
       └── auditlogs.ndjson.gz
```

Each backup run automatically generates:
1. **Per-Collection SHA-256 Checksums**: Uncompressed NDJSON content hash stored in `manifest.json`.
2. **Document Counts & Sizes**: Document counts and byte sizes for verification.
3. **Audit Log & Health Record**: Registered in MongoDB `BackupRun` collection and monitored via `GET /health`.

---

## 3. Disaster Recovery Operator Runbook

### Step 1: Perform a Dry-Run Integrity Verification (Safety First)

Before restoring data into a live MongoDB cluster, always run a **dry-run** to verify file integrity, checksums, and JSON formatting without altering live database records.

```bash
# Verify S3 backup integrity in dry-run mode:
ts-node server/scripts/runRestore.ts --timestamp 2026-08-24T18-00-00-000Z --dry-run

# Or verify a local backup directory:
ts-node server/scripts/runRestore.ts --local-dir /backups --timestamp 2026-08-24T18-00-00-000Z --dry-run
```

**Expected Dry-Run Output**:
```json
{
  "success": true,
  "dryRun": true,
  "timestamp": "2026-08-24T18-00-00-000Z",
  "totalDocuments": 4250,
  "collections": [
    { "name": "prompts", "docCount": 1200, "sha256Verified": true, "jsonValid": true },
    { "name": "purchases", "docCount": 3000, "sha256Verified": true, "jsonValid": true },
    { "name": "indexerstates", "docCount": 50, "sha256Verified": true, "jsonValid": true }
  ],
  "message": "Backup integrity verified successfully. Dry run completed without modifying database."
}
```

If SHA-256 checksum mismatch or corrupted NDJSON is detected, `runRestore` immediately aborts and exits with status `1` without modifying any database collection.

---

### Step 2: Perform Live Database Restore (Requires `--confirm`)

Once dry-run integrity verification succeeds, perform the live restore using the `--confirm` safety flag:

```bash
ts-node server/scripts/runRestore.ts --timestamp 2026-08-24T18-00-00-000Z --confirm
```

The script will:
1. Re-validate SHA-256 checksums and JSON line syntax.
2. Atomically drop target collections.
3. Import validated records into MongoDB.
4. Output the restore report.

---

### Step 3: Post-Restore Health Verification

1. Check database document counts:
   ```bash
   mongosh "$MONGODB_URI" --eval 'db.prompts.countDocuments()'
   mongosh "$MONGODB_URI" --eval 'db.indexerstates.findOne()'
   ```
2. Verify backend `/health` endpoint status:
   ```bash
   curl http://localhost:5000/health
   ```
   Ensure `indexer.lastProcessedLedger` is active and `backup.healthy` reports `true`.

---

## 4. Security & Replay Prevention

- **Corrupted Backup Protection**: Any tampered byte or incomplete upload triggers a checksum mismatch and halts restore before live data is touched.
- **Event Replay Guard**: IndexerState restore restores event cursor positions so processed on-chain events are not replayed twice.
