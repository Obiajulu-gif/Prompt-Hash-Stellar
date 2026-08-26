import { describe, expect, it } from "vitest";
import { decodeEvent } from "./decode.js";
import { EVENT_FIXTURES } from "./fixtures.js";
import { EVENT_SCHEMAS } from "./schema.js";

describe("decodeEvent", () => {
  it.each(EVENT_FIXTURES)("decodes $type identically to its golden fixture", (fixture) => {
    const result = decodeEvent(fixture.type, fixture.raw);
    expect(result).toEqual(fixture.expected);
  });

  it("has a fixture for every schema entry (criterion: every event has a schema + fixture)", () => {
    const fixtureTypes = new Set(EVENT_FIXTURES.map((f) => f.type));
    for (const schemaName of Object.keys(EVENT_SCHEMAS)) {
      expect(fixtureTypes.has(schemaName)).toBe(true);
    }
    expect(fixtureTypes.size).toBe(Object.keys(EVENT_SCHEMAS).length);
  });

  it("does not throw and marks an unknown event type as unrecognized", () => {
    const result = decodeEvent("SomeFutureEventTypeNotYetDefined", { foo: "bar" });
    expect(result).toEqual({
      recognized: false,
      type: "SomeFutureEventTypeNotYetDefined",
      version: 1,
      reason: "unknown_type",
      raw: { foo: "bar" },
    });
  });

  it("does not throw and marks an unsupported future version as unrecognized", () => {
    const result = decodeEvent("PromptCreated", { prompt_id: 1n }, 2);
    expect(result).toEqual({
      recognized: false,
      type: "PromptCreated",
      version: 2,
      reason: "unsupported_version",
      raw: { prompt_id: 1n },
    });
  });

  it("coerces missing optional fields to undefined rather than throwing", () => {
    const result = decodeEvent("PromptPurchased", {
      prompt_id: 1n,
      buyer: "GBUYER",
      creator: "GCREATOR",
      price_stroops: 100n,
      // referrer omitted entirely
    });
    expect(result.recognized).toBe(true);
    expect((result as { data: Record<string, unknown> }).data.referrer).toBeUndefined();
  });

  it("decodes a mixed-version event stream (v1, v2, and unrecognized future event)", () => {
    const rawStream = [
      { type: "PromptCreated", raw: { prompt_id: 1n, creator: "GCREATOR1", price_stroops: 1000n, asset: "GASSET" } }, // v1
      { type: "PromptCreated", raw: { prompt_id: 2n, creator: "GCREATOR2", price_stroops: 2000n, asset: "GASSET", version: 2 } }, // v2
      { type: "UnknownFutureEvent", raw: { data: "test" } },
    ];

    const decodedStream = rawStream.map((evt) => decodeEvent(evt.type, evt.raw));

    expect(decodedStream[0]).toEqual({
      recognized: true,
      type: "PromptCreated",
      version: 1,
      data: { prompt_id: 1n, creator: "GCREATOR1", price_stroops: 1000n, asset: "GASSET" },
    });

    expect(decodedStream[1]).toEqual({
      recognized: true,
      type: "PromptCreated",
      version: 2,
      data: { prompt_id: 2n, creator: "GCREATOR2", price_stroops: 2000n, asset: "GASSET", version: 2 },
    });

    expect(decodedStream[2]).toEqual({
      recognized: false,
      type: "UnknownFutureEvent",
      version: 1,
      reason: "unknown_type",
      raw: { data: "test" },
    });
  });
});

