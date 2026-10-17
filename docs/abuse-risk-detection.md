# Risk-Scored Abuse Detection for High-Impact Operations

Code: `server/src/services/abuseRiskScoring.ts` (pure scoring, ledger, review
queue), `server/src/middleware/abuseRiskGuard.ts` (Express guard),
`server/src/routes/abuseRiskRoutes.ts` (admin review surface).
Tests: `server/src/tests/abuseRiskScoring.test.ts`,
`server/src/tests/abuseRiskGuard.test.ts`.

## What it does

Each high-impact operation (`unlock`, `purchase`, `bulk_purchase`,
`price_change`, `ownership_transfer`, `payout_request`, `api_key_create`,
`bulk_import`) is scored 0–100 from explainable signals and mapped to a
response:

| Decision  | Meaning                                              | HTTP                          |
| --------- | ---------------------------------------------------- | ----------------------------- |
| `allow`   | Proceed. The normal path; no friction.               | passes through                |
| `step_up` | Needs a freshly signed wallet session (< 5 min old). | `403 STEP_UP_REQUIRED`        |
| `review`  | Held; queued for an admin to approve or reject.      | `202 REVIEW_REQUIRED` + id    |
| `block`   | Rejected; also queued for review.                    | `403 OPERATION_BLOCKED`       |

Blocked/held responses include `reasons: [{ code, explanation }]`.

## Signals

| Code                    | Fires when                                              | Critical |
| ----------------------- | ------------------------------------------------------- | -------- |
| `velocity_burst`        | > 8 operations in 10 min                                | no       |
| `failed_attempt_streak` | ≥ 3 consecutive failures without a success             | no       |
| `new_account`           | wallet < 24 h old and amount ≥ 500                      | no       |
| `amount_spike`          | amount ≥ 5× the wallet's typical (needs ≥ 3 prior ops)  | no       |
| `ip_fanout`             | > 3 distinct IPs in the window                          | no       |
| `repeat_target`         | same target hit > 3 times in the window                 | no       |
| `dispute_history`       | ≥ 30% of ≥ 5 prior operations disputed                  | no       |
| `self_dealing`          | buyer == counterparty (purchase/bulk/transfer)          | **yes**  |
| `fresh_counterparty`    | transfer/payout to a wallet seen < 1 h ago              | **yes**  |

Every fired signal records `observed`, `threshold` and a plain-language
`explanation`, and the full assessment is written to the audit trail
(`abuse_risk_decision`, wallet hashed, no raw identifiers).

## Staying out of the way of legitimate use

- No signals ⇒ score 0 ⇒ `allow`. A brand-new wallet making a small purchase
  is never challenged.
- **Corroboration rule:** a single signal can never exceed `step_up`.
  `review` needs ≥ 2 signals; `block` needs ≥ 2 signals including a critical
  one.
- Per-operation impact weights: unlocks ×0.6 … payouts ×1.3.
- Clean, established history grants a bounded trust credit (≤ 15 points) that
  can never fully cancel a critical signal.
- Thresholds: step-up ≥ 35, review ≥ 65, block ≥ 90 (`DEFAULT_RISK_THRESHOLDS`).

## Rollout and configuration

`ABUSE_RISK_MODE` (default **`shadow`**):

- `off` – guard is a no-op; nothing recorded. **Instant rollback.**
- `shadow` – scores, logs, audits and queues reviews, but enforces nothing.
  Use this to tune thresholds against real traffic first.
- `enforce` – step-up / review / block are applied.

Currently guarded: `POST /api/bundles/:id/purchase` (`bulk_purchase`). Wire
other routes with `abuseRiskGuard({ operation, extract })` placed after rate
limiting and before the handler.

## Operating the review queue

Admin tokens need `abuse-risk:read` / `abuse-risk:write`.

- `GET  /api/admin/abuse-risk/reviews?status=pending` – highest score first.
- `POST /api/admin/abuse-risk/reviews/:id/resolve` `{ decision, note }` –
  `approved` releases **one** retry of exactly that subject+operation+target
  (status becomes `consumed`); `rejected` keeps holding it. Resolved items
  cannot be re-resolved.
- `POST /api/admin/abuse-risk/subjects/reset` `{ wallet }` – clears a
  wallet's velocity/history counters after a confirmed false positive.

## Edge cases and failure modes

- **State is per process (in memory, bounded).** A restart or a second
  instance resets velocity/history, so detection *under*-triggers (fail
  open). It cannot create false positives. Counters are capped at 200 events
  per wallet and 50 000 wallets. Move `AbuseActivityLedger` /
  `AbuseReviewQueue` to a shared store before relying on multi-instance
  enforcement; the pure scorer needs no changes.
- **Risk subsystem error:** scoring never throws into the request. On failure
  `ownership_transfer` and `payout_request` fail **closed** to `step_up`; all
  other operations fail **open**.
- **Review queue failure:** the decision is still enforced; only the queued
  item is lost (the audit record remains).
- **Shared NAT/VPN:** `ip_fanout` alone only produces `step_up`, never a
  hold.
- **Genuinely busy power users / bulk importers:** `velocity_burst` alone only
  asks for a fresh signature; trust credit lowers the score further.
- **New wallets with no history:** `amount_spike` and trust credit are
  disabled; `new_account` fires only on high amounts.
- **Approvals are one-shot:** an approval cannot be replayed for later
  activity; ask the user to retry once after approval.
- **Clock skew:** windows use server time only.
- **Step-up proof** is `Authorization: Bearer <wallet session>` whose
  `issuedAt` is < 5 min old (`hasFreshWalletSession`). If wallet sessions are
  unconfigured (`CHALLENGE_TOKEN_SECRET` missing) step-up cannot be satisfied;
  set `ABUSE_RISK_MODE=shadow` until it is configured.

## Rollback / recovery

1. Users wrongly challenged: set `ABUSE_RISK_MODE=shadow` (or `off`) and
   redeploy/restart – no data migration needed.
2. One wallet wrongly flagged: approve the pending review and/or call
   `subjects/reset`.
3. Bad threshold change: revert `DEFAULT_RISK_THRESHOLDS`; scoring is
   stateless, so previous decisions need no cleanup.
4. After an incident, reconstruct decisions from `abuse_risk_decision` audit
   entries (`GET /api/audit/export?action=abuse_risk_decision`).
