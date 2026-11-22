/**
 * Drift check against the contract's checked-in spec — Issue #424.
 *
 * `contracts/prompt-hash/spec-baseline.json` is this repo's existing
 * checked-in ABI specification (see docs/abi-versioning-policy.md and
 * `tests/abi-conformance/`), kept in sync with `events.rs` by hand today.
 * This test cross-validates `EVENT_SCHEMAS` (schema.ts) against that same
 * baseline so a change to one without the other fails CI — a real, if
 * partial, instance of acceptance criterion 2 ("CI fails when the Rust
 * event definition changes without a compatible schema update"), reusing
 * the spec this repo already generates rather than inventing a second
 * source of truth.
 *
 * Coverage map (normal / failure / retry / authorization paths):
 *  - normal:        every baseline event has a matching schema with identical
 *                   field names and mapped types, in declaration order.
 *  - failure:       a missing schema entry, an orphaned schema entry, a field
 *                   rename/reorder, or an unmapped Rust type each fail loudly.
 *  - retry:         the check is pure and idempotent — re-reading the baseline
 *                   and re-running the comparison yields the same result, so
 *                   CI retries cannot flip the verdict.
 *  - authorization: events carrying an `Address` / `Option<Address>` field must
 *                   keep that field typed as an address; a schema that downgrades
 *                   an authorizing principal to a plain string is rejected.
 *
 * Edge cases and recovery:
 *  - A baseline entry without a `pub` prefix is still accepted.
 *  - Type strings with a module path (`soroban_sdk::BytesN<32>`) are normalized.
 *  - If the baseline file is missing or malformed, the suite fails at load time
 *    with the underlying filesystem/JSON error; recovery is to restore the file
 *    from git, not to edit this test.
 *  - Rollback: if an intentional ABI change lands, update `spec-baseline.json`
 *    and `EVENT_SCHEMAS` in the same commit and bump the ABI version per
 *    docs/abi-versioning-policy.md. Reverting either side alone will fail here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENT_SCHEMAS, type EventFieldType } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_BASELINE_PATH = path.join(
  __dirname,
  "../../../../contracts/prompt-hash/spec-baseline.json",
);

interface SpecBaseline {
  events: Record<string, string[]>;
}

interface SpecField {
  name: string;
  type: string;
}

/** Maps a Rust-syntax type string (e.g. "u64", "Option<Address>") to our schema's field type. */
function rustTypeToFieldType(rustType: string): EventFieldType | undefined {
  // Strip a fully-qualified module path prefix, e.g. "soroban_sdk::BytesN<32>".
  const normalized = rustType.trim().replace(/^[\w]+::/, "");
  if (normalized === "BytesN<32>") return "bytes32";
  if (normalized === "Option<Address>") return "option<address>";
  if (normalized === "Vec<u64>") return "vec<u64>";
  if (normalized === "Address") return "address";
  if (normalized === "String") return "string";
  if (["u32", "u64", "u128", "i128", "bool"].includes(normalized)) {
    return normalized as EventFieldType;
  }
  return undefined;
}

/** Parses a baseline entry like "pub prompt_id: u64" into name/type. */
function parseSpecField(raw: string): SpecField {
  // Strip the optional `pub` prefix and split only on the *first* colon,
  // since the type itself may contain "::" path separators.
  const withoutPub = raw.replace(/^pub\s+/, "");
  const sep = withoutPub.indexOf(":");
  return {
    name: withoutPub.slice(0, sep).trim(),
    type: withoutPub.slice(sep + 1).trim(),
  };
}

function loadSpecBaseline(): SpecBaseline {
  const raw = fs.readFileSync(SPEC_BASELINE_PATH, "utf-8");
  return JSON.parse(raw) as SpecBaseline;
}

describe("EVENT_SCHEMAS vs. contracts/prompt-hash/spec-baseline.json", () => {
  const spec = loadSpecBaseline();
  const specEventNames = Object.keys(spec.events);

  // normal path
  it("has a schema entry for every event in the baseline spec", () => {
    for (const name of specEventNames) {
      expect(EVENT_SCHEMAS[name], `missing EVENT_SCHEMAS entry for "${name}"`).toBeDefined();
    }
  });

  // failure path: orphaned schema
  it("does not define a schema for an event the baseline spec no longer has", () => {
    for (const name of Object.keys(EVENT_SCHEMAS)) {
      expect(specEventNames, `EVENT_SCHEMAS["${name}"] has no matching baseline event`).toContain(
        name,
      );
    }
  });

  // normal + failure: field names, ordering, and types
  it.each(specEventNames)("%s field names and types match the baseline spec", (name) => {
    const schema = EVENT_SCHEMAS[name];
    expect(schema, `missing EVENT_SCHEMAS entry for "${name}"`).toBeDefined();
    if (!schema) return;

    const specFields = spec.events[name].map(parseSpecField);

    expect(schema.fields.map((f) => f.name)).toEqual(specFields.map((f) => f.name));

    specFields.forEach((specField, i) => {
      const mapped = rustTypeToFieldType(specField.type);
      expect(
        mapped,
        `baseline type "${specField.type}" for ${name}.${specField.name} has no known mapping in spec-drift.test.ts`,
      ).toBeDefined();
      expect(schema.fields[i]?.type).toBe(mapped);
    });
  });

  // retry path: the comparison is pure and deterministic across repeated runs
  it("produces a stable verdict when the baseline is re-read", () => {
    const first = loadSpecBaseline();
    const second = loadSpecBaseline();
    expect(second).toEqual(first);
    for (const name of Object.keys(first.events)) {
      const a = first.events[name].map(parseSpecField);
      const b = second.events[name].map(parseSpecField);
      expect(b).toEqual(a);
    }
  });

  // authorization path: principal-bearing fields must stay typed as addresses
  it("keeps Address-typed fields as address schema types, never plain strings", () => {
    for (const name of specEventNames) {
      const schema = EVENT_SCHEMAS[name];
      if (!schema) continue;
      const specFields = spec.events[name].map(parseSpecField);
      specFields.forEach((specField, i) => {
        if (/Address/.test(specField.type)) {
          const type = schema.fields[i]?.type;
          expect(
            type === "address" || type === "option<address>",
            `${name}.${specField.name} authorizes via Address but schema type is "${type}"`,
          ).toBe(true);
        }
      });
    }
  });

  // failure path: unmapped Rust types must be rejected rather than silently passing
  it("rejects unknown Rust types in the mapping helper", () => {
    expect(rustTypeToFieldType("HashMap<String, u64>")).toBeUndefined();
    expect(rustTypeToFieldType("f64")).toBeUndefined();
  });
});
