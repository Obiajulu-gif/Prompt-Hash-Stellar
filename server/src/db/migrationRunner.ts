import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import connectDb from "./connectDb";

export interface MigrationFile {
  version: number;
  name: string;
  filePath: string;
  up: (db: mongoose.mongo.Db) => Promise<void>;
  down: (db: mongoose.mongo.Db) => Promise<void>;
}

export interface MigrationRunOptions {
  dryRun?: boolean;
}

const defaultMigrationsDir = path.join(__dirname, "migrations");
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/**
 * Dynamic discovery and loading of migrations from the migrations directory.
 */
export async function getMigrationFiles(migrationsDir: string = defaultMigrationsDir): Promise<MigrationFile[]> {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = fs.readdirSync(migrationsDir);
  const migrationFiles: MigrationFile[] = [];

  for (const file of files) {
    const match = file.match(/^(\d+)_[a-zA-Z0-9_-]+\.(ts|js)$/);
    if (!match) continue;
    if (file.endsWith(".d.ts") || file.endsWith(".test.ts") || file.endsWith(".test.js")) continue;

    const version = parseInt(match[1], 10);
    const filePath = path.join(migrationsDir, file);

    const migrationModule = require(filePath);

    if (typeof migrationModule.up !== "function" || typeof migrationModule.down !== "function") {
      throw new Error(`Migration ${file} must export "up" and "down" functions`);
    }

    migrationFiles.push({
      version,
      name: file.replace(/\.(ts|js)$/, ""),
      filePath,
      up: migrationModule.up,
      down: migrationModule.down,
    });
  }

  return migrationFiles.sort((a, b) => a.version - b.version);
}

/**
 * Runs migration sequence either up or down.
 */
export async function runMigrations(
  migrationsDir: string = defaultMigrationsDir,
  direction: "up" | "down" = "up",
  targetVersion?: number,
  options: MigrationRunOptions = {},
): Promise<void> {
  const conn = await connectDb();
  const db = conn.db;
  if (!db) {
    throw new Error("[migration] Database connection not established");
  }

  const migrationCollection = db.collection("migrations");
  const migrationFiles = await getMigrationFiles(migrationsDir);
  const appliedMigrations = (await migrationCollection.find().toArray()) as Array<{ version: number }>;
  const appliedVersions = new Set<number>(appliedMigrations.map((migration) => migration.version));

  console.log(`[migration] Found ${migrationFiles.length} migration files.`);
  console.log(`[migration] Applied versions in DB: ${Array.from(appliedVersions).sort((a, b) => a - b).join(", ") || "none"}`);

  if (options.dryRun) {
    const plan = selectMigrationPlan(migrationFiles, appliedVersions, direction, targetVersion);
    console.log(`[migration] DRY RUN: ${plan.length} ${direction === "up" ? "pending" : "rollback"} migration(s).`);
    for (const migration of plan) {
      console.log(`[migration] DRY RUN: ${direction.toUpperCase()} ${migration.version} - ${migration.name}`);
    }
    return;
  }

  const checkpointCollection = db.collection("migration_checkpoints");
  await migrationCollection.createIndex({ version: 1 }, { unique: true });
  await checkpointCollection.createIndex({ version: 1, direction: 1 }, { unique: true });
  const lease = await acquireMigrationLease(db, direction);

  try {
    if (direction === "up") {
      // Forward migrations: only those not yet applied
      const pending = selectMigrationPlan(migrationFiles, appliedVersions, direction, targetVersion);
      if (pending.length === 0) {
        console.log("[migration] Database is up-to-date. No pending migrations.");
        return;
      }

      for (const migration of pending) {
        console.log(`[migration] UP: Applying version ${migration.version} - ${migration.name}...`);
        try {
          await recordCheckpoint(checkpointCollection, migration, direction, "running", lease.token);
          await migration.up(db);
          await migrationCollection.insertOne({
            version: migration.version,
            name: migration.name,
            appliedAt: new Date(),
            schemaVersion: migration.version,
            leaseToken: lease.token,
          });
          await recordCheckpoint(checkpointCollection, migration, direction, "applied", lease.token);
          console.log(`[migration] UP: Successfully applied version ${migration.version}`);
        } catch (err) {
          await recordCheckpoint(checkpointCollection, migration, direction, "failed", lease.token, err);
          console.error(`[migration] UP: Error applying version ${migration.version}:`, err);
          throw err; // Stop deployment on failure
        }
      }
    } else {
      // Rollback migrations: those already applied, executed in descending order
      const toRollback = selectMigrationPlan(migrationFiles, appliedVersions, direction, targetVersion);
      if (toRollback.length === 0) {
        console.log("[migration] No applied migrations to roll back.");
        return;
      }

      for (const migration of toRollback) {
        console.log(`[migration] DOWN: Rolling back version ${migration.version} - ${migration.name}...`);
        try {
          await recordCheckpoint(checkpointCollection, migration, direction, "running", lease.token);
          await migration.down(db);
          await migrationCollection.deleteOne({ version: migration.version });
          await recordCheckpoint(checkpointCollection, migration, direction, "rolled_back", lease.token);
          console.log(`[migration] DOWN: Successfully rolled back version ${migration.version}`);
        } catch (err) {
          await recordCheckpoint(checkpointCollection, migration, direction, "failed", lease.token, err);
          console.error(`[migration] DOWN: Error rolling back version ${migration.version}:`, err);
          throw err;
        }
      }
    }
  } finally {
    await releaseMigrationLease(db, lease.token);
  }
}

