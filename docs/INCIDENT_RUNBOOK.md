# Incident Response Runbook — Prompt Hash Stellar

> **Purpose**: Guide operators through diagnosing incidents, disabling risky features, reconciling affected records, and communicating recovery status.
>
> **Audience**: Maintainers, operations, and on-call engineers.
>
> **Last Updated**: 2026-09-26

---

## Quick Reference

| Incident | Triage Command | Rollback Action |
|----------|----------------|-----------------|
| Search indexing failures | `yarn diagnose search` | `yarn jobs:run repair-index` |
| Permission/visibility issues | `yarn diagnose permissions` | `yarn repair:permissions` |
| Signature/hash mismatches | `yarn diagnose signatures` | Re-index affected records |
| Contract deployment failure | `yarn verify-contract` | Revert to last stable hash in `contracts.json` |
| Database corruption | `yarn db:verify` | Restore from backup; replay events |
| Payment settlement stuck | `yarn verify-payments` | `yarn jobs:run settlement-poll` |

---

## 1. Incident Categories

### Category A: Data Visibility & Search (Critical)
**Symptoms**: Search results incomplete, unauthorized records visible, missing records.

**Root Causes**:
- Permission filters not applied during indexing
- Stale index entries for deleted/hidden records
- Cache staleness

**Impact**: Data exposure risk, trust impact, possible compliance violation.

**Detection**:
```bash
# Check for visibility violations in search results
yarn verify:search-visibility

# Scan for stale index entries
yarn jobs:run repair-index --dry-run

# Validate permission filters
yarn test:permissions
```

### Category B: Contract & Settlement (High)
**Symptoms**: Transactions stuck, mismatched on-chain state, failed payments.

**Root Causes**:
- Contract state desynchronized from database
- Settlement job hung or crashed
- Signature/hash mismatch on signed data

**Impact**: Revenue impact, user trust, possible fund loss.

**Detection**:
```bash
# Verify contract state
yarn verify-contract

# Check settlement queue
yarn jobs:status settlement-poll

# Validate signatures
yarn verify:canonical-signatures
```

### Category C: Operational (Medium)
**Symptoms**: Slow endpoints, worker errors, job queue backlog.

**Root Causes**:
- Job queue saturation
- Database connection pool exhausted
- Memory leak in indexer

**Impact**: Degraded user experience, potential availability impact.

**Detection**:
```bash
# Health check
yarn diagnose --verbose

# Job queue status
yarn jobs:status

# Database connection pool
yarn db:pool-status
```

### Category D: Authentication & Authorization (High)
**Symptoms**: Users locked out, admin functions unavailable, incorrect role grants.

**Root Causes**:
- JWT signing key rotation failed
- Role cache stale
- Wallet connection timeout

**Impact**: Service unavailability, user frustration.

**Detection**:
```bash
# Verify auth keys
yarn verify-auth-keys

# Check role cache
yarn cache:status roles

# Test wallet connectivity (staging)
yarn test:wallet-mock
```

---

## 2. Triage Workflow

### Step 1: Identify the Category

**Questions**:
1. Are users reporting missing/wrong search results? → **Category A**
2. Are payments stuck or transactions failing? → **Category B**
3. Are endpoints slow or jobs piling up? → **Category C**
4. Are users unable to log in or access resources? → **Category D**

**Action**: Run the appropriate diagnostics command (see table above).

### Step 2: Assess Severity

**Critical** (P1):
- Data exposure or security risk
- Complete service unavailability
- Revenue-impacting settlement issues

**High** (P2):
- Partial feature degradation
- Elevated error rates (>5%)
- Single-user lockout for high-value accounts

**Medium** (P3):
- Performance degradation
- Intermittent errors (<5%)
- Cosmetic or workflow friction

**Action**: Page appropriate on-call engineer; notify #prompt-hash-incident Slack channel.

### Step 3: Gather Context

**Collect**:
```bash
# Application logs (last 15 min)
yarn logs:app --tail 500 --since "15m ago"

# Error rate and affected endpoints
yarn metrics:errors --since "30m ago"

# Job queue status
yarn jobs:status

# Database query performance
yarn db:slow-queries --limit 20

# Recent deployments
git log --oneline -10 main
```

**Store** context in incident ticket with timestamp.

---

## 3. Mitigation Strategies

### Disable a Risky Feature (Emergency)

If a newly deployed feature is causing incidents:

```bash
# 1. Disable the feature flag
yarn feature-flags:set FEATURE_NAME disabled

# 2. Verify it's disabled
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.example.com/admin/feature-flags | jq '.[] | select(.name=="FEATURE_NAME")'

# 3. Monitor error rates
watch -n 5 'yarn metrics:errors --since "10m ago"'

# 4. If errors persist, proceed to rollback (see below)
```

### Repair Search Index (Category A)

```bash
# 1. Dry run to see what needs repair
yarn jobs:run repair-index --dry-run | head -50

# 2. Run repair (auto-fixes issues)
yarn jobs:run repair-index --auto-fix

# 3. Validate results
yarn verify:search-visibility
yarn test:search-tests

# 4. Monitor for regressions
watch -n 10 'yarn metrics:search --since "5m ago"'
```

### Fix Permission Issues (Category A)

