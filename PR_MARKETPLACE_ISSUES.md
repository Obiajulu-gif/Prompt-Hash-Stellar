# Pull Request: Marketplace Protection, Payout Ledger, Entitlement Caching, & Prompt Bundles

## Overview

This pull request implements four high-impact marketplace capabilities for the Prompt-Hash-Stellar platform:

1. 🛡️ **Core Marketplace Rate Limiting & Admin Observability** (Abuse-Aware Throttling)
2. 💰 **Payout Ledger & Stellar Settlement Reconciliation** (Append-Only Ledger & Drift Detection)
3. 🔐 **Entitlement Caching & Revocation Rules** (Fast Unlocks & Idempotent Repair)
4. 📦 **Prompt Bundles & Atomic Purchase Recovery** (Snapshotting & Retry Recovery)

---

## Task 1: Core Marketplace Actions Rate Limiting

### Implementation Details
- **Per-Action Limiters** (`server/src/middleware/rateLimiter.ts`):
  - `publishLimiter`: 5 requests per 15 minutes per IP/wallet.
  - `purchaseLimiter`: 10 requests per 1 minute per IP/wallet.
  - `reviewLimiter`: 5 requests per 1 minute per IP/wallet.
  - `reportLimiter`: 5 requests per 1 minute per IP/wallet.
- **Consistent Rate Limit Errors**: Returns HTTP 429 with `Retry-After` header, reset timestamp, limit, action name, and human-readable timing explanation.
- **Admin Observability**:
  - `recordBlockedEvent()` logs all 429 breaches with client IP, wallet address, action, path, and retry delay.
  - Admin endpoint `GET /api/admin/rate-limits/blocked` (protected by `requireAdminScope("ratelimit:read")`) exposes blocked events and summary metrics.
  - Admin endpoint `POST /api/admin/rate-limits/reset` (protected by `requireAdminScope("ratelimit:write")`) enables clearing rate limit counters for testing/remediation.
- **Webhook Protection**: Webhook endpoints (`/api/webhooks` with valid `x-webhook-signature` or secret) bypass user rate limiters to prevent blocking legitimate retry workflows.

### Configuration Defaults
```typescript
publishLimiter: windowMs = 15m, maxRequests = 5
purchaseLimiter: windowMs = 1m,  maxRequests = 10
reviewLimiter:  windowMs = 1m,  maxRequests = 5
reportLimiter:  windowMs = 1m,  maxRequests = 5
```

---

## Task 2: Payout Ledger & Stellar Settlement Reconciliation

### Implementation Details
- **Append-Only Ledger Model** (`server/src/models/LedgerEntry.ts`):
  - Immutable Mongoose schema for entry types: `sale`, `fee`, `refund`, `adjustment`, `payout`.
  - Mongoose hooks explicitly reject `updateOne`, `findOneAndUpdate`, `updateMany` to guarantee append-only ledger integrity.
- **Balance Recalculation & Reconciliation** (`server/src/services/payoutLedgerService.ts`):
  - `recalculateCreatorBalance`: Aggregates gross sales, 5% platform fees, refunds, adjustments, and settled payouts to recalculate net balance.
  - `reconcileCreatorLedger`: Compares calculated net balance against Stellar transaction references. Detects **reconciliation drift** and outputs actionable remediation notes for administrators.
  - `exportLedgerReport`: Provides export-ready data shapes in both JSON and downloadable CSV formats.
- **API Endpoints** (`server/src/routes/payoutLedgerRoutes.ts`):
  - `GET /api/payouts/creator/:walletAddress/ledger`: Creator summary view with entry history.
  - `GET /api/payouts/admin/summary`: Admin overview across creators with drift/mismatch warnings.
  - `GET /api/payouts/admin/export`: Export-ready accounting dataset (JSON/CSV).
  - `POST /api/payouts/entry`: Administrative append-only entry creation.
- **UI Component** (`src/components/payouts/PayoutLedgerSummary.tsx`):
  - Real-time creator breakdown and admin drift warning alerts.

---

## Task 3: Entitlement Caching & Revocation Rules

### Implementation Details
- **Entitlement Model & Cache** (`server/src/models/Entitlement.ts`, `server/src/services/entitlementService.ts`):
  - Stores prompt access entitlement states: `active`, `refunded`, `revoked`, `expired`.
  - `getEntitlementState`: Fast cache lookup (cache hit) with fallback to authoritative Purchase record (cache miss).
