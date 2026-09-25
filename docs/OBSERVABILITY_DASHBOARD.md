# Observability Dashboard: Purchase Funnel Metrics

**Issue:** #724  
**Status:** Production-ready  
**Last Updated:** September 2026

## Overview

The Purchase Funnel Dashboard provides maintainers with operational visibility into purchase latency, wallet signing failures, unlock failures, conversion drop-offs, and webhook processing health. Metrics are tracked across 10 distinct funnel stages with failure reason categorization and alert thresholds.

## Funnel Stages

The purchase flow is decomposed into these observable stages:

1. **BROWSE** - User views marketplace listing page
2. **DETAIL_VIEW** - User opens individual prompt detail view
3. **BUY_INITIATED** - User clicks "Buy" button
4. **CHALLENGE_ISSUED** - Server issues wallet challenge token
5. **CHALLENGE_SIGNED** - User signs challenge with wallet
6. **PURCHASE_TX_SUBMITTED** - Purchase transaction submitted to blockchain
7. **PURCHASE_TX_CONFIRMED** - Transaction confirmed on-chain
8. **UNLOCK_ATTEMPT** - Unlock endpoint called
9. **UNLOCK_SUCCESS** - Prompt successfully decrypted and returned
10. **RECEIPT_VIEWED** - User views purchase receipt

## Metrics Collected

### Success Rate
- **Definition:** `(successCount / (successCount + failureCount)) * 100`
- **Unit:** Percentage
- **Calculation:** Tracked per stage; updated on each success/failure record
- **Example:** If 8 out of 10 unlock attempts succeed, success rate = 80%

### Conversion Rate
- **Definition:** `(successCount at stage / totalFunnelStarts) * 100`
- **Unit:** Percentage
- **Significance:** Measures drop-off from initial browse to each subsequent stage
- **Example:** If 100 users browse and 75 reach detail view, conversion = 75%

### Latency Metrics
All latency values are captured in milliseconds:

- **Average Latency:** `totalLatencyMs / attemptCount`
  - Tracks typical response time for a stage
  - Used for baseline performance monitoring

- **p95 Latency:** 95th percentile of all samples
  - Identifies worst-case performance outliers
  - More sensitive to tail latency than average
  - Used for SLA enforcement

- **p99 Latency:** 99th percentile (available in extended snapshots)
  - Tracks most extreme outliers
  - Used for capacity planning

### Failure Reasons
Each failure is categorized into specific reasons for root cause analysis:

#### Pre-Purchase Failures
- `BROWSE_LOAD_ERROR` - Listing page failed to load
- `DETAIL_NOT_FOUND` - Prompt detail page not found (404)
- `MODERATION_RESTRICTED` - Prompt hidden due to moderation
- `WALLET_CONNECT_FAILED` - Wallet connection failed
- `WALLET_WRONG_NETWORK` - Wallet on incorrect blockchain

#### Challenge Stage Failures
- `CHALLENGE_RATE_LIMITED` - Too many challenge requests
- `CHALLENGE_EXPIRED` - Challenge token TTL exceeded

#### Signing Failures
- `SIGNATURE_FAILED` - Wallet signing operation failed
- `SIGNATURE_INVALID` - Server rejected signature verification
- `SIGNATURE_TIMEOUT` - User didn't sign within timeout
- `USER_REJECTED` - User explicitly rejected wallet signature

#### Transaction Failures
- `TX_SUBMISSION_FAILED` - Blockchain submission error
- `TX_INSUFFICIENT_BALANCE` - Wallet has insufficient XLM
- `TX_NETWORK_ERROR` - RPC/network connectivity issue
- `TX_CONFIRMATION_TIMEOUT` - Transaction not confirmed within window

