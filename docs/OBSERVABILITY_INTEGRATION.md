# Observability Integration Guide

**Issue:** #724  
**Date:** September 2026  
**Audience:** Backend engineers, SREs, DevOps

## Quick Start

The purchase funnel metrics are automatically collected by all endpoints in the payment flow. No additional setup is required for basic functionality.

### Accessing Metrics

```typescript
import {
  purchaseFunnelTracker,
  checkPurchaseFunnelHealth,
} from '../src/lib/observability/purchaseFunnelMetrics';

// Get current snapshot
const snapshot = purchaseFunnelTracker.getConversionSnapshot();
console.log(snapshot);

// Check health and get alerts
const { alerts, snapshot } = checkPurchaseFunnelHealth();
if (alerts.length > 0) {
  console.warn('Funnel alerts:', alerts);
}
```

### Example: Check Unlock Success Rate

```typescript
const { snapshot } = checkPurchaseFunnelHealth();
const unlockStage = snapshot.find(
  (s) => s.stageName === PurchaseFunnelStage.UNLOCK_SUCCESS
);

if (unlockStage && unlockStage.successRate < 60) {
  // Alert: critical unlock issue
  console.error(`Unlock success rate critical: ${unlockStage.successRate}%`);
}
```

## Instrumentation Points

This document maps where funnel events are recorded across the codebase.

### Challenge Issuance (`api/auth/challenge.ts`)

#### Success Path
```typescript
// Line ~220
purchaseFunnelTracker.recordStageSuccess(
  PurchaseFunnelStage.CHALLENGE_ISSUED,
  Date.now() - challengeStartMs
);
```

**When:** Challenge token successfully issued  
**Latency:** Time from handler start to token generation  
**PII:** None (address/promptId not included in tracker)

#### Failure Paths
```typescript
// Rate limit exceeded
purchaseFunnelTracker.recordStageFailure(
  PurchaseFunnelStage.CHALLENGE_ISSUED,
  PurchaseFailureReason.CHALLENGE_RATE_LIMITED
);

// Could add other failure reasons:
// - WALLET_CONNECT_FAILED (if wallet validation added)
// - CHALLENGE_EXPIRED (if challenge lookup fails)
```

### Unlock (`api/prompts/unlock.ts`)

#### Success Path
```typescript
// Line ~762
purchaseFunnelTracker.recordStageSuccess(
  PurchaseFunnelStage.UNLOCK_SUCCESS,
  Date.now() - unlockStartMs
);
```

**When:** Prompt successfully decrypted and returned  
**Latency:** End-to-end time including:
- Challenge verification
- Ledger RPC call for entitlement
- IPFS fetch (if applicable)
- Decryption

**Note:** This is the critical SLA metric; p95 latency is monitored

#### Failure Paths

**Invalid Signature:**
```typescript
// Line ~425
purchaseFunnelTracker.recordStageFailure(
  PurchaseFunnelStage.CHALLENGE_SIGNED,
  PurchaseFailureReason.SIGNATURE_INVALID
);
```

**Rate Limited:**
```typescript
// Lines ~194, ~229
purchaseFunnelTracker.recordStageFailure(
  PurchaseFunnelStage.UNLOCK_ATTEMPT,
  PurchaseFailureReason.UNLOCK_RATE_LIMITED
);
```

**Ledger Verification Failed:**
```typescript
// Line ~548
purchaseFunnelTracker.recordStageFailure(
  PurchaseFunnelStage.UNLOCK_SUCCESS,
  PurchaseFailureReason.UNLOCK_LEDGER_FAILED
);
```

**No Access (Unentitled):**
```typescript
// Line ~594
purchaseFunnelTracker.recordStageFailure(
  PurchaseFunnelStage.UNLOCK_SUCCESS,
  PurchaseFailureReason.UNLOCK_NO_ACCESS
);
```

**Integrity Failed (Hash mismatch):**
```typescript
// Line ~734
purchaseFunnelTracker.recordStageFailure(
  PurchaseFunnelStage.UNLOCK_SUCCESS,
  PurchaseFailureReason.UNLOCK_INTEGRITY_FAILED
);
```

**Challenge Expired or Unknown Error:**
```typescript
// Line ~815
const failureReason = isExpired
  ? PurchaseFailureReason.CHALLENGE_EXPIRED
  : PurchaseFailureReason.UNKNOWN_ERROR;
purchaseFunnelTracker.recordStageFailure(
  PurchaseFunnelStage.UNLOCK_SUCCESS,
  failureReason,
  Date.now() - unlockStartMs
);
```

## Adding Instrumentation to New Endpoints

When adding a new purchase flow stage (e.g., payment processor integration):

### 1. Define Failure Reasons
Update `src/lib/observability/purchaseFunnelMetrics.ts`:

