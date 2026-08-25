import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import { runMigrations, getMigrationFiles } from "../db/migrationRunner";
import connectDb from "../db/connectDb";

// Mock DB connection
vi.mock("../db/connectDb", () => ({
  default: vi.fn(),
}));

const tempMigrationsDir = path.join(__dirname, "temp_migrations_test");

describe("Database Migration Framework", () => {
  let mockCollection: any;
  let mockDb: any;
  let mockConnection: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockCollection = {
      createIndex: vi.fn().mockResolvedValue({}),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      insertOne: vi.fn().mockResolvedValue({}),
      deleteOne: vi.fn().mockResolvedValue({}),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1, upsertedCount: 1 }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      findOneAndUpdate: vi.fn((_query, update) =>
        Promise.resolve({ value: { token: update.$set.token } }),
      ),
    };

    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    };

    mockConnection = {
      db: mockDb,
    };

    vi.mocked(connectDb).mockResolvedValue(mockConnection as any);

    // Create a temp migrations directory with test migrations
    if (fs.existsSync(tempMigrationsDir)) {
      fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempMigrationsDir);

    // Write migration 001
    fs.writeFileSync(
      path.join(tempMigrationsDir, "001_test_migration.ts"),
      `
      export async function up(db: any) {
        await db.collection("test").updateMany({}, { $set: { v: 1 } });
      }
      export async function down(db: any) {
        await db.collection("test").updateMany({}, { $unset: { v: "" } });
      }
      `
    );

    // Write migration 002
    fs.writeFileSync(
      path.join(tempMigrationsDir, "002_another_migration.ts"),
      `
      export async function up(db: any) {
        await db.collection("test").updateMany({}, { $set: { x: 2 } });
      }
      export async function down(db: any) {
        await db.collection("test").updateMany({}, { $unset: { x: "" } });
      }
      `
    );
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempMigrationsDir)) {
      fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
    }
  });

  it("should discover and sort migrations by version prefix", async () => {
    const files = await getMigrationFiles(tempMigrationsDir);
    expect(files).toHaveLength(2);
    expect(files[0].version).toBe(1);
    expect(files[0].name).toBe("001_test_migration");
    expect(files[1].version).toBe(2);
    expect(files[1].name).toBe("002_another_migration");
  });

  it("should apply all pending migrations in order on a fresh database", async () => {
    // Fresh DB means find returns empty list (mocked by default)
    await runMigrations(tempMigrationsDir, "up");

    // Expect migrations index creation
    expect(mockCollection.createIndex).toHaveBeenCalledWith({ version: 1 }, { unique: true });
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "global" }),
      expect.objectContaining({ $set: expect.objectContaining({ direction: "up" }) }),
      expect.objectContaining({ upsert: true }),
    );

    // Expect migration application records to be inserted
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(2);
    expect(mockCollection.insertOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ version: 1, name: "001_test_migration" })
    );
    expect(mockCollection.insertOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ version: 2, name: "002_another_migration" })
    );

    // Verify migration functions were run against mock DB
    expect(mockCollection.updateMany).toHaveBeenCalledTimes(2);
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { version: 1, direction: "up" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "running" }),
      }),
      { upsert: true },
    );
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { version: 2, direction: "up" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "applied" }),
      }),
      { upsert: true },
    );
  });

  it("should only apply pending migrations on an existing database", async () => {
    // Version 1 is already applied, version 2 is pending
    mockCollection.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ version: 1, name: "001_test_migration" }]),
    });

    await runMigrations(tempMigrationsDir, "up");

    // Should only insert records for version 2
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(mockCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ version: 2, name: "002_another_migration" })
    );
  });

  it("should roll back migrations in reverse order", async () => {
    // Both migrations are already applied
    mockCollection.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { version: 1, name: "001_test_migration" },
        { version: 2, name: "002_another_migration" },
      ]),
    });

    await runMigrations(tempMigrationsDir, "down");

    // Should call deleteOne for both migrations before releasing the lease
    expect(mockCollection.deleteOne).toHaveBeenNthCalledWith(1, { version: 2 });
    expect(mockCollection.deleteOne).toHaveBeenNthCalledWith(2, { version: 1 });
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { version: 2, direction: "down" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "rolled_back" }),
      }),
      { upsert: true },
    );
  });

  it("should stop execution and throw error if a migration fails", async () => {
    // Write a failing migration
    fs.writeFileSync(
      path.join(tempMigrationsDir, "003_failing_migration.ts"),
      `
      export async function up(db: any) {
        throw new Error("Simulated migration failure");
      }
      export async function down(db: any) {
        // no-op
      }
      `
    );

    await expect(runMigrations(tempMigrationsDir, "up")).rejects.toThrow("Simulated migration failure");

    // Version 3 should NOT have been recorded as applied
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(2); // only version 1 and 2
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { version: 3, direction: "up" },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "failed",
          error: "Simulated migration failure",
        }),
      }),
      { upsert: true },
    );
  });

  it("should reject a concurrent worker when the lease is held", async () => {
    mockCollection.findOneAndUpdate = vi.fn().mockResolvedValue({
      value: { token: "other-worker" },
    });

    await expect(runMigrations(tempMigrationsDir, "up")).rejects.toThrow(
      "Another migration worker holds the lease",
    );
  });

  it("should report a dry-run plan without applying migrations or acquiring a lease", async () => {
    await runMigrations(tempMigrationsDir, "up", undefined, { dryRun: true });

    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(0);
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(0);
    expect(mockCollection.updateMany).toHaveBeenCalledTimes(0);
    expect(mockCollection.updateOne).toHaveBeenCalledTimes(0);
  });
});
