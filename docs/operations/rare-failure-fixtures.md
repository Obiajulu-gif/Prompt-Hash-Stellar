# Fixture Generators for Rare Failure and Recovery Paths (#1033)

Operational resilience in Stellar-based marketplaces demands automated verification of low-frequency, high-impact failure modes. Traditional test mocks often over-simplify blockchain semantics, missing race conditions, ledger boundary timeouts, and smart contract finality constraints.

The Rare Failure Fixture Generator framework (`server/src/services/rareFailureFixtureGenerator.ts`) produces deterministic, seedable test fixtures and executable invariant checks for rare operational failure modes.

---

## 1. Simulated Failure Scenarios

| Scenario | Injected Fault & Error Code | Recovery Protocol |
| :--- | :--- | :--- |
| **Soroban RPC Timeout** | RPC `TRY_AGAIN_LATER` $\to$ `tx_too_late` when `maxLedger` expires. | Re-simulate resource footprint, query latest ledger sequence, extend `maxLedger` time-bounds, and re-broadcast (`RETRY`). |
| **Account Sequence Desync** | Stellar protocol error `tx_bad_seq` due to concurrent transactions. | Fetch latest source account sequence from network, re-increment, re-sign, and submit (`RESYNC`). |
| **Contract Finality Collision** | Soroban error `InvalidStatusTransition` when modifying an already `Retired` listing. | Isolate the permanent failure, prevent retry storms, commit remaining active items, and render a finality warning (`ROLLBACK`). |
| **Content Hash Tampering** | Content hash mismatch during unlock (`ContentHashMismatch`). | Terminate decryption, halt plaintext delivery, quarantine asset in database, and emit forensic security log (`QUARANTINE`). |
| **Event Journal Ledger Gap** | Sequence gap $[L_{last} + 1 \dots L_{in} - 1]$ detected in event stream. | Pause live indexer projection cursor, enqueue targeted backfill replay job, and resume upon gap closure (`RESYNC`). |
| **Security Revocation Race** | Token invalidated by security event while transaction is in flight. | Reject request with `401 Unauthorized` and prompt for step-up challenge signature. |

---

## 2. Deterministic PRNG (`mulberry32`)

To eliminate test flakiness while retaining random input coverage:
- All fixture generators take an explicit integer `seed`.
- The `mulberry32` PRNG algorithm deterministically derives pseudo-random amounts, prompt IDs, and ledger offsets.
- Identical seeds generate identical fixtures and identical SHA-256 fingerprints across any machine or operating system.

---

## 3. Fixture Interface

Every generated fixture returns:
- `fixtureId`: Stable unique identifier
- `scenarioType`: Canonical failure category
- `initialState`: Pre-fault mock state
- `simulatedFault`: The exact injected error payload, status codes, and retry flags
- `expectedRecovery`: The expected recovery action (`RETRY`, `ROLLBACK`, `QUARANTINE`, `RESYNC`), compensation steps, expected state, and `assertFinalState` verification predicate.
- `fingerprint`: Cryptographic SHA-256 hash verifying fixture immutability.
