# Dependency & License Compliance Policy

> **Issue**: #1097  
> **Goal**: Make dependency changes reviewable, prevent unapproved or incompatible licenses from entering the project, and enforce lockfile integrity without running package lifecycle scripts.

---

## 1. Objectives & Guarantees

PromptHash Stellar is open-source creator infrastructure built on the Stellar blockchain. To protect users, contributors, and operators:
1. **Permissive Licensing**: Core codebase and dependencies must remain compatible with permissive open-source distribution (**Apache-2.0** and **MIT**).
2. **Copyleft Protection**: Prohibits unreviewed strong copyleft licenses (AGPL, GPL, SSPL, etc.) that could impose virality on smart contracts, client applications, or serverless infrastructure.
3. **Deterministic CI Enforcement**: Dependency changes must be machine-readable, reproducible, and verifiable in CI without running package lifecycle scripts (`--ignore-scripts`).
4. **Lockfile Synchronization**: Requires all additions, updates, or removals of dependencies in `package.json` to be accompanied by a synchronized `package-lock.json` or `Cargo.lock`.

---

## 2. Permitted Licenses

The following licenses are approved for use across direct and transitive dependencies:

| License Identifier | Description | Usage Scope |
|---|---|---|
| **MIT** / **MIT-0** | Permissive, attribution-only or zero-attribution | Client, server, contracts, tooling |
| **Apache-2.0** | Permissive with explicit patent grant | Client, server, contracts, tooling |
| **BSD-2-Clause** / **BSD-3-Clause** | Permissive Berkeley Software Distribution | Client, server, contracts, tooling |
| **ISC** | Functional equivalent to MIT / BSD 2-Clause | Client, server, tooling |
| **0BSD** / **CC0-1.0** / **Unlicense** | Public domain dedications | Client, server, tooling |
| **BlueOak-1.0.0** / **Python-2.0** / **Zlib** | High-permissiveness modern licenses | Tooling, libraries |
| **MPL-2.0** | File-level weak copyleft (Mozilla Public License 2.0) | Build tools, bundlers (`lightningcss`, `edge-runtime`) |
| **FSL-1.1-MIT** | Functional Source License converting to MIT | Developer telemetry tooling (`@sentry/cli`) |
| **CC-BY-4.0** | Open data attribution license | Browser support data (`caniuse-lite`) |

---

## 3. Disallowed Licenses

Unless explicitly granted a formal security exception, the following license families are **strictly prohibited**:

* **Strong Copyleft**: `AGPL-1.0`, `AGPL-3.0`, `GPL-1.0`, `GPL-2.0`, `GPL-3.0`.
* **Weak Copyleft in Runtime**: `LGPL-2.0`, `LGPL-2.1`, `LGPL-3.0` (unless strictly isolated via IPC/browser extension boundary as documented in exceptions).
* **Commercial Restrictions**: `Commons Clause`, `Server Side Public License (SSPL)`, `Non-Commercial (CC-BY-NC)`.
* **Unidentified**: Any dependency with missing (`UNKNOWN`) or unparseable license fields.

---

## 4. Approved Exceptions Catalog

All exceptions are recorded in `scripts/validate-dependencies-and-licenses.mjs` and reviewed quarterly.

| Package Prefix / Name | Declared License | Effective License | Scope & Rationale | Approved By | Ticket |
|---|---|---|---|---|---|
| `@walletconnect/*` | `SEE LICENSE IN LICENSE.md` | `Apache-2.0` | Official WalletConnect client libraries, open-source under Apache-2.0. | Security Review | #1097 |
| `@reown/*` | `SEE LICENSE IN LICENSE.md` | `Apache-2.0` | Reown AppKit web3modal integration (WalletConnect rebrand), Apache-2.0. | Security Review | #1097 |
| `@trezor/*` | `SEE LICENSE IN LICENSE.md` | `Apache-2.0` | Trezor Suite hardware wallet bridge, open-source under Apache-2.0. | Security Review | #1097 |
| `@lobstrco/signer-extension-api` | `GPL-3.0` | `GPL-3.0` | Browser extension bridge for Lobstr Stellar wallet, called across external browser IPC boundary. | Architecture Review | #1097 |
| `rpc-websockets` | `LGPL-3.0-only` | `LGPL-3.0-only` | WebSocket transport library bundled by `@creit.tech/stellar-wallets-kit`. | Architecture Review | #1097 |
| `ua-parser-js` | `AGPL-3.0-or-later` | `MIT/Commercial` | Transitive browser agent parser used by Sentry error telemetry. | Architecture Review | #1097 |
| `console-browserify`, `eyes`, `querystring-es3` | `UNKNOWN` | `MIT` | Historic browser polyfills and winston logging dependencies licensed under MIT. | Security Review | #1097 |
| `text-encoding-utf-8` | `UNKNOWN` | `CC0-1.0` | Public domain TextEncoder/TextDecoder polyfill. | Security Review | #1097 |

---

## 5. Dependency Review & Exception Process

When adding a new dependency or upgrading an existing package:

1. **Verify License**: Check that the package license is in the Permitted Licenses table.
2. **Update Lockfile**: Run lockfile-only generation without running lifecycle scripts:
   ```bash
   npm install --package-lock-only --ignore-scripts
   ```
3. **Run Inventory Validator Locally**:
   ```bash
   node scripts/validate-dependencies-and-licenses.mjs --ci
   ```
4. **Requesting an Exception**:
   If a package carries a dual license or non-standard identifier:
   - Verify the upstream repository license text.
   - Open a PR adding the package to `APPROVED_EXCEPTIONS` in `scripts/validate-dependencies-and-licenses.mjs` and this document.
   - Provide upstream link, effective license, and rationale.
   - Require approval from a repository maintainer before merge.

---

## 6. Continuous Integration (CI) Enforcement

The check runs on every pull request and push to `main` via `.github/workflows/ci.yml`.
The job runs:
```bash
node scripts/validate-dependencies-and-licenses.mjs --ci --output dependency-license-inventory.json
```
The resulting machine-readable inventory `dependency-license-inventory.json` is preserved as an artifact.