```typescript
export enum PurchaseFailureReason {
  // ...existing...
  PAYMENT_TIMEOUT = 'payment_timeout',
  PAYMENT_DECLINED = 'payment_declined',
  PAYMENT_NETWORK_ERROR = 'payment_network_error',
}
```

### 2. Record Events in Endpoint
At the start of your handler, capture start time:
```typescript
const stageStartMs = Date.now();
```

On success:
```typescript
purchaseFunnelTracker.recordStageSuccess(
  PurchaseFunnelStage.PAYMENT_SUBMITTED,
  Date.now() - stageStartMs
);
```

On failure:
```typescript
purchaseFunnelTracker.recordStageFailure(
  PurchaseFunnelStage.PAYMENT_SUBMITTED,
  PurchaseFailureReason.PAYMENT_DECLINED,
  Date.now() - stageStartMs
);
```

### 3. Add Tests
Create test cases in `src/test/observability/funnel-instrumentation.test.ts`:

```typescript
it('should track payment submission failures', () => {
  purchaseFunnelTracker.recordStageFailure(
    PurchaseFunnelStage.PAYMENT_SUBMITTED,
    PurchaseFailureReason.PAYMENT_DECLINED
  );

  const snapshot = purchaseFunnelTracker.getConversionSnapshot();
  const payment = snapshot.find(
    (s) => s.stageName === PurchaseFunnelStage.PAYMENT_SUBMITTED
  );

  expect(payment?.topFailureReasons).toContainEqual(
    expect.objectContaining({
      reason: PurchaseFailureReason.PAYMENT_DECLINED,
    })
  );
});
```

### 4. Update Documentation
Add stage definition to `docs/OBSERVABILITY_DASHBOARD.md`:

```markdown
| PAYMENT_SUBMITTED | Payment processed through payment processor |
```

And add failure reasons to the reference section.

## Integration with External Observability

### Prometheus Export

Create a function to export metrics:

```typescript
// src/lib/observability/prometheusExporter.ts
import { register, Counter, Histogram } from 'prom-client';
import {
  purchaseFunnelTracker,
  PurchaseFunnelStage,
} from './purchaseFunnelMetrics';

const funnelSuccessCounter = new Counter({
  name: 'purchase_funnel_success_total',
  help: 'Purchase funnel stage successes',
  labelNames: ['stage'],
});

const funnelFailureCounter = new Counter({
  name: 'purchase_funnel_failure_total',
  help: 'Purchase funnel stage failures',
  labelNames: ['stage', 'reason'],
});

const funnelLatencyHistogram = new Histogram({
  name: 'purchase_funnel_latency_seconds',
  help: 'Purchase funnel stage latency',
  labelNames: ['stage'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

export function exportMetrics() {
  const snapshot = purchaseFunnelTracker.getConversionSnapshot();
  
  for (const stage of snapshot) {
    const metrics = purchaseFunnelTracker.getMetrics();
    const metric = metrics[stage.stageName];
    
    if (metric) {
      funnelSuccessCounter.labels(stage.stageName).inc(metric.successCount);
      
      for (const [reason, count] of Object.entries(metric.failuresByReason)) {
        funnelFailureCounter.labels(stage.stageName, reason).inc(count);
      }
    }
  }
  
  return register.metrics();
}
```

Then expose via an endpoint:

```typescript
// api/metrics.ts
import { exportMetrics } from '../src/lib/observability/prometheusExporter';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.send(exportMetrics());
}
```

### Datadog Integration

```typescript
// src/lib/observability/datadogExporter.ts
import { StatsD } from 'node-dogstatsd';
import { purchaseFunnelTracker } from './purchaseFunnelMetrics';

const statsd = new StatsD();

export async function sendToDatadog() {
  const snapshot = purchaseFunnelTracker.getConversionSnapshot();
  
  for (const stage of snapshot) {
    statsd.gauge(`purchase.funnel.conversion_rate`, stage.conversionRate, {
      stage: stage.stageName,
    });
    
    statsd.gauge(`purchase.funnel.success_rate`, stage.successRate, {
      stage: stage.stageName,
    });
    
    statsd.gauge(`purchase.funnel.latency.p95`, stage.p95LatencyMs, {
      stage: stage.stageName,
    });
  }
}

// Call periodically
setInterval(sendToDatadog, 60_000); // Every minute
```

### CloudWatch Integration

