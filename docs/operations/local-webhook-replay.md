# Local inbound webhook replay (#914)

The fixture replay command reproduces the inbound webhook signature, timestamp,
and idempotency gates without MongoDB, a Stellar wallet, marketplace services,
network calls, production credentials, or the production event handlers. It
uses the same HMAC verifier and canonical input format as
`server/src/services/inboundWebhookProcessor.ts` and an isolated in-memory
store. A side-effect count in the output represents an accepted local event;
no marketplace mutation actually occurs.

## Run a fixture

From the repository root:

```sh
corepack yarn --cwd server webhook:replay success
corepack yarn --cwd server webhook:replay duplicate
corepack yarn --cwd server webhook:replay stale
corepack yarn --cwd server webhook:replay invalid-signature
corepack yarn --cwd server webhook:replay malformed
```

Fixture names are allowlisted; the command does not accept arbitrary file
paths. Each command starts with a fresh in-memory store. The `duplicate` fixture
contains two deliveries of one event in the same run and should report
`processed` followed by `duplicate`, with `sideEffectCount` remaining `1`.
Run the test suite for a repeat across invocations using one shared store.

Expected statuses:

| Fixture             | Status                        | Explanation                                                  |
| ------------------- | ----------------------------- | ------------------------------------------------------------ |
| `success`           | `processed`                   | Valid, current HMAC and JSON payload                         |
| `duplicate`         | `processed`, then `duplicate` | Second delivery is idempotently skipped                      |
| `stale`             | `stale`                       | Valid signature but timestamp exceeds the five-minute window |
| `invalid-signature` | `invalid_signature`           | Current timestamp with an invalid HMAC                       |
| `malformed`         | `malformed`                   | Valid HMAC over invalid JSON                                 |

The payloads in `server/fixtures/webhook-replay/` contain synthetic references
only. The signing key is a hard-coded test-only value in the replay harness and
is not an application credential. Never add real webhook bodies, buyer or
creator personal data, signing keys, wallet secrets, or production environment
files to fixtures. This harness is not a command for replaying production or
database events; use the protected server-side recovery workflow for those.

## Validate

```sh
corepack yarn --cwd server vitest run src/tests/localWebhookReplay.test.ts
```

The tests cover fixture loading/allowlisting, valid signature handling,
duplicate idempotency, stale timestamp rejection, bad signature rejection,
malformed JSON rejection, and exactly-once local side-effect accounting. No
database setup or migration is required.
