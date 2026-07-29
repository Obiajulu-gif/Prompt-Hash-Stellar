import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import connectDb from "./connectDb";

export interface MigrationFile {
  version: number;
  name: string;
  filePath: string;
  up: (db: mongoose.mongo.Db) => Promise<void>;
  down: (db: mongoose.mongo.Db) => Promise<void>;
}

const defaultMigrationsDir = path.join(__dirname, "migrations");

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
  targetVersion?: number
): Promise<void> {
  const conn = await connectDb();
  const db = conn.db;
  if (!db) {
    throw new Error("[migration] Database connection not established");
  }

  const migrationCollection = db.collection("migrations");
  await migrationCollection.createIndex({ version: 1 }, { unique: true });

  const migrationFiles = await getMigrationFiles(migrationsDir);
  const appliedMigrations = await migrationCollection.find().toArray();
  const appliedVersions = new Set(appliedMigrations.map((m) => m.version));

  console.log(`[migration] Found ${migrationFiles.length} migration files.`);
  console.log(`[migration] Applied versions in DB: ${Array.from(appliedVersions).sort((a, b) => a - b).join(", ") || "none"}`);

  if (direction === "up") {
    // Forward migrations: only those not yet applied
    const pending = migrationFiles.filter((m) => !appliedVersions.has(m.version));
    if (pending.length === 0) {
      console.log("[migration] Database is up-to-date. No pending migrations.");
      return;
    }

    for (const migration of pending) {
      if (targetVersion !== undefined && migration.version > targetVersion) {
        break;
      }

      console.log(`[migration] UP: Applying version ${migration.version} - ${migration.name}...`);
      try {
        await migration.up(db);
        await migrationCollection.insertOne({
          version: migration.version,
          name: migration.name,
          appliedAt: new Date(),
        });
        console.log(`[migration] UP: Successfully applied version ${migration.version}`);
      } catch (err) {
        console.error(`[migration] UP: Error applying version ${migration.version}:`, err);
        throw err; // Stop deployment on failure
      }
    }
  } else {
    // Rollback migrations: those already applied, executed in descending order
    const toRollback = migrationFiles
      .filter((m) => appliedVersions.has(m.version))
      .reverse();

    if (toRollback.length === 0) {
      console.log("[migration] No applied migrations to roll back.");
      return;
    }

    for (const migration of toRollback) {
      if (targetVersion !== undefined && migration.version <= targetVersion) {
        break;
      }

      console.log(`[migration] DOWN: Rolling back version ${migration.version} - ${migration.name}...`);
      try {
        await migration.down(db);
        await migrationCollection.deleteOne({ version: migration.version });
        console.log(`[migration] DOWN: Successfully rolled back version ${migration.version}`);
      } catch (err) {
        console.error(`[migration] DOWN: Error rolling back version ${migration.version}:`, err);
        throw err;
      }
    }
  }
}
