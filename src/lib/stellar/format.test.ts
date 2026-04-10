import { describe, expect, it } from "vitest";
import { stroopsToXlmString, xlmToStroops } from "./format";

describe("stellar format helpers", () => {
  it("converts XLM to stroops", () => {
    expect(xlmToStroops("1")).toBe(10_000_000n);
    expect(xlmToStroops("2.3456789")).toBe(23_456_789n);
  });

  it("converts stroops back to XLM strings", () => {
    expect(stroopsToXlmString(10_000_000n)).toBe("1");
    expect(stroopsToXlmString(23_456_789n)).toBe("2.3456789");
  });
});
