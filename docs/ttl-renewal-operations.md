# TTL Renewal & Dependency Operations Runbook

This runbook covers the **storage TTL (Time-To-Live) renewal system** implemented
in `contracts/prompt-hash/src/ttl_policy.rs` and `contracts/prompt-hash/src/storage.rs`.
It is meant to be driven by an **off-chain operator process** (cron job) that
periodically calls the `renew_critical_keys` contract entry point so that
persistent storage entries do not expire and get evicted by the Soroban
network.

> ⚠️ **Known gap (as of this writing):** there is **no off-chain caller of
> `renew_critical_keys` anywhere in `server/` or the rest of this repository**
> (verified by grepping the whole tree for `renew_critical_keys` /
> `get_expiry_risk_metrics` — both are only referenced from the contract
> itself). The renewal system is therefore currently **dormant**: until an
> operator job is deployed, catalog/purchase/dispute records will eventually
> fall out of storage and be evicted. A reference implementation sketch is
> included at the end of this document; deploying it is strongly recommended
> before mainnet usage at scale.

---

## 1. What "TTL" means on Soroban

On Soroban, every persistent (and instance/temporary) contract storage entry
carries a **TTL**: the ledger sequence at which the entry will be **archived
and eventually evicted** if it is not "touched" (read or explicitly extended)
before then.

- TTLs are measured in **ledgers**. At ~6 seconds per ledger:
  - `1 day  ≈ 14,400 ledgers`
  - `1 year ≈ 5,256,000 ledgers` (`ONE_YEAR = 365 * ONE_DAY`).
- When an entry's TTL reaches ~0, the Soroban network **archives** it. Archived
  entries are no longer readable; if they are never restored, they are
  **permanently evicted** and the data is lost.
- For this contract, eviction means prompts disappear from the catalog,
  purchase/access entitlements vanish (buyers could lose proof of purchase),
  and dispute/escrow state can be corrupted. **Renewal prevents this.**

The contract assigns each storage key a max TTL via `get_ttl_for_key`:

| Key family                    | Max TTL                |
| ----------------------------- | ---------------------- |
| `Prompt`, `CreatorPrompts`, most catalog indices | `ONE_YEAR`  (365 d) |
| `Purchase`, `CatalogPass`, `PurchaseEscrow`, `PurchaseDispute`, `ListingRevision`, `VoucherKey` | `ONE_YEAR + ONE_MONTH` (395 d) |
| `Dispute`                     | `ONE_MONTH` (30 d)     |

---

## 2. Renewal cadence (how often to run it)

Renewal is governed by `RENEWAL_THRESHOLD_PCT = 70`. A key is renewed only when
its **age has reached 70% of its max TTL**. After a renewal, the key's TTL is
reset to the full max, so it will not need renewal again for another
`(100% − 70%) = 30%` of its max TTL.

Derived cadence:

- For a `Prompt` (max `ONE_YEAR` ≈ 365 d): renew when age ≥ `0.70 × 365 ≈ 255` days.
  After renewal, safe for another ~255 days; **~110 days of slack** remain before
  the next forced renewal.
- For a `Dispute` (max `ONE_MONTH` ≈ 30 d): renew when age ≥ `0.70 × 30 ≈ 21` days.
  Much shorter window — disputes must be renewed far more frequently.

**Recommended schedule:** run the renewal job **at least daily** (hourly is
even safer and cheap). Daily execution guarantees that every key is renewed
long before it crosses its 70% threshold, and well within the ~110-day (or
~9-day for disputes) slack window. Weekly is the bare minimum acceptable
frequency; do not go longer.

The job is **idempotent and safe to run often**: `renew_critical_keys` only
extends keys whose TTL is actually below threshold, and re-running it is a
no-op for already-fresh keys (apart from a small read cost).

---

## 3. Calling `renew_critical_keys` (cursor-based, resumable)

Signature (from `contract.rs`):

```rust
fn renew_critical_keys(env: Env, cursor: Option<u64>) -> Result<(u32, Option<u64>), Error>;
```

- `cursor: Option<u64>` — the last processed prompt id. Pass **`null`** to start
  from the beginning. Subsequent calls pass the `cursor` returned by the
  previous call.