#### Unlock Failures
- `UNLOCK_RATE_LIMITED` - Too many unlock attempts (per-wallet or per-prompt throttling)
- `UNLOCK_NO_ACCESS` - Buyer has no entitlement to this prompt
- `UNLOCK_LEDGER_FAILED` - Ledger verification RPC error
- `UNLOCK_INTEGRITY_FAILED` - Decrypted content hash mismatch
- `UNLOCK_STALE_TERMS` - Prompt price/version changed since purchase
- `UNKNOWN_ERROR` - Uncategorized error

## Alert Thresholds

### Conversion Thresholds
These identify when funnel stages are dropping off unexpectedly:

| Threshold | Stage | Minimum % | Severity | Action |
|-----------|-------|-----------|----------|--------|
| `min_detail_view_conversion` | Detail View | 50% | warn | Investigate listing page UX, error rates |
| `min_buy_initiated_conversion` | Buy Initiated | 20% | warn | Check pricing, form validation, errors |
| `min_unlock_success_conversion` | Unlock Success | 60% | **critical** | Immediate escalation; core purchase flow broken |

### Latency Thresholds
These enforce SLA expectations and identify performance regressions:

| Threshold | Stage | Latency | Severity |
|-----------|-------|---------|----------|
| `challenge_p95_warn_ms` | Challenge Issued | 1,500 ms | warn |
| `challenge_p95_critical_ms` | Challenge Issued | 4,000 ms | **critical** |
| `unlock_p95_warn_ms` | Unlock Success | 3,000 ms | warn |
| `unlock_p95_critical_ms` | Unlock Success | 8,000 ms | **critical** |

### Failure Rate Thresholds
These track specific failure modes:

| Threshold | Metric | Limit | Severity |
|-----------|--------|-------|----------|
| `unlock_failure_rate_warn_pct` | Unlock failures | 5% | warn |
| `unlock_failure_rate_critical_pct` | Unlock failures | 15% | **critical** |
| `wallet_connect_failure_rate_warn_pct` | Wallet connection failures | 10% | warn |

## Implementation Details

### Instrumentation Locations

Endpoints that must record funnel events:

| Endpoint | Stage(s) | Success Call | Failure Call |
|----------|----------|--------------|--------------|
| `GET /api/prompts` | BROWSE, DETAIL_VIEW | `recordStageSuccess(BROWSE/DETAIL_VIEW, ms)` | `recordStageFailure(stage, reason)` |
| `POST /api/auth/challenge` | CHALLENGE_ISSUED | `recordStageSuccess(CHALLENGE_ISSUED, ms)` | `recordStageFailure(CHALLENGE_ISSUED, reason)` |
| `POST /api/prompts/unlock` | CHALLENGE_SIGNED, UNLOCK_SUCCESS | `recordStageSuccess(stage, ms)` | `recordStageFailure(stage, reason)` |
| `POST /api/webhooks` (PromptPurchased) | PURCHASE_TX_CONFIRMED, RECEIPT_VIEWED | `recordStageSuccess(PURCHASE_TX_CONFIRMED, ms)` | N/A |

### Data Privacy

Instrumentation is designed to NOT capture:

- **Wallet addresses:** Only used for rate limit scoping; not logged in metrics
- **Plaintext secrets:** Challenge tokens, signatures, or private keys never appear in logs
- **Prompt content:** Only metadata (ID, title) included; no decrypted content
- **Buyer PII:** No email, IP, or personal information in funnelMetrics

### Correlation IDs

Each request must include a correlation ID for tracing:

1. **Request ID:** Set by `withObservability` wrapper (UUID format)
2. **Usage:** Included in audit logs and error responses
3. **Propagation:** Passed through API responses for client-side tracing

```typescript
// Header example
X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

## Dashboard Query Examples

### Prometheus Queries

```promql
# 30-day unlock success rate
100 * (
  sum(rate(purchase_funnel_success_total{stage="unlock_success"}[30d]))
  /
  (
    sum(rate(purchase_funnel_success_total{stage="unlock_success"}[30d]))
    +
    sum(rate(purchase_funnel_failure_total{stage="unlock_success"}[30d]))
  )
)