- **Revocation Rules**:
  - `revokeEntitlement`: Immediately revokes access upon refund or moderator action, setting `status`, `revokedAt`, and `revocationReason`.
  - Prevents leaking prompt payloads through stale client states.
- **Idempotent Consistency Repair Job**:
  - `repairEntitlementState`: Compares purchases vs. entitlement states. Grants missing entitlements for valid purchases and revokes entitlements for refunded/revoked purchases.
  - Fully idempotent execution.
- **API Endpoints** (`server/src/routes/entitlementRoutes.ts`):
  - `GET /api/entitlements/check`: Fast unlock entitlement check.
  - `POST /api/entitlements/revoke`: Moderator revocation action.
  - `POST /api/entitlements/repair`: Admin repair execution.

---

## Task 4: Prompt Bundles & Atomic Purchase Recovery

### Implementation Details
- **Bundle & BundlePurchase Models** (`server/src/models/Bundle.ts`, `server/src/models/BundlePurchase.ts`):
  - Models curated prompt bundles containing multiple prompt listings.
  - Captures an immutable snapshot (`promptId`, `title`, `price`, `contentHash`) of included prompts at bundle creation/purchase time.
  - Prevents hidden, deleted, or inactive prompts from being newly bundled.
- **Atomic Purchase & Failure Recovery** (`server/src/services/bundleService.ts`):
  - `purchaseBundle`: Atomically creates entitlements for all prompts in the bundle snapshot.
  - If partial unlock or entitlement failure occurs, sets `recoveryStatus = "partial_failure"` and tracks failed item states.
  - `recoverPartialBundleUnlock`: Idempotent recovery mechanism that retries failed prompt unlocks without double-charging the buyer.
- **API Endpoints** (`server/src/routes/bundleRoutes.ts`):
  - `POST /api/bundles`: Create bundle with snapshotting.
  - `GET /api/bundles` / `GET /api/bundles/:id`: Browse/view bundles.
  - `POST /api/bundles/:id/purchase`: Atomic purchase flow.
  - `POST /api/bundles/purchases/:purchaseId/recover`: Deterministic recovery flow.

---

## Verification & Testing

All features are covered by unit and integration tests in `server/src/tests/`:

1. `server/src/tests/rateLimiter.test.ts` (4/4 passed)
   - Burst attempts return HTTP 429 with retry timing.
   - Admin observability records blocked events.
   - Webhooks bypass rate limits.
   - Core action limiters verified.
2. `server/src/tests/payoutLedger.test.ts` (5/5 passed)
   - Append-only ledger creation and immutability.
   - Net balance recalculation across sale, fee, refund, adjustment, payout.
   - Stellar reconciliation drift detection & remediation notes.
   - Export-ready data shape.
3. `server/src/tests/entitlementCaching.test.ts` (3/3 passed)
   - Cache hit & cache miss entitlement checks.
   - Immediate revocation on refund/moderation.
   - Idempotent repair job execution.
4. `server/src/tests/bundleService.test.ts` (4/4 passed)
   - Bundle creation and snapshotting.
   - Inactive/hidden prompt bundle rejection.
   - Atomic purchase entitlement generation.
   - Partial unlock failure tracking and recovery without double charging.

Total Test Result: **16/16 Passed**

---

## Validation Steps for Reviewers

1. **Test Rate Limiting & Admin Observability**:
   ```bash
   npx vitest run src/tests/rateLimiter.test.ts
   ```
2. **Test Payout Ledger & Stellar Reconciliation**:
   ```bash
   npx vitest run src/tests/payoutLedger.test.ts
   ```
3. **Test Entitlement Caching & Revocation**:
   ```bash
   npx vitest run src/tests/entitlementCaching.test.ts
   ```
4. **Test Prompt Bundles & Recovery**:
   ```bash
   npx vitest run src/tests/bundleService.test.ts
   ```
5. **Run All Marketplace Task Tests**:
   ```bash
   npx vitest run src/tests/rateLimiter.test.ts src/tests/payoutLedger.test.ts src/tests/entitlementCaching.test.ts src/tests/bundleService.test.ts
   ```
6. **Type Check Project**:
   ```bash
   npx tsc --noEmit
   ```