```typescript
// src/lib/observability/cloudwatchExporter.ts
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { purchaseFunnelTracker } from './purchaseFunnelMetrics';

const cloudwatch = new CloudWatchClient({});

export async function sendToCloudWatch() {
  const snapshot = purchaseFunnelTracker.getConversionSnapshot();
  
  const metricData = snapshot.flatMap((stage) => [
    {
      MetricName: 'PurchaseFunnelConversionRate',
      Value: stage.conversionRate,
      Unit: 'Percent',
      Dimensions: [{ Name: 'Stage', Value: stage.stageName }],
      Timestamp: stage.timestamp,
    },
    {
      MetricName: 'PurchaseFunnelLatencyP95',
      Value: stage.p95LatencyMs,
      Unit: 'Milliseconds',
      Dimensions: [{ Name: 'Stage', Value: stage.stageName }],
      Timestamp: stage.timestamp,
    },
  ]);

  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: 'PromptHash/Purchase',
      MetricData: metricData,
    })
  );
}
```

## Monitoring in Production

### Alert Rules (for Prometheus AlertManager)

```yaml
groups:
  - name: purchase_funnel
    rules:
      - alert: UnlockSuccessRateCritical
        expr: |
          (
            sum(rate(purchase_funnel_success_total{stage="unlock_success"}[5m]))
            /
            (
              sum(rate(purchase_funnel_success_total{stage="unlock_success"}[5m]))
              +
              sum(rate(purchase_funnel_failure_total{stage="unlock_success"}[5m]))
            )
          ) < 0.60
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Unlock success rate below 60%"
          runbook: "https://wiki.example.com/unlock-success-rate"

      - alert: UnlockLatencyCritical
        expr: |
          histogram_quantile(
            0.95,
            rate(purchase_funnel_latency_seconds_bucket{stage="unlock_success"}[5m])
          ) > 8
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Unlock p95 latency > 8 seconds"

      - alert: DetailViewConversionLow
        expr: |
          (
            sum(rate(purchase_funnel_success_total{stage="detail_view"}[1h]))
            /
            sum(rate(purchase_funnel_success_total{stage="browse"}[1h]))
          ) < 0.50
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Detail view conversion below 50%"
```

### Dashboard Setup (Grafana)

**Panel 1: Conversion Funnel**
```sql
SELECT
  timestamp,
  stage,
  conversion_rate
FROM purchase_funnel_metrics
WHERE timestamp > now() - interval '24 hours'
ORDER BY timestamp DESC
```

**Panel 2: Unlock Latency SLA**
```sql
SELECT
  DATE_TRUNC('minute', timestamp) as minute,
  p95_latency_ms,
  8000 as sla_threshold
FROM purchase_funnel_metrics
WHERE stage = 'unlock_success'
  AND timestamp > now() - interval '7 days'
ORDER BY minute DESC
```

**Panel 3: Failure Breakdown**
```sql
SELECT
  reason,
  COUNT(*) as count,
  100.0 * COUNT(*) / SUM(COUNT(*)) OVER () as pct
FROM funnel_failures
WHERE stage = 'unlock_success'
  AND timestamp > now() - interval '24 hours'
GROUP BY reason
ORDER BY count DESC
```

## Testing

Run instrumentation validation tests:

```bash
# Unit tests for metric collection
npm test -- src/test/observability/purchaseFunnelMetrics.test.ts

# Integration tests for endpoint instrumentation
npm test -- src/test/observability/funnel-instrumentation.test.ts

# End-to-end validation (manual)
1. Make a complete purchase from UI
2. Check logs for funnel events
3. Verify metrics snapshot has data for all stages
```

## Troubleshooting

### Metrics Not Appearing

1. Check imports: Ensure endpoint imports `purchaseFunnelTracker`
2. Verify calls: Search codebase for `recordStageSuccess`/`recordStageFailure`
3. Test manually:
   ```typescript
   purchaseFunnelTracker.recordStageSuccess(PurchaseFunnelStage.BROWSE, 100);
   const snapshot = purchaseFunnelTracker.getConversionSnapshot();
   console.log(snapshot); // Should include BROWSE stage
   ```

### High Latency on One Stage Only

1. Check if stage is CPU-bound (decryption, hashing)
2. Check external dependencies (RPC calls, IPFS fetches)
3. Review recent code changes affecting that stage
4. Check if threshold is miscalibrated

### Failure Rate Spike

1. Check audit logs for patterns (same IP? same prompt? same error?)
2. Cross-reference with error codes and failure reasons
3. Check external service health (blockchain, IPFS, RPC)
4. Review recent deployments

## References

- **Metrics Module:** `src/lib/observability/purchaseFunnelMetrics.ts`
- **Tests:** `src/test/observability/purchaseFunnelMetrics.test.ts`, `funnel-instrumentation.test.ts`
- **Documentation:** `docs/OBSERVABILITY_DASHBOARD.md`
- **Challenge Endpoint:** `api/auth/challenge.ts`
- **Unlock Endpoint:** `api/prompts/unlock.ts`
