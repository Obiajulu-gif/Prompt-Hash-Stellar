import { describe, it, expect } from "vitest";
import {
  parsePaginationParams,
  encodeCompoundCursor,
  decodeCompoundCursor,
  buildMongoCompoundQuery,
  paginateArrayDeterministic,
  PaginationError,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../utils/pagination";

describe("Bounded Pagination & Query Limits (#1096)", () => {
  describe("Query parameter validation & limits", () => {
    it("uses default limit when limit parameter is omitted", () => {
      const parsed = parsePaginationParams({});
      expect(parsed.limit).toBe(DEFAULT_PAGE_SIZE);
      expect(parsed.cursor).toBeUndefined();
    });

    it("parses valid custom limit within bounds", () => {
      const parsed = parsePaginationParams({ limit: "35" });
      expect(parsed.limit).toBe(35);
    });

    it("rejects oversized page request with PAGE_SIZE_EXCEEDED code", () => {
      expect(() => parsePaginationParams({ limit: "51" })).toThrowError(PaginationError);

      try {
        parsePaginationParams({ limit: "100" });
      } catch (err: any) {
        expect(err.code).toBe("PAGE_SIZE_EXCEEDED");
        expect(err.status).toBe(400);
        expect(err.message).toContain(`maximum allowed limit of ${MAX_PAGE_SIZE}`);
      }
    });

    it("rejects non-integer, zero, and negative limits with INVALID_PAGE_SIZE code", () => {
      const invalidLimits = ["0", "-1", "-50", "abc", "12.5", "NaN"];
      for (const raw of invalidLimits) {
        expect(() => parsePaginationParams({ limit: raw })).toThrowError(PaginationError);
        try {
          parsePaginationParams({ limit: raw });
        } catch (err: any) {
          expect(err.code).toBe("INVALID_PAGE_SIZE");
          expect(err.status).toBe(400);
        }
      }
    });

    it("rejects malformed cursors with INVALID_CURSOR code", () => {
      const invalidCursors = [
        "not-a-valid-cursor",
        "!!!invalid-base64???",
        Buffer.from(JSON.stringify({ bad: true })).toString("base64url"),
        Buffer.from(JSON.stringify({ ts: "invalid-date", id: "1" })).toString("base64url"),
      ];

      for (const cur of invalidCursors) {
        expect(() => parsePaginationParams({ cursor: cur })).toThrowError(PaginationError);
        try {
          parsePaginationParams({ cursor: cur });
        } catch (err: any) {
          expect(err.code).toBe("INVALID_CURSOR");
          expect(err.status).toBe(400);
        }
      }
    });
  });

  describe("Compound cursor stability & round-trip", () => {
    it("correctly encodes and decodes compound cursor with timestamp and id", () => {
      const now = new Date("2026-10-24T12:00:00.000Z");
      const cursor = encodeCompoundCursor({
        timestamp: now,
        id: "prompt-12345",
        sequence: 42,
      });

      expect(typeof cursor).toBe("string");
      const decoded = decodeCompoundCursor(cursor);
      expect(decoded.timestamp.toISOString()).toBe(now.toISOString());
      expect(decoded.id).toBe("prompt-12345");
      expect(decoded.sequence).toBe(42);
    });

    it("supports legacy 24-character hexadecimal MongoDB ObjectIds", () => {
      const hexId = "507f1f77bcf86cd799439011";
      const decoded = decodeCompoundCursor(hexId);
      expect(decoded.id).toBe(hexId);
      expect(decoded.timestamp instanceof Date).toBe(true);
    });

    it("generates correct MongoDB compound keyset query for descending sort", () => {
      const now = new Date("2026-10-24T12:00:00.000Z");
      const cursor = encodeCompoundCursor({
        timestamp: now,
        id: "prompt-999",
      });

      const query = buildMongoCompoundQuery(cursor, {
        timestampField: "createdAt",
        idField: "_id",
        direction: -1,
      }) as any;

      expect(query.$or).toHaveLength(2);
      expect(query.$or[0].createdAt).toEqual({ $lt: now });
      expect(query.$or[1].createdAt).toEqual(now);
      expect(query.$or[1]._id).toEqual({ $lt: "prompt-999" });
    });
  });

  describe("Deterministic ordering with shared timestamps", () => {
    interface TestRecord {
      id: string;
      createdAt: string;
      value: number;
    }

    it("guarantees disjoint, complete pagination when records share identical timestamps", () => {
      const sharedTimestamp = "2026-10-24T10:00:00.000Z";
      const totalRecords = 50;
      // All 50 records share the EXACT same timestamp!
      const dataset: TestRecord[] = Array.from({ length: totalRecords }, (_, i) => ({
        id: `rec-${String(i).padStart(4, "0")}`,
        createdAt: sharedTimestamp,
        value: i,
      }));

      // Collect all pages with limit = 10
      const pageSize = 10;
      const seenIds = new Set<string>();
      let cursor: string | undefined = undefined;
      let pageCount = 0;

      while (true) {
        pageCount++;
        const page = paginateArrayDeterministic(dataset, {
          limit: pageSize,
          cursor,
          getTimestamp: (r) => r.createdAt,
          getId: (r) => r.id,
          direction: -1,
        });

        for (const item of page.data) {
          expect(seenIds.has(item.id)).toBe(false); // No duplicates
          seenIds.add(item.id);
        }

        if (!page.metadata.hasNextPage || !page.metadata.nextCursor) {
          break;
        }
        cursor = page.metadata.nextCursor;
      }

      // Assert complete coverage without skips or duplicate entries
      expect(pageCount).toBe(5);
      expect(seenIds.size).toBe(totalRecords);
      for (let i = 0; i < totalRecords; i++) {
        expect(seenIds.has(`rec-${String(i).padStart(4, "0")}`)).toBe(true);
      }
    });
  });

  describe("Performance benchmark tests", () => {
    interface BenchmarkRecord {
      id: string;
      createdAt: string;
      title: string;
    }

    it("handles empty result sets instantly (N = 0)", () => {
      const start = performance.now();
      const emptyResult = paginateArrayDeterministic([], {
        limit: 20,
        getTimestamp: (r: BenchmarkRecord) => r.createdAt,
        getId: (r: BenchmarkRecord) => r.id,
      });
      const durationMs = performance.now() - start;

      expect(emptyResult.data).toHaveLength(0);
      expect(emptyResult.metadata.hasNextPage).toBe(false);
      expect(emptyResult.metadata.nextCursor).toBeNull();
      expect(durationMs).toBeLessThan(5);
    });

    it("handles small result sets with zero overhead (N = 5)", () => {
      const smallDataset: BenchmarkRecord[] = Array.from({ length: 5 }, (_, i) => ({
        id: `small-${i}`,
        createdAt: new Date(1700000000000 + i * 1000).toISOString(),
        title: `Prompt ${i}`,
      }));

      const start = performance.now();
      const result = paginateArrayDeterministic(smallDataset, {
        limit: 20,
        getTimestamp: (r) => r.createdAt,
        getId: (r) => r.id,
      });
      const durationMs = performance.now() - start;

      expect(result.data).toHaveLength(5);
      expect(result.metadata.hasNextPage).toBe(false);
      expect(durationMs).toBeLessThan(10);
    });

    it("handles large result sets efficiently (N = 5,000 records)", () => {
      const largeCount = 5000;
      const baseTime = 1700000000000;
      const largeDataset: BenchmarkRecord[] = Array.from({ length: largeCount }, (_, i) => ({
        id: `large-${String(i).padStart(6, "0")}`,
        createdAt: new Date(baseTime + (i % 500) * 1000).toISOString(), // Multiple duplicates across timestamps
        title: `Large Prompt Benchmark ${i}`,
      }));

      const start = performance.now();
      // First page
      const page1 = paginateArrayDeterministic(largeDataset, {
        limit: 50,
        getTimestamp: (r) => r.createdAt,
        getId: (r) => r.id,
      });
      expect(page1.data).toHaveLength(50);
      expect(page1.metadata.hasNextPage).toBe(true);
      expect(page1.metadata.nextCursor).not.toBeNull();

      // Subsequent page seek
      const page2 = paginateArrayDeterministic(largeDataset, {
        limit: 50,
        cursor: page1.metadata.nextCursor!,
        getTimestamp: (r) => r.createdAt,
        getId: (r) => r.id,
      });
      const durationMs = performance.now() - start;

      expect(page2.data).toHaveLength(50);
      expect(page2.data[0].id).not.toBe(page1.data[49].id);
      expect(durationMs).toBeLessThan(100); // 5,000 records sorted & sliced under 100ms
    });
  });
});
