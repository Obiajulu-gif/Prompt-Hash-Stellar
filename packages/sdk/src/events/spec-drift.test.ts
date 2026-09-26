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

function loadSpecBaseline(): SpecBaseline {
  const raw = fs.readFileSync(SPEC_BASELINE_PATH, "utf-8");
  return JSON.parse(raw) as SpecBaseline;
}

describe("EVENT_SCHEMAS vs. contracts/prompt-hash/spec-baseline.json", () => {
  const spec = loadSpecBaseline();
  const specEventNames = Object.keys(spec.events);

  it("has a schema entry for every event in the baseline spec", () => {
    for (const name of specEventNames) {
      expect(EVENT_SCHEMAS[name], `missing EVENT_SCHEMAS entry for "${name}"`).toBeDefined();
    }
  });

  it("does not define a schema for an event the baseline spec no longer has", () => {
    for (const name of Object.keys(EVENT_SCHEMAS)) {
      expect(specEventNames, `EVENT_SCHEMAS["${name}"] has no matching baseline event`).toContain(
        name,
      );
    }
  });

  it.each(specEventNames)("%s field names and types match the baseline spec", (name) => {
    const schema = EVENT_SCHEMAS[name];
    if (!schema) return; // already reported by the completeness test above

    const specFields = spec.events[name].map((raw) => {
      // Baseline entries look like "pub prompt_id: u64" or
      // "pub hashed_code: soroban_sdk::BytesN<32>" — strip the `pub` prefix
      // and split only on the *first* colon (the type itself may contain
      // "::" path separators).
      const withoutPub = raw.replace(/^pub\s+/, "");
      const sep = withoutPub.indexOf(":");
      return {
        name: withoutPub.slice(0, sep).trim(),
        type: withoutPub.slice(sep + 1).trim(),
      };
    });

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
});