function selectMigrationPlan(
  migrationFiles: MigrationFile[],
  appliedVersions: Set<number>,
  direction: "up" | "down",
  targetVersion?: number,
): MigrationFile[] {
  if (direction === "up") {
    return migrationFiles.filter(
      (migration) =>
        !appliedVersions.has(migration.version) &&
        (targetVersion === undefined || migration.version <= targetVersion),
    );
  }

  return migrationFiles
    .filter(
      (migration) =>
        appliedVersions.has(migration.version) &&
        (targetVersion === undefined || migration.version > targetVersion),
    )
    .reverse();
}

async function acquireMigrationLease(
  db: mongoose.mongo.Db,
  direction: "up" | "down",
  leaseMs = DEFAULT_LEASE_MS,
): Promise<{ token: string }> {
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMs);
  const leases = db.collection("migration_leases");
  await leases.createIndex({ name: 1 }, { unique: true });
  let result: unknown;
  try {
    result = await leases.findOneAndUpdate(
      {
        name: "global",
        $or: [{ expiresAt: { $lte: now } }, { token: { $exists: false } }],
      },
      {
        $set: {
          name: "global",
          token,
          direction,
          acquiredAt: now,
          expiresAt,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === 11000) {
      throw new Error("[migration] Another migration worker holds the lease");
    }
    throw err;
  }

  const acquiredToken = getAcquiredLeaseToken(result);
  if (acquiredToken !== token) {
    throw new Error("[migration] Another migration worker holds the lease");
  }
  return { token };
}

function getAcquiredLeaseToken(
  result: unknown,
): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  if ("value" in result) {
    const value = result.value;
    if (value && typeof value === "object" && "token" in value) {
      return typeof value.token === "string" ? value.token : undefined;
    }
    return undefined;
  }
  if ("token" in result) {
    return typeof result.token === "string" ? result.token : undefined;
  }
  return undefined;
}

async function releaseMigrationLease(db: mongoose.mongo.Db, token: string): Promise<void> {
  await db.collection("migration_leases").deleteOne({ name: "global", token });
}

async function recordCheckpoint(
  collection: mongoose.mongo.Collection,
  migration: MigrationFile,
  direction: "up" | "down",
  status: "running" | "applied" | "rolled_back" | "failed",
  leaseToken: string,
  error?: unknown,
): Promise<void> {
  await collection.updateOne(
    { version: migration.version, direction },
    {
      $set: {
        version: migration.version,
        name: migration.name,
        direction,
        status,
        leaseToken,
        updatedAt: new Date(),
        error: error instanceof Error ? error.message : error ? String(error) : null,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}
