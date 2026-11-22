# Critical Journey Synthetic Monitor

The monitor exercises the deployed HTTP journey in order: public prompt lookup, wallet challenge issuance, and unlock. It is non-mutating: provision a dedicated prompt and buyer entitlement once; the monitor never purchases, publishes, or changes data.

Run a safe authorization probe (the default):

```sh
SYNTHETIC_BASE_URL=https://preview.example \
SYNTHETIC_PROMPT_ID=42 \
SYNTHETIC_BUYER_ADDRESS=G... \
npm --prefix server run monitor:synthetic
```

For the full authorized path, additionally set `SYNTHETIC_MODE=authorized` and `SYNTHETIC_BUYER_SECRET` in the secret manager. Never use a funded production user wallet. Output contains only status, stable error code, attempt count, and latency; challenge tokens, signatures, plaintext, and wallet secrets are never emitted.

## Failure, retry, and alerting

HTTP 408, 425, 429, and 5xx responses retry up to three attempts with exponential backoff. Validation and authorization failures do not retry. The journey stops at the first failed step, exits non-zero, and identifies that step. Alert after two consecutive failed runs to avoid paging on a single transient response; use step status/code to route browse failures to the marketplace/API owner and challenge/unlock failures to the auth/unlock owner.

`authorization-probe` succeeds only when an intentionally invalid signature receives `401 INVALID_SIGNATURE`; a 2xx is a critical authorization-boundary failure. `authorized` succeeds only on a 2xx unlock response from the pre-entitled fixture.

## Recovery and rollback

- Missing prompt: restore/re-provision the immutable synthetic fixture or update `SYNTHETIC_PROMPT_ID` after verifying its entitlement.
- 429: do not increase production limits first; reduce monitor frequency and confirm no duplicate schedulers are running.
- Secret rotation: update `SYNTHETIC_BUYER_SECRET` and its derived address atomically, then run once manually.
- To disable the monitor during an incident, stop only its scheduler/cron entry. No application rollback is required and application traffic is unaffected.
- If a deploy changes a route contract, keep the old monitor running until the new path passes once, then update the service and tests together. The API itself is not modified by this monitor.

Unlock retries reuse the journey's idempotency key. Each new journey gets a separate key, including concurrent journeys that start in the same millisecond.
