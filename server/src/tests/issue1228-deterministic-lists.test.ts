import { describe, expect, it } from "vitest";
import {
  decodeDeterministicCursor,
  encodeDeterministicCursor,
  sortMixedStatusRecords,
  EVENT_STATUS_PRECEDENCE,
  type SortableRecord,
} from "../services/deterministicSorting";

describe("issue #1228 deterministic status and event lists", () => {
  it("uses immutable tie-breakers when status and timestamps match", () => {
    const records: SortableRecord[] = [
      { id: "b", status: "unknown", primaryKey: 10, secondaryKey: 2 },
      { id: "a", status: "unknown", primaryKey: 10, secondaryKey: 2 },
      { id: "c", status: "active", primaryKey: 10, secondaryKey: 2 },
    ];

    expect(sortMixedStatusRecords(records).map((record) => record.id)).toEqual(["c", "a", "b"]);
    expect(sortMixedStatusRecords([...records].reverse()).map((record) => record.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("applies the event precedence map independently of input order", () => {
    const events: SortableRecord[] = [
      { id: "retry", status: "replayed", primaryKey: 7 },
      { id: "dead-letter", status: "dlq", primaryKey: 7 },
      { id: "done", status: "committed", primaryKey: 7 },
    ];

    expect(
      sortMixedStatusRecords(events, {
        groupByStatus: true,
        statusPrecedence: EVENT_STATUS_PRECEDENCE,
      }).map((event) => event.id),
    ).toEqual(["done", "retry", "dead-letter"]);
  });

  it("rejects a tampered cursor instead of changing the requested page", () => {
    const secret = "issue-1228-test-secret";
    const cursor = encodeDeterministicCursor(
      { id: "event-1", status: "committed", primaryKey: 7 },
      secret,
    );
    const [payload, signature] = cursor.split(".");
    const tampered = `${payload}.invalid-signature`;

    expect(signature).toBeTruthy();
    expect(() => decodeDeterministicCursor(tampered, secret)).toThrow("integrity");
  });
});
