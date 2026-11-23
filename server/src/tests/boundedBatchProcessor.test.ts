import { describe, expect, it, vi } from "vitest";
import {
  executeBoundedBatch,
  BatchAuthorizationError,
  type BatchActor,
  type BatchCheckpoint,
  type BatchCursorPage,
} from "../services/boundedBatchProcessor";

describe("Bounded Batch Processor for Large Datasets (Issue #1137)", () => {
  it("normal path: processes large dataset in bounded chunks with cursor pagination", async () => {
    // Generate simulated 250 items
    const allData = Array.from({ length: 250 }, (_, i) => ({ id: `rec_${i}`, val: i * 2 }));
    const processedIds: string[] = [];
    const checkpointRecords: BatchCheckpoint<number>[] = [];

    const actor: BatchActor = {
      id: "admin-batch",
      permissions: new Set(["batch:execute"]),
    };

    const report = await executeBoundedBatch<
      { id: string; val: number },
      number
    >(
      {
        jobName: "reindex_prompts",
        batchSize: 50,
        requiredPermission: "batch:execute",
        fetchPage: async (cursor: number | null, limit: number) => {
          const startIndex = cursor ?? 0;
          const items = allData.slice(startIndex, startIndex + limit);
          const nextIndex = startIndex + items.length;
          return {
            items,
            nextCursor: nextIndex < allData.length ? nextIndex : null,
            hasMore: nextIndex < allData.length,
          };
        },
        processItem: async (item) => {
          processedIds.push(item.id);
        },
        saveCheckpoint: async (ckpt) => {
          checkpointRecords.push(ckpt);
        },
      },
      actor,
    );

    expect(report.status).toBe("completed");
    expect(report.totalProcessed).toBe(250);
    expect(report.totalSucceeded).toBe(250);
    expect(report.totalFailed).toBe(0);
    expect(processedIds).toHaveLength(250);
    expect(checkpointRecords.length).toBe(5); // 250 / 50 = 5 checkpoints
    expect(checkpointRecords[checkpointRecords.length - 1].isComplete).toBe(true);
  });

  it("failure path: isolates individual item errors and continues processing remainder", async () => {
    const items = [
      { id: "1", fail: false },
      { id: "2", fail: true },
      { id: "3", fail: false },
    ];
    const successes: string[] = [];
    const compensated: string[] = [];

    const report = await executeBoundedBatch(
      {
        jobName: "partial_failure_job",
        batchSize: 10,
        fetchPage: async () => ({
          items,
          nextCursor: null,
          hasMore: false,
        }),
        processItem: async (item) => {
          if (item.fail) throw new Error(`Simulated processing error on ${item.id}`);
          successes.push(item.id);
        },
        compensate: async (item) => {
          compensated.push(item.id);
        },
      },
    );

    expect(report.status).toBe("completed");
    expect(report.totalProcessed).toBe(3);
    expect(report.totalSucceeded).toBe(2);
    expect(report.totalFailed).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].error).toContain("Simulated processing error on 2");
    expect(successes).toEqual(["1", "3"]);
    expect(compensated).toEqual(["2"]);
  });

  it("circuit breaker: aborts execution when consecutive errors exceed threshold", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, fail: true }));
    let lastCheckpoint: BatchCheckpoint<string> | null = null;

    const report = await executeBoundedBatch(
      {
        jobName: "circuit_breaker_job",
        batchSize: 20,
        maxConsecutiveErrors: 3,
        fetchPage: async () => ({
          items,
          nextCursor: "chunk_2",
          hasMore: true,
        }),
        processItem: async () => {
          throw new Error("Repeated storage write failure");
        },
        saveCheckpoint: async (ckpt) => {
          lastCheckpoint = ckpt;
        },
      },
    );

    expect(report.status).toBe("aborted");
    expect(report.totalFailed).toBe(3);
    expect(lastCheckpoint).not.toBeNull();
    expect(lastCheckpoint!.failureCount).toBe(3);
  });

  it("retry path: resumes correctly from committed checkpoint cursor", async () => {
    const allItems = ["a", "b", "c", "d", "e", "f"];
    const processed: string[] = [];

    // Simulate resuming with an existing checkpoint at cursor = 3
    const resumeCheckpoint: BatchCheckpoint<number> = {
      jobName: "resume_job",
      cursor: 3,
      processedCount: 3,
      successCount: 3,
      failureCount: 0,
      updatedAt: new Date().toISOString(),
      isComplete: false,
    };

    const report = await executeBoundedBatch<string, number>(
      {
        jobName: "resume_job",
        batchSize: 2,
        fetchPage: async (cursor, limit) => {
          const start = cursor ?? 0;
          const slice = allItems.slice(start, start + limit);
          const next = start + slice.length;
          return {
            items: slice,
            nextCursor: next < allItems.length ? next : null,
            hasMore: next < allItems.length,
          };
        },
        processItem: async (item) => {
          processed.push(item);
        },
      },
      undefined,
      resumeCheckpoint,
    );

    expect(report.status).toBe("completed");
    expect(report.totalProcessed).toBe(6);
    expect(processed).toEqual(["d", "e", "f"]); // Started from index 3
  });

  it("authorization path: denies unauthorized actor before executing any batches", async () => {
    const fetchPageMock = vi.fn();
    const actor: BatchActor = {
      id: "untrusted_worker",
      permissions: new Set(["read:public"]),
    };

    await expect(
      executeBoundedBatch(
        {
          jobName: "protected_export",
          requiredPermission: "admin:export_all",
          fetchPage: fetchPageMock,
          processItem: async () => {},
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BatchAuthorizationError);

    expect(fetchPageMock).not.toHaveBeenCalled();
  });
});