- Returns `(renewed_count, next_cursor)`:
  - `renewed_count` — how many keys were extended in this batch.
  - `next_cursor` — `Some(next_id)` if more keys remain to process,
    `None` when the whole key set has been swept.

Because `MAX_RENEWAL_BATCH_SIZE = 20`, a single invocation extends **at most 20
keys** to stay within Soroban resource limits. To process the full catalog you
**must loop** on the cursor until `next_cursor` is `None`.

Pseudocode (off-chain operator):

```ts
import { Contract, nativeToScVal, Keypair, TransactionBuilder, Networks, Asset, Operation, Account } from "@stellar/stellar-sdk";

async function renewAllCriticalKeys(server, operatorKeypair, contractId) {
  let cursor: string | null = null; // null === Option::None
  let totalRenewed = 0;

  for (;;) {
    // Build the `Option<u64>` cursor arg.
    const cursorArg = cursor == null
      ? nativeToScVal(null)                 // None
      : nativeToScVal(cursor, { type: "u64" });

    // `renew_critical_keys` is a state-changing op (it extends TTLs), so it
    // must be submitted and signed by an operator account that pays the fee.
    const result = await server.submitOperation(
      operatorKeypair,
      new Operation({
        type: "invokeContract",
        // contract.invoke({ method: "renew_critical_keys", args: [cursorArg] })
      }),
      // ...see your server's contract-invocation helper
    );

    const [renewedCount, nextCursor] = parseRenewalResult(result);
    totalRenewed += renewedCount;

    if (nextCursor == null) break; // Option::None => done
    cursor = nextCursor.toString();
  }

  return totalRenewed;
}
```

Operational notes:

- Each batch is a **separate transaction**. If a batch fails (e.g. transient
  RPC error), simply re-run the whole job — it is safe to resume from the last
  known `cursor` (or just restart from `null`; already-fresh keys are skipped).
- Budget the operator account with enough XLM to pay TTL-extension fees. TTL
  extension fees scale with the number of entries extended.
- Run against **mainnet** for production data; the same job pattern applies to
  testnet/preview with the corresponding contract id and network passphrase.

---

## 4. Interpreting `get_expiry_risk_metrics`

Signature:

```rust
fn get_expiry_risk_metrics(env: Env) -> Result<Vec<(String, String)>, Error>;
```

This is a **read-only (view)** entry point — it can be simulated, no fee
required. It samples three key families and reports any that are at risk of
expiry.

### Underlying severity tiers (`compute_expiry_risk`)

The contract computes, per family, how much TTL remains as a fraction of max:

| Tier        | Remaining TTL                | Meaning                                  |
| ----------- | ---------------------------- | ---------------------------------------- |
| `critical`  | ≤ 10% of max TTL remains     | Imminent eviction — act **now**.         |
| `imminent`  | ≤ 30% of max TTL remains     | Renew within days.                       |
| `at_risk`   | ≤ 50% of max TTL remains     | Schedule renewal soon.                   |

### Actual on-chain output (important caveat)

The current `get_expiry_risk_metrics` implementation collapses the
`critical` and `imminent` tiers into a **single `"at_risk"` label**: it pushes
`(family, "at_risk")` for any family that has `critical_keys > 0` **or**
`imminent_keys > 0`. It does **not** currently emit distinct `imminent` /
`critical` strings, nor does it surface the pure `at_risk` (50%) tier.

So in practice the response is a list like:

```json
[
  ["Prompt",   "at_risk"],
  ["Purchase", "at_risk"]
]
```

or an empty list `[]` when everything is healthy.

### How to act on each result

| Observed output                          | Action                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `[]` (empty)                             | Healthy. No action; next scheduled run will re-check.                 |
| any entry with status `"at_risk"`        | **Run `renew_critical_keys` immediately** (loop to completion). Even though the label is coarse, a non-empty result means some keys are already at `critical`/`imminent` and risk eviction. |

Because the label is coarse, **treat any non-empty `get_expiry_risk_metrics`
result as a page-level alert** and trigger a full `renew_critical_keys` sweep.
(Improvement idea: extend `get_expiry_risk_metrics` to emit distinct
`"critical"` / `"imminent"` / `"at_risk"` strings per family so operators can
prioritize — currently it does not.)

---

## 5. Suggested cron / monitoring setup

### Cron (daily sweep)

