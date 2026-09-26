import { describe, expect, it, vi } from "vitest";
import { down, up } from "../db/migrations/005_data_retention_controls";

describe("retention migration", () => {
  it("drops an existing processed-webhook TTL index", async () => {
    const dropIndex = vi.fn().mockResolvedValue(undefined);
    const collection = {
      listIndexes: () => ({
        toArray: async () => [
          { name: "_id_", key: { _id: 1 } },
          {
            name: "createdAt_1",
            key: { createdAt: 1 },
            expireAfterSeconds: 2592000,
          },
        ],
      }),
      dropIndex,
      createIndex: vi.fn().mockResolvedValue("retention_idx"),
    };
    const db = {
      collection: vi.fn().mockReturnValue(collection),
    };

    await up(db);

    expect(db.collection).toHaveBeenCalledWith("inboundwebhookevents");
    expect(dropIndex).toHaveBeenCalledWith("createdAt_1");
    expect(collection.createIndex).toHaveBeenCalledWith({
      processingStatus: 1,
      createdAt: 1,
      archivedAt: 1,
      retentionHold: 1,
    });
  });

  it("does not drop indexes when no TTL index exists", async () => {
    const dropIndex = vi.fn();
    const db = {
      collection: () => ({
        listIndexes: () => ({
          toArray: async () => [{ name: "_id_", key: { _id: 1 } }],
        }),
        dropIndex,
        createIndex: vi.fn().mockResolvedValue("retention_idx"),
      }),
    };

    await up(db);
    expect(dropIndex).not.toHaveBeenCalled();
  });

  it("does not restore an unsafe TTL index on rollback", async () => {
    await expect(down({ collection: vi.fn() })).resolves.toBeUndefined();
  });
});
