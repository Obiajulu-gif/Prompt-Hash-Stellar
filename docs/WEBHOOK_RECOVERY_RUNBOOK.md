# Webhook Backlog, Poison Message & Dead-Letter Recovery Runbook

> **Issue**: #1099  
> **Purpose**: Standard Operating Procedures (SOP) and executable recovery drills proving that webhook processing can safely recover after downstream outages, duplicate deliveries, and poison messages.

---

## 1. Overview & Architectural Guarantees

The PromptHash Webhook Outbox system decouples event creation from HTTP dispatch to third-party endpoints. It provides transactional outbox durability, monotonic per-subscriber ordering, cryptographic signing (HMAC-SHA256), and safe fault recovery.

```
+-------------------+      +-------------------------+      +-------------------------+
| Transactional API | ---> | WebhookOutboxEvent (DB) | ---> |  Webhook Outbox Worker  |
+-------------------+      +-------------------------+      +-------------------------+
                                                                         |
                                                   +---------------------+---------------------+
                                                   |                                           |
                                            (HTTP 200 OK)                              (HTTP 5xx / 4xx)
                                                   |                                           |
                                                   v                                           v
                                        +---------------------+                     +---------------------+
                                        |  status: delivered  |                     | Exponential Backoff |
                                        +---------------------+                     +---------------------+
                                                                                               |
                                                                                    (attempts >= 8 or Poison)
                                                                                               |
                                                                                               v
                                                                                    +---------------------+
                                                                                    | status: dead_letter |
                                                                                    +---------------------+
```

### Core Guarantees

| Invariant | Implementation Mechanism | Recovery Guarantee |
|---|---|---|
| **Monotonic Ordering** | `WebhookSubscription.nextDeliverySequence` atomic counter incremented at enqueue. Worker leases sorted by `{ subscriptionId: 1, sequence: 1 }`. | Subscribers receive events strictly in order. Head-of-line blocking on poison messages is resolved via quarantine. |
| **Deduplication** | Unique sparse compound index on `{ dedupeKey: 1, subscriptionId: 1 }`. | Duplicate enqueues (network retries, race conditions) are silently ignored with O(1) deduplication. |
| **Retry Budget** | Max 8 attempts with exponential backoff and randomized jitter (`min(3600s, 2s * 2^attempts + jitter)`). | Prevents hammering recovering downstream services; automatically escalates to dead-letter queue after budget exhaustion. |
| **Poison Isolation** | Explicit quarantine via `quarantineWebhookEvent(outboxId, reason)` and automatic dead-lettering for non-retryable 4xx codes (except 429). | Malformed payloads or invalid subscriber targets are quarantined instantly without blocking valid pending events. |
| **Operator Pause** | Atomic boolean worker flag in `webhookOutboxWorker.ts`. When paused, `claimRow()` immediately returns `null` without database leases. | Halts all outbound HTTP traffic during downstream incidents or maintenance windows. |

---

## 2. Standard Operating Procedures (SOP)

### Procedure 1: Pause Outbox Dispatch
Use when downstream endpoints are experiencing catastrophic degradation, network partitions, or undergoing planned maintenance.

1. **Invoke Worker Pause**:
   ```typescript
   import { pauseWebhookWorker } from "./services/webhookOutboxWorker.js";
   pauseWebhookWorker();
   ```
2. **Verify State**:
   ```typescript
   import { isWebhookWorkerPaused } from "./services/webhookOutboxWorker.js";
   console.log("Worker paused:", isWebhookWorkerPaused()); // true
   ```
3. **Behavior while paused**:
   - Outbox rows continue to accumulate safely in `WebhookOutboxEvent` with `status: "pending"`.
   - `claimRow()` yields `null` without acquiring leases or issuing network requests.

### Procedure 2: Quarantine a Poison Message
Use when an unparseable, malformed, or hostile event repeatedly fails or crashes subscriber receivers.

1. **Identify the Poison Event**:
   Inspect recent failure logs or dead-letter queue for recurring parse/syntax errors.
2. **Execute Quarantine**:
   ```typescript
   import { quarantineWebhookEvent } from "./services/webhookOutbox.js";

   const success = await quarantineWebhookEvent(
     "6614a9c8b7f8e30012c8a123",
     "Downstream subscriber reported unparseable JSON payload at path $.data.promptId"
   );
   ```
3. **Verify Quarantine**:
   - Outbox record is moved to `status: "dead_letter"`.
   - `lastError` is set to `"Quarantined: Downstream subscriber reported unparseable JSON payload at path $.data.promptId"`.
   - Lease locks are released immediately, allowing subsequent messages for that subscriber to proceed.

### Procedure 3: Resume Outbox Dispatch
Use after downstream services report full recovery and capacity.

1. **Invoke Worker Resume**:
   ```typescript
   import { resumeWebhookWorker } from "./services/webhookOutboxWorker.js";
   resumeWebhookWorker();
   ```
