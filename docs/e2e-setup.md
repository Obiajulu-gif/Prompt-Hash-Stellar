# E2E setup — buyer path (wallet signing, settlement, entitlement, unlock)

The buyer-path suite lives in `tests/e2e/buyer-journey.spec.js` (plus `tests/marketplace.spec.js` for legacy smoke) and is run via `yarn test:e2e` (`playwright test`).

## Determinism and isolation

- No real Stellar extension is required. The suite injects a mock wallet via `page.addInitScript` and `fixtures/walletFixtures.js`.
- All external network dependencies (Soroban RPC, Horizon, `/api/auth/challenge`, `/api/prompts/unlock`) are intercepted with `page.route` and fulfilled with deterministic fixtures.
- Tests are fully parallel and isolated — each test gets a fresh browser context, no shared localStorage or chain state.

## Required environment variables

For mocked runs (default, local + CI) **no env vars are required**. The suite never hits real infrastructure.

For a live-network run (optional, not required for CI gate), set:

```
PUBLIC_STELLAR_NETWORK=TESTNET
PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
PUBLIC_PROMPT_HASH_CONTRACT_ID=C...
PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID=C...
E2E_LIVE=1
# Optional: fund test wallets via Friendbot before running
```

Live runs are not part of the required CI gate; mocked runs are the deterministic baseline.

## Running locally

```bash
yarn install
yarn test:e2e            # runs all specs under tests/
yarn test:e2e --grep "happy path"
```

The first run will install browsers if needed: `npx playwright install --with-deps chromium`.

## CI

`yarn test:e2e` is invoked in `.github/workflows/*.yml` on every push. The config sets `retries: 2` in CI and captures `trace`, `screenshot`, and `video` on failure for actionable triage.

## Test fixtures

- `tests/fixtures/walletFixtures.js` — `TEST_WALLETS`, `WALLET_FIXTURES` (connectedBuyer, userRejectsSigning, networkFailure, invalidSignature, expiredChallenge), `SETTLEMENT_FIXTURES`, `ENTITLEMENT_FIXTURES`, `UNLOCK_FIXTURES`.
- `tests/helpers/mockServer.js` — `mockSuccessfulSettlement`, `mockUnlockSuccess`, `mockUnlockFailure`, `mockHasAccess`, `attachActionableLogging`.

Use fixtures like:

```js
await injectMockWallet(page, WALLET_FIXTURES.connectedBuyer);
await mockUnlockSuccess(page, 'plaintext');
```

## Coverage

| Scenario | Fixture / expectation |
|----------|-----------------------|
| Happy path (sign → settle → entitlement → unlock) | `mockUnlockSuccess`, plaintext visible |
| User rejects signing | `userRejectsSigning`, error `declined` shows retry |
| Settlement failure (insufficient balance) | `failedInsufficientBalance`, code `INSUFFICIENT_BALANCE` |
| Entitlement missing (not purchased) | `noAccess`, code `ACCESS_NOT_PURCHASED` |
| Expired challenge | `expiredChallenge`, code `CHALLENGE_EXPIRED` |
| Invalid signature | `invalidSignature`, code `INVALID_SIGNATURE` |
| Transient network → retry succeeds | first 503 `TEMPORARY_FAILURE`, second 200 plaintext |
| Pending indexing | `pendingIndexing`, 202 not swallowed |

Each failure asserts stable `code` values that the UI maps to recovery states (see `src/lib/api/errorCodes.ts` and `EntitlementStatusPanel`).

## Actionable logs / screenshots

`playwright.config.ts` is configured with `trace: on-first-retry`, `screenshot: only-on-failure`, `video: retain-on-failure`, and reporters `html` + `github` (in CI). The helper `attachActionableLogging` also logs `console.error`, `pageerror`, and `requestfailed` to the test output so a failed run points directly to the failing request or signature step.

Artifacts are under `playwright-report/` and `test-results/` after a failed run.

## Keeping tests deterministic

- Do not introduce real time waits; use `expect(...).toBeVisible()` with `page.route` mocks.
- Use `asOf` dates explicitly in any time-sensitive helper.
- Do not call live `fetch` without a route mock; all `/api/*` and `*.stellar.org` traffic in tests must be mocked so `E2E_LIVE` remains the only opt-in for live runs.