```bash
# 1. Identify affected records
yarn repair:permissions --scan-only --limit 100

# 2. Review scope of impact
yarn repair:permissions --scan-only --summary

# 3. Auto-repair (changes visibility flags)
yarn repair:permissions --auto-fix

# 4. Verify fix
yarn verify:search-visibility

# 5. Check affected user accounts didn't lose access
yarn verify:user-access --sample-size 50
```

### Fix Signature Mismatches (Category B)

```bash
# 1. Find affected records
yarn verify:canonical-signatures --report

# 2. Re-hash affected records with canonical serialization
yarn repair:signatures --dry-run

# 3. Apply fixes
yarn repair:signatures --auto-fix

# 4. Verify settlement matches
yarn verify:settlement-state
```

### Full Rollback (Emergency Last Resort)

```bash
# 1. Identify last stable release tag
git tag -l --sort=-version:refname | head -5

# 2. Create rollback branch
git checkout -b rollback-from-FAILED-TAG v1.2.3
git log --oneline -5

# 3. Verify contract hash in stable release
cat contracts.json | jq '.contract_hash'

# 4. Notify stakeholders of rollback
# (message template in #prompt-hash-incident Slack)

# 5. Deploy rollback branch
# (follow deployment runbook; DO NOT force-push)

# 6. Verify service is back online
yarn diagnose

# 7. Post-mortem: run repair jobs to reconcile missed events
yarn jobs:run settlement-poll
yarn jobs:run notify-rebuild
```

---

## 4. Communication & Recovery

### Incident Declared

**Slack Message Template**:
```
:warning: **INCIDENT** #NNNNN [Category/Severity]

**Issue**: [one-line description]
**Affected Users**: [scope or count]
**Estimated Impact**: [data/revenue/users]
**Status**: Investigating

**Updates**: [link to incident ticket]
```

### Mitigation In Progress

**Update Every 15 minutes**:
```
**Status**: Mitigation in progress
**Action**: [feature flag disabled | index repair running | rollback staged]
**ETA**: [time or "TBD"]
**Next Step**: [wait for job completion | manual verification | proceed to rollback]
```

### Recovery Complete

**Final Message**:
```
:white_check_mark: **RESOLVED**

**Root Cause**: [brief summary]
**Fix Applied**: [action taken]
**Verification**: [command run to confirm]
**Post-Mortem**: [link to ticket; due within 48 hours]
```

---

## 5. Validation Commands

### Verify Search Health

```bash
# Index size and freshness
yarn stats:index

# Spot-check permission filtering
yarn verify:search-visibility --sample-size 100

# Full compliance test (slower)
yarn test:search-permissions
```

### Verify Settlement State

```bash
# Compare on-chain and database states
yarn verify:settlement-state

# Check for stuck transactions
yarn verify:payments --pending-threshold 3600

# Replay events for reconciliation (dry-run)
yarn replay-events --since "2024-09-26 10:00" --dry-run
```

### Verify Authentication

```bash
# JWT key expiration and validity
yarn verify-auth-keys

# Role cache freshness
yarn cache:status roles --verbose

# Admin access (use staging account)
curl -X GET \
  -H "Authorization: Bearer $STAGING_TOKEN" \
  https://staging-api.example.com/admin/users | jq '.[0]'
```

---

## 6. Escalation Path

| Severity | Response Time | Escalate To | Communication |
|----------|---------------|-------------|-----------------|
| P1       | 5 minutes     | On-call lead + Engineering manager | #prompt-hash-incident + email |
| P2       | 15 minutes    | On-call engineer | #prompt-hash-incident |
| P3       | 1 hour        | Engineering team standup | Jira ticket |

**Escalation Contacts**:
- On-call: See PagerDuty rotation
- Engineering Manager: Check #eng-team Slack topic
- Maintainers: See CONTRIBUTING.md

---

## 7. Post-Incident (Within 48 Hours)

**Required**:
1. **Root Cause Analysis**: Why did this occur? Design gap or deployment error?
2. **Prevention**: What monitoring/test would have caught this earlier?
3. **Remediation**: Fix to code, config, or runbook to prevent recurrence?
4. **Communication**: Did customers/partners know? Should they be notified of fix?

**Template**: See `INCIDENT_POSTMORTEM.md`

---

## 8. Common Fixes (Copy-Paste)

### Search Index Repair
```bash
# Full diagnosis and repair
yarn jobs:run repair-index --auto-fix && \
  yarn verify:search-visibility && \
  yarn metrics:search --since "5m ago"
```

### Permission Sync
```bash
# Reconcile visibility with records
yarn repair:permissions --auto-fix && \
  yarn test:search-permissions --sample 50
```

### Settlement Reconciliation
```bash
# Catch up any missed settlement events
yarn jobs:run settlement-poll && \
  yarn verify:settlement-state && \
  yarn notify-rebuild
```

### Contract Verification
```bash
# Ensure contract state matches database
yarn verify-contract && \
  yarn verify:canonical-signatures --report
```

---

## Appendix: Environment Variables Needed

- `ADMIN_TOKEN`: API auth for admin diagnostics
- `DATABASE_URL`: Primary database connection
- `REDIS_URL`: Cache and job queue
- `STELLAR_NETWORK`: Network name (testnet/mainnet)
- `SLACK_WEBHOOK`: #prompt-hash-incident notifications (optional)

All sensitive values are in 1Password; see CONTRIBUTING.md for access.
