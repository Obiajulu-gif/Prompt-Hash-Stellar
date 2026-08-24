import { describe, expect, it } from "vitest";
import { formatXdrJsonToText, formatSpecType } from "./formatContractText";
import contractSpecFixture from "../../../tests/abi-conformance/fixtures/contract-spec.json";

describe("formatContractText", () => {
  describe("formatSpecType", () => {
    it("formats primitive types correctly", () => {
      expect(formatSpecType("U32")).toBe("u32");
      expect(formatSpecType("U64")).toBe("u64");
      expect(formatSpecType("I128")).toBe("i128");
      expect(formatSpecType("ScString")).toBe("String");
      expect(formatSpecType("Address")).toBe("Address");
      expect(formatSpecType("Bool")).toBe("bool");
    });

    it("formats complex nested spec types", () => {
      expect(formatSpecType({ vec: { element_type: "U64" } })).toBe("Vec<u64>");
      expect(formatSpecType({ option: { value_type: "Address" } })).toBe("Option<Address>");
      expect(formatSpecType({ udt: { name: "Prompt" } })).toBe("Prompt");
      expect(
        formatSpecType({
          map: { key_type: "ScSymbol", val_type: "I128" },
        })
      ).toBe("Map<Symbol, i128>");
      expect(
        formatSpecType({
          tuple: { type_list: ["U64", "Address"] },
        })
      ).toBe("(u64, Address)");
      expect(formatSpecType({ bytes_n: { n: 32 } })).toBe("BytesN<32>");
    });
  });

  describe("formatXdrJsonToText for contractmetav0", () => {
    it("formats meta entries into labeled key-value lines", () => {
      const json = JSON.stringify({
        sc_meta_v0: {
          key: "rs_meta_version",
          val: "1.0.0",
        },
      });

      const formatted = formatXdrJsonToText("contractmetav0", json);
      expect(formatted).toBe("[Contract Metadata]\nKey: rs_meta_version\nValue: 1.0.0");
    });
  });

  describe("formatXdrJsonToText for contractenvmetav0", () => {
    it("formats environment meta entries into labeled lines", () => {
      const json = JSON.stringify({
        sc_env_meta_kind_interface_version: {
          interface_version: 0,
        },
      });

      const formatted = formatXdrJsonToText("contractenvmetav0", json);
      expect(formatted).toBe("[Environment Metadata]\nInterface Version: 0");
    });
  });

  describe("formatXdrJsonToText for contractspecv0", () => {
    it("formats function spec entries with inputs and outputs", () => {
      const functionSpec = {
        sc_spec_entry_function_v0: {
          name: "create_prompt",
          doc: "Creates a new prompt listing on-chain.",
          inputs: [
            { name: "creator", type: "Address", doc: "Listing creator" },
            { name: "price_stroops", type: "I128" },
            { name: "content_hash", type: { bytes_n: { n: 32 } } },
          ],
          outputs: [{ result: { ok_type: "U64", error_type: { udt: { name: "Error" } } } }],
        },
      };

      const formatted = formatXdrJsonToText("contractspecv0", JSON.stringify(functionSpec));
      expect(formatted).toMatchInlineSnapshot(`
        "[Function Spec]
        Name: create_prompt
        Doc: Creates a new prompt listing on-chain.
        Inputs:
          - creator: Address (Listing creator)
          - price_stroops: i128
          - content_hash: BytesN<32>
        Outputs:
          - Result<u64, Error>"
      `);
    });

    it("formats struct spec entries with fields", () => {
      const structSpec = {
        sc_spec_entry_udt_struct_v0: {
          name: "Prompt",
          doc: "On-chain prompt record",
          fields: [
            { name: "id", type: "U64" },
            { name: "creator", type: "Address" },
            { name: "content_hash", type: { bytes_n: { n: 32 } } },
            { name: "price_stroops", type: "I128" },
          ],
        },
      };

      const formatted = formatXdrJsonToText("contractspecv0", JSON.stringify(structSpec));
      expect(formatted).toMatchInlineSnapshot(`
        "[Struct Spec]
        Name: Prompt
        Doc: On-chain prompt record
        Fields:
          - id: u64
          - creator: Address
          - content_hash: BytesN<32>
          - price_stroops: i128"
      `);
    });

    it("formats union/enum spec entries with cases", () => {
      const unionSpec = {
        sc_spec_entry_udt_union_v0: {
          name: "PromptSaleStatus",
          doc: "Listing status enum",
          cases: [{ name: "Draft" }, { name: "Active" }, { name: "Paused" }, { name: "Retired" }],
        },
      };

      const formatted = formatXdrJsonToText("contractspecv0", JSON.stringify(unionSpec));
      expect(formatted).toMatchInlineSnapshot(`
        "[Union Spec]
        Name: PromptSaleStatus
        Doc: Listing status enum
        Cases:
          - Draft
          - Active
          - Paused
          - Retired"
      `);
    });
  });

  describe("golden output snapshot testing against contract-spec fixture", () => {
    it("formats known-good contract spec data types into readable golden text format", () => {
      // Use AccessPass, DataKey, and Prompt struct signatures from contract-spec fixture
      const accessPassFields = contractSpecFixture.data_types.AccessPass;
      expect(accessPassFields).toBeDefined();

      const structFromFixture = {
        sc_spec_entry_udt_struct_v0: {
          name: "AccessPass",
          doc: "Catalog access pass grant",
          fields: accessPassFields.map((fieldStr) => {
            const parts = fieldStr.replace("pub ", "").split(": ");
            return { name: parts[0], type: parts[1] || "unknown" };
          }),
        },
      };

      const formatted = formatXdrJsonToText("contractspecv0", JSON.stringify(structFromFixture));
      expect(formatted).toContain("[Struct Spec]");
      expect(formatted).toContain("Name: AccessPass");
      expect(formatted).toContain("  - id: u128");
      expect(formatted).toContain("  - creator: Address");
      expect(formatted).toContain("  - price_stroops: i128");
      expect(formatted).toMatchSnapshot();
    });
  });
});
