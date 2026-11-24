# Deterministic Payload & Boundary Property Testing

`yarn test:fuzz` exercises malformed listing/encryption payloads, boundary numeric representations, and temporal window/timestamp constraints at the same validators used by the marketplace (#1038, #1145). It uses a checked-in default seed (`1038`) and no network, clock, wallet, or database, so CI results are fully reproducible.

## Boundary Numeric & Timestamp Property Coverage (#1145)

The property test suite in `src/test/fuzz-boundaries.test.ts` formally verifies state transitions, bounds, and roundtrip invariants:

### 1. Numeric Boundary Properties
- **Roundtrip Bijectivity Invariant:** For all stroop quantities $s \in [0, 1000000000000]$ (up to 100,000 XLM), conversion via `exactStroopsToXlmString(s)` and inverse parsing via `xlmToStroops` yields $s$ identically without precision loss or floating-point drift.
- **Fractional Precision:** Valid inputs with 1 through 7 decimal places (down to 1 stroop: `0.0000001` XLM) parse deterministically.
- **Failure Modes:** Inputs with excess decimals (> 7 places), scientific notation (`1e-7`, `1e5`), non-ASCII numerals (`９９`), hexadecimal, binary, non-finite values (`NaN`, `Infinity`), or empty/whitespace strings fail closed with `TypeError` or `RangeError`.
- **Negative Zero Handling:** Inputs like `"-0"` and `"-0.0000000"` resolve to `0n` stroops and are strictly caught by positive price validation checks.

### 2. Timestamp & Temporal Window Properties
- **Drift Tolerance Window:** Webhook and event timestamps within the standard 5-minute drift envelope ($|t_{\text{received}} - t_{\text{now}}| \le 300\,000\text{ ms}$) pass validation.
- **Epoch & Integer Limits:** Validates behavior at Unix epoch 0 (1970-01-01), the 32-bit signed integer boundary (Year 2038 / 2,147,483,647s), the 32-bit unsigned integer boundary (Year 2106 / 4,294,967,295s), and JavaScript's maximum date limit ($8.64 \times 10^{15}\text{ ms}$).
- **Fail-Closed Drift Enforcement:** Timestamps even 1 ms outside the acceptable drift window ($now \pm 300\,001\text{ ms}$) or in the future fail closed with `valid: false`.

### 3. Normal, Failure, Authorization, and Retry Paths
- **Normal Path:** Valid payloads, acceptable prices (0.00001–100,000 XLM), and fresh timestamps pass validation seamlessly.
- **Failure Path:** Invalid boundary numeric inputs or expired/future timestamps fail closed with explicit, non-leaking error reasons without unhandled exceptions.
- **Authorization Path:** Webhook payload signatures cryptographically bind payload bytes and header timestamp `${timestamp}.${payload}`. Any timestamp tampering invalidates HMAC verification, defending against replay and time-shifting attacks.
- **Retry & Recovery Path:** When requests fail due to stale timestamps (`STALE_REQUEST`), clients regenerate a current timestamp (`Date.now()`), re-sign, and retry successfully.

## Failure and retry

A failure prints the run and seed. Re-run it with `FUZZ_SEED=<seed> yarn test:fuzz`, reduce the payload to a regression example, fix the validator, and retain that example in the boundary table. A new seed may be supplied in scheduled CI to broaden coverage, but pull-request CI must always include the default seed.

Malformed authorization values are expected to fail closed at the existing challenge/verify tests; fuzz cases must never substitute fake authorization success. Inputs over payload limits are rejected before wallet signing or a chain submission, so retry only after correcting the payload.

## Operational edges and rollback

- Strings use exact decimal parsing: scientific notation, hexadecimal, suffixes, non-finite numbers, and more than seven fractional digits are rejected. Listing prices enforce the canonical 0.00001–100,000 XLM range. Existing valid decimal prices retain their stroop values.
- Exact encrypted-payload limits are accepted; one character over is rejected. Off-chain prompt storage remains unchanged.
- Validators treat wrong runtime types as missing/invalid instead of throwing. They do not echo hostile input into an error response.
- If the stricter price parser blocks a previously accepted client, roll back only `xlmToStroops`, capture the input as a regression fixture, and publish a migration rule before restoring strict parsing. Do not disable the malformed-payload suite.

Single-field mutations also check that a malformed required field cannot pass because all other fields are valid. Correcting that field should allow the same listing to pass validation.