# Unlock p95 latency over past hour
histogram_quantile(0.95, rate(purchase_funnel_latency_seconds_bucket{stage="unlock_success"}[1h]))

# Top 5 failure reasons for unlock stage (past 24h)
topk(5, sum by (reason) (
  rate(purchase_funnel_failure_total{stage="unlock_success"}[24h])
))

# Conversion rate from browse to detail (past 7 days)
100 * (
  sum(rate(purchase_funnel_success_total{stage="detail_view"}[7d]))
  /
  sum(rate(purchase_funnel_success_total{stage="browse"}[7d]))
)
```

### CloudWatch Queries

```json
{
  "queries": {
    "unlock_success_rate": "fields @timestamp, successCount, failureCount | stats sum(successCount) as successes, sum(failureCount) as failures by stage | filter stage = 'unlock_success'",
    "p95_latency": "fields @timestamp, latencyMs | filter stage = 'unlock_success' | stats pct(latencyMs, 95) as p95",
    "failure_reasons": "fields @timestamp, reason, failureCount | filter stage = 'unlock_success' | stats sum(failureCount) as count by reason | sort count desc"
  }
}
```

### SQL (Time-Series DB)

```sql
-- Daily unlock success rate trend
SELECT
  DATE(recorded_at) as date,
  ROUND(100.0 * COUNT(*) FILTER (WHERE result = 'success') / COUNT(*), 2) as success_rate_pct,
  ROUND(AVG(latency_ms) FILTER (WHERE result = 'success'), 0) as avg_latency_ms
FROM funnel_events
WHERE stage = 'unlock_success'
  AND recorded_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(recorded_at)
ORDER BY date DESC;

-- Failure distribution (past 7 days)
SELECT
  reason,
  COUNT(*) as failure_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pct
FROM funnel_events
WHERE stage = 'unlock_success' AND result = 'failure'
  AND recorded_at >= NOW() - INTERVAL '7 days'
GROUP BY reason
ORDER BY failure_count DESC;
```

## Incident Response Workflows

### Scenario 1: Unlock Success Rate Drops Below 60%

**Alert:** `critical` - Unlock success rate < 60%

**Investigation Steps:**

1. Check `topFailureReasons` to identify which reason dominates
2. By reason:
   - **UNLOCK_NO_ACCESS:** Check ledger verification (RPC health, network issues)
   - **UNLOCK_LEDGER_FAILED:** Escalate to blockchain team; RPC failure
   - **UNLOCK_RATE_LIMITED:** Check if throttling is too aggressive; review composite bucket settings
   - **UNLOCK_INTEGRITY_FAILED:** Data corruption; check IPFS/encryption key rotation
   - **USER_REJECTED:** Expected in some cases; check fraud patterns

3. Cross-reference with audit logs using correlation IDs from error responses
4. Query wallet activity for patterns (same user, same prompt, repeated failures)

### Scenario 2: Unlock p95 Latency > 8 seconds

**Alert:** `critical` - Unlock p95 latency 8000+ ms

**Investigation Steps:**

1. Break down latency by component:
   - Challenge verification (token parsing, signature check)
   - Ledger RPC call (entitlement verification)
   - IPFS fetch (if applicable)
   - Decryption (CPU-bound)

2. Check external dependencies:
   - RPC endpoint latency and error rates
   - IPFS gateway health
   - Blockchain network congestion (high gas, slow blocks)

3. Review recent deployments or config changes
4. Scale up database/cache resources if bottleneck is query performance

### Scenario 3: Detail View Conversion Drops to 40%

**Alert:** `warn` - Detail view conversion < 50%

**Investigation Steps:**

1. Check if drop is from same cohort or new traffic source
2. Review error logs for 404s, 500s on detail endpoint
3. Check moderation status changes (many prompts suddenly restricted?)
4. Review frontend error tracking (JavaScript errors, failed network requests)
5. If category-specific: check taxonomy changes or indexing issues

### Scenario 4: Challenge Request Rate Limit Violations

**Alert:** `warn` - Challenge rate-limited failures spike

**Investigation Steps:**

1. Identify source (IP address, wallet address from audit logs)
2. Determine if legitimate user retry or abuse attempt:
   - Expected in weak wallet connections (retry after timeout)
   - Suspicious if single IP hammering many prompts
3. Consider raising limits temporarily for affected users
4. Check if clients are implementing exponential backoff

## Extending the Dashboard

### Adding a New Failure Reason

1. Add enum value to `PurchaseFailureReason` in `purchaseFunnelMetrics.ts`:
   ```typescript
   export enum PurchaseFailureReason {
     // ...existing...
     MY_NEW_REASON = 'my_new_reason',
   }
   ```

2. Call `recordStageFailure()` in appropriate endpoint when error condition detected

3. Add threshold alert (if needed) in `checkPurchaseFunnelHealth()`

4. Update this doc with new reason definition and incident response steps

### Connecting to External Observability

The in-memory `purchaseFunnelTracker` is designed to be swapped with production-grade backends:

```typescript
// Option 1: Export metrics to Prometheus
export function exportPrometheusMetrics() {
  const snapshot = purchaseFunnelTracker.getConversionSnapshot();
  return snapshot.map(s => ({
    metric: 'purchase_funnel_conversion',
    stage: s.stageName,
    value: s.conversionRate,
    timestamp: s.timestamp,
  }));
}

