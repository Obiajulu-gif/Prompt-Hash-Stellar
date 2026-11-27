# Dry-Run Policy Evaluator with Affected-Record Previews (#1030)

Governance and operational policy changes in PromptHash Stellar affect prompt pricing, platform fees, seller status, and buyer access. Applying broad policy changes without pre-flight simulation risks unexpected financial disruptions or irreversible Soroban smart contract status transitions.

The Dry-Run Policy Evaluator (`server/src/services/dryRunPolicyEvaluator.ts`) provides a side-effect-free, bounded simulation engine that computes field-level diffs, flags irreversible state transitions, estimates total financial impacts (in XLM), and binds execution plans to an HMAC confirmation token.

---

## 1. Core Workflow

1. **Policy Specification**:
   An operator submits a policy definition declaring the target resource (`prompts`, `users`, `purchases`, `maintainer_grants`), matching predicates (`field`, `operator`, `value`), action type, and required permission.
2. **Permission Check**:
   The actor must possess explicit permissions (`policy:evaluate` or `admin`). Unauthorized actors are rejected before any records are scanned. Rejection returns `authorization_denied` and no database reads are performed.
3. **Bounded Scan & Evaluation ($O(N)$ Time, $O(K)$ Space)**:
   Candidate records (up to `MAX_EVALUATION_RECORDS = 10,000`) are inspected. Predicates are evaluated in $O(1)$ time per record. Previews are capped to `MAX_PREVIEW_RECORDS = 100` to prevent memory blowup while preserving exact aggregate metrics (counts, XLM volume, and fee shift are computed over all matching records, not just the previewed subset).
4. **Impact Analysis & Finality Warnings**:
   - Diffs: Field-by-field before and after projections for each previewed record.
   - Financial Impact: Aggregate XLM volume / fee shift calculated across matching records.
   - Irreversibility: Transitions to `retired` status on Soroban are flagged as `isIrreversible: true` with `severity: "critical"`, alerting operators to smart contract finality constraints.
5. **HMAC Plan Confirmation Token**:
   The engine computes an HMAC-SHA256 signature over the policy ID, actor ID, affected record IDs (sorted), versions, and financial impact. If any record drifts before execution, the token becomes invalid.

---

## 2. Predicate Operators

| Operator | Supported Types | Description |
| :--- | :--- | :--- |
| `eq` / `ne` | string, number, boolean | Strict equality or inequality. |
| `gt` / `gte` | number | Numeric comparison (e.g. `priceXlm >= 100`). |
| `lt` / `lte` | number | Numeric comparison (e.g. `platformFeeBps < 200`). |
| `in` / `not_in` | Array | Set membership checks. |
| `contains` | string, Array | Substring containment or array element inclusion. |
| `regex` | string | Safe regex pattern evaluation. Patterns exceeding 256 characters or containing nested quantifiers are rejected with `invalid_predicate` to prevent catastrophic backtracking. |

Type mismatches (e.g. `gt` applied to a string field) are rejected at specification time with `invalid_predicate` rather than silently evaluating to false.

---

## 3. Irreversible Actions & Rollback Constraints

Certain Soroban contract actions cannot be reversed on the Stellar ledger:
- Transitioning a prompt to `PromptSaleStatus::Retired` is permanent (`ensure(prompt.status != PromptSaleStatus::Retired, Error::InvalidStatusTransition)`).
- The evaluator flags these transitions with `isIrreversible: true` and `severity: "critical"`.
- Operators must review the itemized previews before executing any plan bearing irreversible flags.
- **Rollback behavior**: Dry-run evaluation has no side effects, so there is nothing to roll back at evaluation time. Once a plan is executed, reversible transitions (fee changes, pricing changes) may be reverted by submitting a new inverse policy through the same workflow. Irreversible transitions cannot be rolled back on-chain; recovery is limited to off-chain compensation (e.g. buyer communication and refund processes handled outside the contract).

---

## 4. Operational Recovery & Failure Modes

- **Unauthorized Actor (`authorization_denied`)**:
  The actor lacks `policy:evaluate` or `admin`. No records are scanned and no token is issued. The attempt is logged for audit.
- **Oversized Batches (`selection_too_large`)**:
  Requests exceeding 10,000 records are rejected to protect server event loops. Operators should paginate or partition policy evaluations by resource ID range or creation date.
- **Invalid Predicate (`invalid_predicate`)**:
  Unknown operators, type mismatches, or unsafe regex patterns are rejected before scanning begins.
- **Record State Drift (`confirmation_mismatch`)**:
  If a listing is updated or retired by a creator between the dry-run and execution, the confirmation token fails verification, preventing stale executions. The operator must re-run the dry-run to obtain a fresh token.
- **Token Expiry (`token_expired`)**:
  Confirmation tokens carry a short TTL. Expired tokens are rejected and require a new dry-run.
- **Read Retries**:
  Record loading handles transient database faults with exponential backoff (base 100 ms, max 3 attempts) before reporting `evaluation_unavailable`. Partial results are never returned; a retry exhaustion fails the whole evaluation.

---

## 5. Verification Coverage

The evaluator test suite (`server/src/services/dryRunPolicyEvaluator.test.ts`) covers:
- **Normal path**: matching predicates produce correct diffs, aggregates, and a valid HMAC token.
- **Authorization path**: actors without `policy:evaluate` or `admin` are rejected before any repository read.
- **Failure path**: oversized selections, invalid predicates, and unsafe regex are rejected with the documented error codes.
- **Retry path**: transient repository faults are retried with backoff and succeed when recovery occurs; exhausted retries surface `evaluation_unavailable`.
- **Drift path**: modifying any affected record's version after token issuance causes `confirmation_mismatch` on execution.
- **Irreversibility path**: transitions to `retired` set `isIrreversible: true` and `severity: "critical"`.

Run with `npm test --workspace server -- dryRunPolicyEvaluator`.

### CI Note: Dependency Resolution Failure

The Playwright, Frontend, and test check runs fail during Yarn's resolution step with `YN0078: Invalid resolution typescript@npm:^5.0.0 → npm:6.0.3`. The root cause is a `resolutions` entry in the root `package.json` that forces `typescript` to `6.0.3`, which does not satisfy the `^5.0.0` range declared by workspace dependents. To fix this, either align the `resolutions` entry with a version inside the `^5.0.0` range (e.g. `5.x`) or update the dependents' ranges to accept `6.x` after verifying compatibility. Until that is resolved, the install step will fail in CI before any tests or artifacts are produced.

---

## 6. Compatibility

The evaluator is additive. It introduces no changes to existing Soroban contract interfaces or REST endpoints for policy execution. Existing policy execution paths continue to function without requiring a dry-run; operators are encouraged but not forced to simulate. A future migration may make dry-run mandatory for policies touching `retired` transitions, which would require a feature flag rollout and an updated runbook entry before enforcement.
