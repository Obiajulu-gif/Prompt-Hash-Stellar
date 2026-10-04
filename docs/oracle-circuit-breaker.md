# Oracle Anomaly Circuit Breaker & Blast Radius Scoping

## Overview
The Oracle Circuit Breaker automatically halts distribution and secondary market trading for a project when incoming oracle data points exhibit statistical anomalies (e.g. data corruption, oracle bugs, or flash crash events), preventing automated erroneous payouts before human inspection.

## Statistical Anomaly Detection Thresholds
- **Z-Score Threshold**: Triggered when incoming performance data score exceeds 3.0 standard deviations ($|Z| > 3.0$) from the trailing moving average.
- **Max Step-Change Threshold**: Triggered when single-period performance score jumps by $> 50\%$ relative to trailing baseline.

## False-Positive vs False-Negative Tradeoffs
| Metric | Setting | Tradeoff Analysis |
|---|---|---|
| Z-Score ($|Z| > 3.0$) | High Specificity | Eliminates false positives during normal market volatility while reliably detecting outlier data anomalies. |
| Blast Radius | Scoped per `projectId` | Isolates pause strictly to affected project/tranche, maintaining protocol-wide availability for unaffected assets. |
| Resumption | Multisig Only | Eliminates false-negative auto-resumes. Prevents resuming corrupted feeds after arbitrary timeouts. |

## Resumption Protocol
Resumption requires explicit multisig governance approvals (minimum 2 signatures). Automatic timeout resumption is strictly disabled.

## Testing
Run automated unit tests:
```bash
npx vitest run src/test/oracleCircuitBreaker.test.ts
```
