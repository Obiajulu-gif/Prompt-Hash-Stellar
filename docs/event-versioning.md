# Contract Event Versioning (Issue #424, scoped slice)

This document defines how changes to `contracts/prompt-hash/src/events.rs`
should be classified, and describes what's built so far toward generated,
versioned event decoders for every consumer (indexer, SDK, frontend).

It complements [`abi-versioning-policy.md`](./abi-versioning-policy.md),
which covers the contract's whole ABI (functions, errors, structs). This
document is specifically about **events** and the runtime decoding path.

## What exists today

- **`contracts/prompt-hash/spec-baseline.json`** — the existing checked-in
  ABI specification (see `tests/abi-conformance/`), including every
  event's field list in Rust syntax.
- **`packages/sdk/src/events/schema.ts`** — a canonical TypeScript
  specification (`EVENT_SCHEMAS`) covering every event currently in
  `events.rs`, kept field-for-field consistent with `spec-baseline.json`.
- **`packages/sdk/src/events/decode.ts`** — `decodeEvent(type, raw, version)`,
  derived at runtime from `EVENT_SCHEMAS` rather than hand-written per
  event. An unknown event type, or a known type at a version this build
  doesn't have a schema for, returns `{ recognized: false, reason, raw }`
  instead of throwing or silently mis-decoding.
- **`packages/sdk/src/events/fixtures.ts`** — one golden fixture per event,
  asserted (in `decode.test.ts`) to decode identically via `decodeEvent`.
- **`packages/sdk/src/events/spec-drift.test.ts`** — cross-checks
  `EVENT_SCHEMAS` against `spec-baseline.json` field-by-field. This already
  caught and fixed a real drift: `PromptAdminModerated.prompt_id` was typed
  `u128` in both `spec-baseline.json` and its derived
  `tests/abi-conformance/fixtures/contract-spec.json`, but is `u64` in the
  actual `events.rs` source — neither was previously checked automatically.

## What's explicitly NOT done yet

- **No wire-level version field.** `events.rs` does not currently emit an
  explicit `version` number on any event — every event is treated as
  implicit version 1. `decodeEvent` already accepts/threads a version
  number so adding a real field later (e.g. via a new top-level envelope,
  or a `#[topic] version: u32` on each struct) is additive from the SDK's
  side, but the contract-side change itself is unscoped work.
- **No CI job runs `spec-drift.test.ts` (or the broader
  `tests/abi-conformance` suite) as a required, blocking check tied
  specifically to changes under `contracts/prompt-hash/src/events.rs`.**
  It runs as a normal test today; wiring a path-scoped required check is
  follow-up work.
- **The indexer (`server/src/services/indexer.ts`) and frontend have not
  been migrated to use `decodeEvent`.** They still decode each topic by
  hand (`scValToNative(event.value)` + manual destructuring). Migrating
  them is real, behavior-affecting work on production event processing
  and is deliberately left out of this slice to avoid shipping it
  untested against live indexer behavior.
- **`spec-baseline.json` and its derived fixture are still updated by
  hand** when a contract event changes — there's no automated extraction
  from the compiled contract's WASM spec.

## Classifying a change to an event

Given the schema shape in `schema.ts` (`{ name, version, fields: [{name, type}] }`):

- **Additive (does not require a version bump):**
  - Adding a new event type entirely.
  - Adding a new *optional* field to the end of an existing event's field
    list (i.e. an `Option<T>` in Rust, mapped to `"option<...>"` here).
- **Breaking (requires a version bump on that event's schema entry, and a
  corresponding decoder branch that can handle both the old and new shape
  during any transition window):**
  - Removing a field.
  - Renaming a field.
  - Changing a field's type (including widening an integer type, e.g.
    `u64` → `u128` — even though more values become representable, it's a
    different on-the-wire XDR type and changes how `coerceField` must
    treat it).
  - Reordering fields (this schema decodes by field *name*, not position,
    so reordering is currently safe for `decodeEvent` itself — but is
    still a breaking change for any consumer that decodes positionally,
    e.g. by treating `event.topic[0]` plus a fixed-order tuple).
- **Deprecated:** an event that's no longer emitted by any current contract
  code path, but whose schema entry (and any already-indexed historical
  data) must still decode. Keep the schema entry; mark it in a comment as
  deprecated rather than deleting it, so historical events already on
  testnet/mainnet remain decodable.

## Adding or changing an event: checklist

1. Update the `#[contractevent]` struct in `events.rs`.
2. Update `contracts/prompt-hash/spec-baseline.json` (and re-derive
   `tests/abi-conformance/fixtures/contract-spec.json` per the existing
   process in `abi-versioning-policy.md`).
3. Update `packages/sdk/src/events/schema.ts` to match. `spec-drift.test.ts`
   will fail if this is missed or inconsistent with step 2.
4. Add/update the event's fixture in `packages/sdk/src/events/fixtures.ts`.
5. If the change is breaking per the classification above, bump that
   event's `version` in `schema.ts` and keep the old schema version
   available if any consumer still needs to decode historical events at
   the old version.