Example `crontab` / systemd timer / GitHub Actions scheduled workflow, **once
per day** (hourly is fine too):

```cron
# m h dom mon dow   command
17 3 * * *  node /path/to/renew-ttl.js >> /var/log/prompt-hash-ttl.log 2>&1
```

`renew-ttl.js` should:

1. Call `renew_critical_keys(null)`, then loop on the returned cursor until
   `None`, accumulating `renewed_count`.
2. Log `total renewed` and the final cursor.
3. Exit `0` on success, non-zero on persistent failure (so the scheduler alerts).

### Monitoring / alerting

1. **Pre-flight check (cheap, read-only):** periodically call
   `get_expiry_risk_metrics`. If the result is **non-empty**, page the on-call
   operator — this means keys are at/near eviction despite the renewal job.
2. **Post-run assertion:** after a sweep, call `get_expiry_risk_metrics` again.
   It should be empty. If not, alert: the sweep did not fully catch up (e.g.
   catalog grew faster than the daily job could process, or a batch failed).
3. **Freshness SLO:** alert if the renewal job has not succeeded in > 48h
   (covers the operator process being down).
4. **Dispute windows are short:** because `Dispute` TTL is only `ONE_MONTH`,
   the daily job is essential — a multi-day outage could let disputes expire.
   Consider running the job **hourly** if dispute volume is significant.

---

## 6. Failure scenarios & what happens if neglected

| Scenario                                   | Consequence                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Renewal job never deployed                 | All persistent entries eventually cross 70% age, TTL hits 0, entries are **archived then evicted** → catalog/purchase state loss. |
| Job fails silently for > ~110 days         | Same as above once the oldest keys age out.                            |
| Batch partially fails mid-sweep            | Re-running the job resumes safely; only the unprocessed tail is left stale until the next run. |
| Contract paused (`is_paused`)              | `renew_critical_keys` and `get_expiry_risk_metrics` both `require(!is_paused)` and will error. Unpause before running the job. |

**Rule of thumb:** an empty `get_expiry_risk_metrics` result + a daily successful
`renew_critical_keys` sweep = safe. Anything else = page someone.

---

## 7. Deploy-Time & Release Gate Verification (#685)

To prevent deploying or upgrading contracts when critical state entries are near expiration, the deployment and CI pipelines enforce a **deploy-time TTL readiness check**.

### Automated Deploy Gate Tool: `check-ttl-readiness.mjs`

The script `scripts/check-ttl-readiness.mjs` (runnable via `npm run check:ttl` or `yarn check:ttl`) inspects the contract's expiry risk metrics before releases and contract upgrades.

```bash
# Offline / CI self-check mode:
node scripts/check-ttl-readiness.mjs --self-check

# Live target network check:
node scripts/check-ttl-readiness.mjs --network testnet --contract-id <CONTRACT_ID>
```

#### Gate Behavior:
1. **Pass Condition**: If `get_expiry_risk_metrics` returns `[]` (empty), all critical entries are above operational thresholds. The check exits with code `0`.
2. **Block / Failure Condition**: If any critical entry family (`Prompt`, `Purchase`, `Dispute`) is within the warning/critical threshold:
   - The deployment/release process **immediately fails (exit code 1)**.
   - The tool reports the **contract ID**, **affected key families**, and **severity level**.
   - Clear remediation commands are printed to unblock the deployment.

### Runbook Remediation Command: `renew-critical-keys.mjs`

When a deploy check fails due to critical TTL risk, run the automated renewal sweep operator tool:

```bash
# Automated multi-batch cursor sweep:
node scripts/renew-critical-keys.mjs --network testnet --contract-id <CONTRACT_ID> --admin admin
# Or via npm script:
npm run renew:ttl -- --network testnet --contract-id <CONTRACT_ID>

# Manual stellar-cli invocation:
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- renew_critical_keys
```

### Pipeline Integration
- **CI Workflows (`.github/workflows/contracts.yml`)**: Runs `node scripts/check-ttl-readiness.mjs --self-check` to validate threshold calculations and policy constraints.
- **Deployment Scripts (`scripts/deploy.sh`)**: Runs post-initialization TTL readiness validation.
- **Upgrade Scripts (`scripts/upgrade.sh`)**: Enforces pre-upgrade and post-upgrade TTL readiness checks to prevent upgrading contracts with degraded state.