2. **Monitor Monotonic Drainage**:
   - The worker resumes leasing rows in ascending order of `{ subscriptionId, sequence }`.
   - Monitor `pendingCount` decreasing smoothly.

### Procedure 4: Inspect & Replay Dead-Letter Queue
Use once root cause is mitigated or a bug in downstream receivers is patched.

1. **Query Dead-Letter Events**:
   ```typescript
   import { listDeadLetters } from "./services/webhookOutbox.js";

   const deadLetters = await listDeadLetters({ limit: 50 });
   console.table(deadLetters.map(d => ({ id: d._id, sub: d.subscriptionId, error: d.lastError })));
   ```
2. **Replay Individual Dead-Letter Event**:
   ```typescript
   import { replayDeadLetter } from "./services/webhookOutbox.js";

   await replayDeadLetter("6614a9c8b7f8e30012c8a123");
   ```
3. **Batch Replay All Dead-Letter Events (or Scoped to a Subscription)**:
   ```typescript
   import { replayAllDeadLetters } from "./services/webhookOutbox.js";

   // Replay all dead letters across all subscriptions
   const totalReplayed = await replayAllDeadLetters();

   // Or replay only for a specific subscriber whose endpoint was fixed
   const subscriberReplayed = await replayAllDeadLetters({ subscriptionId: "sub-12345" });
   ```

---

## 3. Operator Metrics & Telemetry

Query operational metrics at any time using `getWebhookOperationalMetrics()`:

```typescript
import { getWebhookOperationalMetrics } from "./services/webhookOutbox.js";

const metrics = await getWebhookOperationalMetrics();
console.log(metrics);
// {
//   pendingCount: 42,
//   deadLetterCount: 3,
//   deliveredCount: 1540,
//   totalOutboxCount: 1585
// }
```

### SLA / Health Thresholds

| Metric | Warning Threshold | Critical Threshold | Action Required |
|---|---|---|---|
| `pendingCount` | > 1,000 | > 5,000 | Inspect worker lease throughput and downstream latency. |
| `deadLetterCount` | > 10 / hour | > 50 / hour | Investigate downstream receiver health or potential poison payloads. |
| Worker Lease Lock Duration | > 15s | > 30s | Potential HTTP timeout hang; check SSRF guard timeout settings. |
| Dispatch Latency (Enqueue -> Delivery) | > 60s | > 300s | Scale worker concurrency or pause low-priority subscribers. |

---

## 4. Rollback Procedures & Safeguards

If dead-letter replay initiates a downstream cascade failure or overwhelming error rate:

1. **Immediate Pause**:
   ```typescript
   pauseWebhookWorker();
   ```
2. **Quarantine Replayed Batch**:
   If the entire batch is still failing downstream, quarantine them to halt immediate retries:
   ```typescript
   const deadLetters = await listDeadLetters({ limit: 100 });
   for (const dl of deadLetters) {
     await quarantineWebhookEvent(dl._id.toString(), "Rollback: Downstream still unable to process");
   }
   ```
3. **Deactivate Problematic Subscription**:
   If a single subscriber endpoint is misbehaving, update the subscription status to `"inactive"`:
   ```typescript
   await WebhookSubscription.findByIdAndUpdate(subscriptionId, { status: "inactive" });
   ```
4. **Resume Healthy Subscriptions**:
   ```typescript
   resumeWebhookWorker();
   ```

---

## 5. Executable Recovery Drill

The repository includes an automated recovery drill runner that tests all 5 recovery scenarios:

1. **Downstream Outage Backlog Accumulation & Monotonic Resume** (`SCENARIO_1_OUTAGE_BACKLOG_AND_RESUME`)
2. **Duplicate Delivery Rejection & Idempotency** (`SCENARIO_2_DUPLICATE_DELIVERY_DEDUPLICATION`)
3. **Poison Message Quarantine & Head-of-Line Isolation** (`SCENARIO_3_POISON_MESSAGE_QUARANTINE`)
4. **Dead-Letter Queue Visibility & Controlled Replay** (`SCENARIO_4_DEAD_LETTER_VISIBILITY_AND_REPLAY`)
5. **Retry Budget Ceiling & Terminal Dead-Letter Escalation** (`SCENARIO_5_RETRY_LIMITS_AND_BACKOFF`)

### Running the Drill

```bash
# Run via test suite in server directory
npm --prefix server test -- src/tests/webhookRecoveryDrill.test.ts
```

### Running Programmatically

```typescript
import { WebhookRecoveryDrillRunner } from "./services/webhookRecoveryDrill.js";

const report = await WebhookRecoveryDrillRunner.runFullDrill();
console.log(`Drill Status: ${report.passed ? "PASSED" : "FAILED"}`);
console.log(`Scenarios: ${report.passedCount}/${report.totalScenarios}`);
```
