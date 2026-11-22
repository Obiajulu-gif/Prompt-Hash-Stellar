# Critical Journey Synthetic Monitor (#1039, #1154)

The monitor exercises the deployed HTTP journey in order: public prompt lookup,
wallet challenge issuance, and unlock. It is non-mutating: provision a dedicated
prompt and buyer entitlement once; the monitor never purchases, publishes, or
changes data.

Code: `server/src/services/syntheticJourneyMonitor.ts`.
CLI: `server/scripts/runSyntheticJourney.ts` (`monitor:synthetic`).

## Modes

| Mode                            | What it proves                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `authorization-probe` (default) | Browse and challenge work, and an intentionally invalid signature is rejected with `401 INVALID_SIGNATURE`. Needs no wallet secret. |
| `authorized`                    | The full path succeeds for a pre-entitled fixture wallet: browse, challenge, signature, unlock.                                     |

Run a safe authorization probe (the default):

```sh
SYNTHETIC_BASE_URL=https://preview.example \
SYNTHETIC_PROMPT_ID=42 \
SYNTHETIC_BUYER_ADDRESS=G... \
npm --prefix server run monitor:synthetic
```

For the full authorized path, additionally set `SYNTHETIC_MODE=authorized` and
`SYNTHETIC_BUYER_SECRET` in the secret manager. Never use a funded production
user wallet. Output contains only status, stable error code, attempt count, and
latency; challenge tokens, signatures, plaintext, and wallet secrets are never
emitted.

## Continuous watch mode

External cron remains supported, but the monitor can also run in-process. The
scheduler runs immediately, never stacks overlapping journeys, and emits one
structured alert per incident:

```sh
SYNTHETIC_WATCH=1 \
SYNTHETIC_INTERVAL_MS=60000 \
SYNTHETIC_FAILURE_THRESHOLD=2 \
npm --prefix server run monitor:synthetic
```

`SIGINT`/`SIGTERM` stops the scheduler after the in-flight run. Logs are JSON
lines: `synthetic_journey` (one per run, including the failed step), plus
`synthetic_journey_skipped` when a slow run is still in flight.

## Failure, retry, and alerting

HTTP 408, 425, 429, and 5xx responses, network errors, timeouts, and malformed
responses with a retryable status retry up to three attempts with exponential
backoff. Validation, authorization, non-JSON `2xx` bodies, and local signing
failures do not retry. The journey stops at the first failed step, exits
non-zero, and identifies that step.

`startSyntheticMonitoring` tracks consecutive failed runs:

- An alert is emitted **once** when the streak reaches
  `SYNTHETIC_FAILURE_THRESHOLD` (default 2), so one transient response never
  pages.
- A `synthetic_journey_recovered` event is emitted **once** on the first success
  after an incident.
- Alert events carry only correlation ID, mode, failed step, HTTP status, and
  stable error code. Route browse failures to the marketplace/API owner and
  challenge/unlock failures to the auth/unlock owner.

`authorization-probe` succeeds only when an intentionally invalid signature
receives `401 INVALID_SIGNATURE`; a 2xx is a critical authorization-boundary
failure. `authorized` succeeds only on a 2xx unlock response from the
pre-entitled fixture.

## Edge cases

| Situation                                 | Behaviour                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Missing/retired fixture prompt            | Browse returns an empty list → `synthetic_prompt_missing`, no retry. Re-provision the fixture or update `SYNTHETIC_PROMPT_ID`. |
| Non-JSON `2xx` (proxy/maintenance page)   | Treated as a malformed body (`synthetic_prompt_missing`/`challenge_failed`), no retry.                                         |
| Request exceeds `timeoutMs` (default 8 s) | Aborted as `request_timeout`, retried within the attempt bound.                                                                |
| 429 rate limit                            | Retried with backoff. Do not raise production limits first; reduce monitor frequency and confirm no duplicate schedulers.      |
| Slow dependency                           | Overlapping interval ticks are skipped; the next tick runs after the current journey finishes.                                 |
| Signing failure                           | `challenge_signing_failed`, one attempt — retrying cannot fix a local wallet/secret problem.                                   |
| Secret rotation                           | Update `SYNTHETIC_BUYER_SECRET` and its derived address atomically, then run once manually.                                    |
| Clock/expiry                              | Challenge TTL is server-issued; a long pause between steps surfaces as an unlock 4xx and is not retried.                       |
| Leakage                                   | Result objects and alert events never include tokens, challenge strings, signatures, plaintext, or response bodies.            |

## Recovery and rollback

- Missing prompt: restore/re-provision the immutable synthetic fixture or update
  `SYNTHETIC_PROMPT_ID` after verifying its entitlement.
- To disable the monitor during an incident, stop only its cron entry or send
  `SIGTERM` to watch mode. No application rollback is required and application
  traffic is unaffected.
- If a deploy changes a route contract, keep the old monitor running until the
  new path passes once, then update the service and tests together. The API
  itself is not modified by this monitor.
- Alert delivery can be replaced with `onAlert` (for example, forwarding to an
  existing incident pipeline) without changing the journey contract.

Unlock retries reuse the journey's idempotency key. Each new journey gets a
separate key, including concurrent journeys that start in the same millisecond.

## Verification

```sh
npm --prefix server run monitor:synthetic:test
```

The suite covers the normal path, authorization probe, expected 403/401
failures, retry/backoff, bounded attempts, timeouts, non-JSON responses, signer
failure, alert/recovery semantics, overlap skipping, and secret redaction.
