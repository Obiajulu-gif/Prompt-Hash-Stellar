# Cross-environment configuration drift (#916)

Use `yarn config:drift` to compare explicit local, staging, and
production-like environment files before rollout. The command is offline and
does not read process environment variables, make network requests, or require
service credentials.

```sh
yarn config:drift --local .env --staging .env.staging --production .env.production
yarn config:drift --local .env --staging .env.staging --production .env.production --json
```

Supply one file for each environment. This is deliberate: the tool does not
guess which files contain operator values and does not fall back to templates.
Use `.env.example` only when you intend to compare the example profile, not as
a substitute for real staging or production settings. Files are parsed as
simple `KEY=value` lines with optional single/double quotes. Unknown keys are
ignored until explicitly admitted to the comparison contract.

## Comparison policy

Required settings are checked for presence in each environment:

- Stellar scaffold environment, network and passphrase;
- RPC and Horizon endpoints;
- Prompt Hash contract ID, native asset contract ID, and simulation account;
- unlock public key and challenge/unlock signing configuration.

The following differences are expected and reported as `allowed_difference`:
Stellar network/passphrase/endpoints, deployment IDs and simulation account,
gateway/storage URLs, database and cache URLs, monitoring endpoints, and
environment credentials (challenge, unlock, receipt-signing, admin, webhook,
and trusted-evidence keys). The report tells you which key differs, never its
value. These values should generally be unique per environment; allowed does
not mean they should be copied between environments.

Safety controls such as `ABUSE_RISK_MODE`, `ALLOWLIST_MODE`, log level, and
Stellar RPC quorum are compared when present. An unexpected difference is a
`mismatch` and makes the report fail. If an optional control is configured in
only some environments, it is reported as a warning-level `missing` finding.
The invariant comparison list and environment-specific exemptions are
explicitly maintained in `scripts/config-drift.mjs`; review that policy when
adding a configuration key. Do not allowlist a difference merely to silence a
report without documenting why that key is environment-specific.

## Output and exit codes

- Text and `--json` output contain key names, statuses, and environment labels
  only. No configured values, file contents, parser exceptions, or secret
  fragments are emitted.
- `missing` on a required key or `mismatch` on an invariant control exits 1.
- Unreadable inputs or invalid CLI arguments exit 2 with a generic error that
  does not include file contents.
- Allowed environment-specific differences and optional-key warnings do not
  fail the command.

The tool is a drift report, not a secret validator. It cannot prove that
credentials are valid, unique, or strong; use the existing `yarn check:setup`,
secret-rotation procedures, and deployment readiness checks for those
properties.

## Validation

```sh
yarn test src/test/configDrift.test.ts
```

Tests cover matching settings, missing required keys, mismatched safety
controls, allowed network/secret differences, and prevention of configuration
value disclosure in the report.