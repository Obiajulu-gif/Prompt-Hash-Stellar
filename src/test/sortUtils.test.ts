import { describe, it, expect } from "vitest";
import { sortDeterministically } from "../lib/sortUtils";

describe("sortDeterministically", () => {
  it("sorts by status precedence", () => {
    const items = [
      { id: "1", status: "Retired" },
      { id: "2", status: "Active" },
      { id: "3", status: "Paused" },
      { id: "4", status: "Draft" },
      { id: "5", status: "Restricted" },
    ];
    const sorted = sortDeterministically(items);
    expect(sorted.map(i => i.id)).toEqual(["2", "4", "3", "5", "1"]);
  });

  it("sorts by timestamp (newest first) when status is equal", () => {
    const items = [
      { id: "1", status: "Active", createdAt: new Date("2023-01-01").getTime() },
      { id: "2", status: "Active", createdAt: new Date("2023-01-03").getTime() },
      { id: "3", status: "Active", createdAt: new Date("2023-01-02").getTime() },
    ];
    const sorted = sortDeterministically(items);
    expect(sorted.map(i => i.id)).toEqual(["2", "3", "1"]);
  });

  it("uses ID as tie-breaker for equal status and timestamp", () => {
    const items = [
      { id: "B", status: "Active", createdAt: 1000 },
      { id: "C", status: "Active", createdAt: 1000 },
      { id: "A", status: "Active", createdAt: 1000 },
    ];
    const sorted = sortDeterministically(items);
    expect(sorted.map(i => i.id)).toEqual(["A", "B", "C"]);
  });

  it("handles missing values gracefully", () => {
    const items = [
      { id: "2" }, // no status, no timestamp
      { id: "1", status: "Active" },
    ];
    const sorted = sortDeterministically(items);
    expect(sorted.map(i => i.id)).toEqual(["1", "2"]);
  });

  it("handles mixed scenarios", () => {
    const items = [
      { id: "C", status: "Active", createdAt: 1000 },
      { id: "A", status: "Active", createdAt: 1000 }, // same status, same time -> A before C
      { id: "B", status: "Active", createdAt: 2000 }, // same status, newer time -> B before A
      { id: "E", status: "Paused", createdAt: 3000 }, // worse status -> E after all Active
      { id: "D", status: "Draft", createdAt: 0 },     // Draft is better than Paused, but worse than Active
    ];
    const sorted = sortDeterministically(items);
    expect(sorted.map(i => i.id)).toEqual(["B", "A", "C", "D", "E"]);
  });
});
