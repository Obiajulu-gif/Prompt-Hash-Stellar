import { beforeEach, describe, expect, it } from "vitest";
import {
  getSourcePromptId,
  saveRemixAttribution,
} from "./remixAttribution";

describe("remix attribution", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores and retrieves a source listing ID", () => {
    saveRemixAttribution("12", "7");
    expect(getSourcePromptId(12n)).toBe("7");
  });

  it("returns undefined when no source is recorded", () => {
    expect(getSourcePromptId("99")).toBeUndefined();
  });
});
