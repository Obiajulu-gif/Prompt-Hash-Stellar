// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { getXdrError } from "./getXdrError";
import type { ValidatorResult } from "../contract";

// A valid base64 TransactionEnvelope (generated via stellar-sdk).
const VALID_ENVELOPE =
  "AAAAAgAAAABfH+R8iJu29ySTTxhnUdMQK7GynnRLLV+ywzCduvI5twAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABfH+R8iJu29ySTTxhnUdMQK7GynnRLLV+ywzCduvI5twAAAAAAAAAAAJiWgAAAAAAAAAAA";

describe("getXdrError response contract", () => {
  it("returns false (valid) for a parseable XDR", () => {
    const result = getXdrError(VALID_ENVELOPE);
    expect(result).toBe(false);
  });

  it("returns an error string for malformed base64", () => {
    const result = getXdrError("!!!not base64!!!");
    expect(result).toBeTypeOf("string");
    expect(result).toMatch(/base64/i);
  });

  it("returns an error string for valid base64 that is not a valid XDR", () => {
    // Valid base64, but not a TransactionEnvelope.
    const notXdr = Buffer.from("hello world").toString("base64");
    const result = getXdrError(notXdr);
    expect(result).toBeTypeOf("string");
    expect(result).toMatch(/Unable to parse/i);
  });

  it("conforms to the shared ValidatorResult contract (never an object)", () => {
    for (const value of [VALID_ENVELOPE, "!!!bad", Buffer.from("x").toString("base64")]) {
      const result: ValidatorResult = getXdrError(value);
      // The contract is strictly `string | false`, never `{ result, message }`.
      expect(
        typeof result === "object" && result !== null && "result" in (result as object),
      ).toBe(false);
      expect(result === false || typeof result === "string").toBe(true);
    }
  });

  it("returns false for empty input (no error)", () => {
    expect(getXdrError("")).toBe(false);
  });
});
