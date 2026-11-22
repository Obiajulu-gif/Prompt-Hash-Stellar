# Deterministic Payload Fuzzing

`yarn test:fuzz` exercises malformed listing/encryption payloads and boundary XLM values at the same validators used by the marketplace. It uses a checked-in default seed (`1038`) and no network, clock, wallet, or database, so CI results are reproducible.

## Failure and retry

A failure prints the run and seed. Re-run it with `FUZZ_SEED=<seed> yarn test:fuzz`, reduce the payload to a regression example, fix the validator, and retain that example in the boundary table. A new seed may be supplied in scheduled CI to broaden coverage, but pull-request CI must always include the default seed.

Malformed authorization values are expected to fail closed at the existing challenge/verify tests; fuzz cases must never substitute fake authorization success. Inputs over payload limits are rejected before wallet signing or a chain submission, so retry only after correcting the payload.

## Operational edges and rollback

- Strings use exact decimal parsing: scientific notation, hexadecimal, suffixes, non-finite numbers, and more than seven fractional digits are rejected. Listing prices enforce the canonical 0.00001–100,000 XLM range. Existing valid decimal prices retain their stroop values.
- Exact encrypted-payload limits are accepted; one character over is rejected. Off-chain prompt storage remains unchanged.
- Validators treat wrong runtime types as missing/invalid instead of throwing. They do not echo hostile input into an error response.
- If the stricter price parser blocks a previously accepted client, roll back only `xlmToStroops`, capture the input as a regression fixture, and publish a migration rule before restoring strict parsing. Do not disable the malformed-payload suite.

Single-field mutations also check that a malformed required field cannot pass because all other fields are valid. Correcting that field should allow the same listing to pass validation.
