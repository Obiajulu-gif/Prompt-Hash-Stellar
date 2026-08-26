# Backup and Recovery — PromptHash Indexer DB

_Issue #135 — Automated Backup and Recovery for Indexer DB_

---

## Overview

The PromptHash indexer stores off-chain prompt metadata (titles, pricing, ownership, purchase counts, audit logs) in MongoDB. Because all on-chain state can be replayed from the Stellar ledger, the DB is reproducible from scratch. However, full re-indexing can take many minutes; regular backups reduce recovery time to seconds.

Two complementary recovery paths are provided:

| Path | When to use | RTO |
|------|------------|-----|
| **Restore from S3 backup** | DB is corrupted or accidentally wiped; ledger data is intact | ~5 min |
| **Re-index from ledger** | Backup is stale or unavailable; requires live RPC access | ~15–60 min depending on chain height |

---

## Architecture

```
MongoDB (running)
    │
    ▼ daily at 02:00 UTC
backupService.ts ──► NDJSON.gz per collection ──► S3 bucket
    │
    ▼ records outcome
BackupRun collection (status, age, s3Keys)
    │
    ▼ polled by
GET /health  ──► backup.lastStatus, backup.ageHours, backup.healthy
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKUP_S3_BUCKET` | Yes (to enable backups) | S3 bucket name |
| `BACKUP_S3_PREFIX` | No | Key prefix (default: `backups`) |
| `BACKUP_S3_REGION` | No | AWS region (default: `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | Yes | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS credentials |
| `BACKUP_ALERT_WEBHOOK` | No | Slack/webhook URL for failure alerts |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `PUBLIC_STELLAR_RPC_URL` | Yes (re-index only) | Soroban RPC endpoint |
| `PUBLIC_PROMPT_HASH_CONTRACT_ID` | Yes (re-index only) | Contract ID |

---

## Backup Operations

### Trigger a manual backup

```bash
# Using npm script
cd server && npm run backup

# Or directly
ts-node server/scripts/runBackup.ts
```

Backups are stored at:
```
s3://<BACKUP_S3_BUCKET>/<BACKUP_S3_PREFIX>/<ISO-timestamp>/<collection>.ndjson.gz
```

Example:
```
s3://my-bucket/backups/2025-05-27T02-00-00-000Z/prompts.ndjson.gz
s3://my-bucket/backups/2025-05-27T02-00-00-000Z/purchases.ndjson.gz
s3://my-bucket/backups/2025-05-27T02-00-00-000Z/promptversions.ndjson.gz
s3://my-bucket/backups/2025-05-27T02-00-00-000Z/indexerstates.ndjson.gz
s3://my-bucket/backups/2025-05-27T02-00-00-000Z/auditlogs.ndjson.gz
```

### Schedule (cron)

Install `server/backup.crontab` to run daily at 02:00 UTC:

```bash
crontab server/backup.crontab
```

The server also starts an in-process 24-hour interval automatically when `BACKUP_S3_BUCKET` is set.

### Monitor backup health

The `/health` endpoint includes backup status:

```json
{
  "status": "ok",
  "indexer": { "lastProcessedLedger": 12345678, "timestamp": "..." },
  "backup": {
    "lastRun": "2025-05-27T02:00:12.000Z",
    "lastStatus": "success",
    "ageHours": 3.2,
    "healthy": true
  }
}
```

A backup is considered **unhealthy** if:
- `lastStatus` is `"failure"` or `"never"`
- `ageHours` > 26 (missed a daily window)

Set up an alert on `backup.healthy === false` in your monitoring tool.

---

## Recovery Procedure — Restore from S3 Backup

Use this when the DB is lost or corrupted and you have a recent backup.

### Step 1 — Identify the latest successful backup

```bash
# List available backup timestamps
aws s3 ls s3://<BACKUP_S3_BUCKET>/backups/ --recursive | grep prompts.ndjson.gz | sort | tail -5

# Or query the BackupRun collection
mongosh "$MONGODB_URI" --eval 'db.backupruns.find({status:"success"}).sort({createdAt:-1}).limit(5)'
```

### Step 2 — Download and decompress the backup

```bash
TIMESTAMP="2025-05-27T02-00-00-000Z"
BUCKET="my-bucket"
PREFIX="backups"

mkdir -p /tmp/prompthash-restore
for col in prompts purchases promptversions indexerstates auditlogs; do
  aws s3 cp "s3://${BUCKET}/${PREFIX}/${TIMESTAMP}/${col}.ndjson.gz" /tmp/prompthash-restore/
  gunzip "/tmp/prompthash-restore/${col}.ndjson.gz"
done
```

### Step 3 — Import into MongoDB

```bash
# Drop existing collections first (destructive!)
mongosh "$MONGODB_URI" --eval '
  ["prompts","purchases","promptversions","indexerstates","auditlogs"].forEach(c => db[c].drop())
'

# Import each collection
for col in prompts purchases promptversions indexerstates auditlogs; do
  mongoimport \
    --uri "$MONGODB_URI" \
    --collection "$col" \
    --file "/tmp/prompthash-restore/${col}.ndjson" \
    --jsonArray=false
done
```

### Step 4 — Verify and restart the server

```bash
# Verify record counts
mongosh "$MONGODB_URI" --eval '
  ["prompts","purchases","indexerstates"].forEach(c =>
    print(c, ":", db[c].countDocuments()))
'

# Restart the backend server
pm2 restart prompthash-server   # or systemctl restart prompthash
```

---

## Recovery Procedure — Re-Index from Stellar Ledger

Use this when:
- No usable S3 backup exists
- The backup is too stale and you need a fully current state
- You suspect data corruption that pre-dates the last backup

### Step 1 — Dry run (preview only, no writes)

```bash
cd server && npm run reindex:dry-run
# Or with a custom start ledger:
ts-node scripts/reIndexFromLedger.ts --dry-run --from 40000000
```

Review the summary output. Check that event counts look plausible.

### Step 2 — Full re-index (destructive)

```bash
# This wipes Prompt, User, and IndexerState collections then replays all events.
ts-node scripts/reIndexFromLedger.ts --confirm

# Or start from a specific ledger (e.g., contract deployment ledger):
ts-node scripts/reIndexFromLedger.ts --confirm --from <deployment-ledger>
```

Progress is printed per batch (2000 ledgers each). On testnet this typically takes under 5 minutes; on mainnet with years of history it may take longer.

### Step 3 — Verify

```bash
mongosh "$MONGODB_URI" --eval 'db.prompts.countDocuments()'
mongosh "$MONGODB_URI" --eval 'db.indexerstates.findOne()'
```

Check `GET /health` returns `indexer.lastProcessedLedger` near the current chain tip.

---

## Retention Policy

By default, daily backups accumulate indefinitely. Enable lifecycle cleanup via:

**AWS S3 lifecycle rule** (recommended):
```json
{
  "Rules": [{
    "ID": "prompthash-backup-retention",
    "Prefix": "backups/",
    "Status": "Enabled",
    "Expiration": { "Days": 30 }
  }]
}
```

Or use the weekly cleanup snippet in `server/backup.crontab` (requires AWS CLI on host).

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| `/health` shows `backup.healthy: false` | Backup failed or missed window | Check `/var/log/prompthash-backup.log`; run `npm run backup` manually |
| S3 upload fails with `AccessDenied` | Missing IAM permissions | Ensure the role has `s3:PutObject` on the target bucket |
| Re-index script exits with `Missing required environment variable` | Env not set | Export `MONGODB_URI`, `PUBLIC_STELLAR_RPC_URL`, `PUBLIC_PROMPT_HASH_CONTRACT_ID` |
| Re-index exits without `--confirm` or `--dry-run` | Safety guard | Add the appropriate flag |
| RPC timeout during re-index | Chain tip far ahead | Script retries per batch; reduce `BATCH_SIZE` constant if needed |
| `mongoimport` not found | Tool not installed | Install `mongodb-database-tools` package |

---

## Related Documents

- [Runbook](./runbook.md) — Operational monitoring and debugging
- [Incident Response](./incident-response.md) — Escalation procedures
- [Security Audit](../security-audit.md) — AUD-06: key material storage