// Option 2: Batch to external APM (Datadog, New Relic)
export async function flushMetricsToAPM() {
  const snapshot = purchaseFunnelTracker.getConversionSnapshot();
  await apmClient.reportMetrics(snapshot);
  purchaseFunnelTracker.reset(); // Reset after flush
}
```

## Known Limitations

### In-Memory Storage
- Metrics are stored in-memory and lost on process restart
- For production use, integrate with persistent metrics backend (Prometheus, InfluxDB, etc.)
- Current implementation suitable for development and short-term dashboards

### Single Process
- Multi-instance deployments will see fragmented metrics
- Production: Use centralized metrics aggregation (Prometheus scrape targets, APM agent)

### Webhook Delivery Monitoring
- Not yet implemented; webhook events are tracked in audit logs only
- **TODO:** Add instrumentation to webhook delivery retry logic and failure categorization

### Distributed Tracing
- **Not implemented:** Correlation IDs are set but not propagated to downstream services
- **TODO:** Add OpenTelemetry integration for full request tracing across service boundaries

### Real-Time Alerting
- Alerts are checked on-demand via `checkPurchaseFunnelHealth()`
- **TODO:** Integrate with alerting system (PagerDuty, Slack, email) for real-time notifications

## Testing

Comprehensive test suites validate instrumentation:

```bash
# Unit tests for funnel metrics
npm test -- src/test/observability/purchaseFunnelMetrics.test.ts

# Integration tests for endpoint instrumentation
npm test -- src/test/observability/funnel-instrumentation.test.ts

# End-to-end test (manual)
1. Open marketplace, view listing, add to cart, proceed to checkout
2. Complete challenge signature and payment flow
3. Verify unlock success and receipt view
4. Check metrics dashboard shows 100% conversion and reasonable latency
```

## References

- **Issue:** #724 - Observability dashboard for purchase funnel
- **Related:** #698 (listing snapshot binding), #545 (ledger verification)
- **Implementation:** `src/lib/observability/purchaseFunnelMetrics.ts`
- **Tests:** `src/test/observability/purchaseFunnelMetrics.test.ts`, `funnel-instrumentation.test.ts`
- **Logger:** `src/lib/observability/logger.ts` (structured logging for audit trail)
- **Rate Limiter:** `src/lib/observability/rateLimiter.ts` (throttling rules)
