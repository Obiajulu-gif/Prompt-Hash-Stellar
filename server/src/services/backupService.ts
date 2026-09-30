/**
 * Automated Backup & Restore Service for Indexer DB (Issue #135 & #607)
 *
 * Exports the Prompt, Purchase, PromptVersion, IndexerState, and AuditLog collections
 * as NDJSON to S3-compatible storage or local disk along with SHA-256 checksums and a
 * manifest.json file.
 *
 * Restore path validates file integrity and SHA-256 checksums before touching or
 * overwriting live database collections, with built-in dry-run verification.
 *
 * Environment variables:
 *   BACKUP_S3_BUCKET        – Target S3 bucket name
 *   BACKUP_S3_PREFIX        – Key prefix, e.g. "backups/prompthash" (default: "backups")
 *   BACKUP_S3_REGION        – AWS region (default: "us-east-1")
 *   AWS_ACCESS_KEY_ID       – AWS credentials
 *   AWS_SECRET_ACCESS_KEY   – AWS credentials
 *   BACKUP_ALERT_WEBHOOK    – Optional URL to POST backup health alerts
 *   MONGODB_URI             – MongoDB connection string (required)
 */

import mongoose from "mongoose";
import { createGzip, createGunzip } from "zlib";
import { pipeline, Readable, PassThrough } from "stream";
import { promisify } from "util";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const pipelineAsync = promisify(pipeline);

// ---------------------------------------------------------------------------
// Lazy-load AWS SDK so the rest of the server doesn't fail without it
// ---------------------------------------------------------------------------

async function getS3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3" as string);
  return new S3Client({ region: process.env.BACKUP_S3_REGION ?? "us-east-1" });
}

async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3" as string);
  const client = await getS3Client();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) throw new Error("BACKUP_S3_BUCKET is not configured.");
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

async function downloadFromS3(key: string): Promise<Buffer> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3" as string);
  const client = await getS3Client();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) throw new Error("BACKUP_S3_BUCKET is not configured.");
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of (response.Body as any)) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Models & Interfaces
// ---------------------------------------------------------------------------

const backupRunSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["success", "failure"], required: true, index: true },
    s3Keys: [{ type: String }],
    totalDocuments: { type: Number, default: 0 },
    manifestSha256: { type: String, default: null },
    errorMessage: { type: String, default: null },
    durationMs: { type: Number, default: null },
  },
  { timestamps: true },
);

export const BackupRun =
  mongoose.models.BackupRun || mongoose.model("BackupRun", backupRunSchema);

export const BACKUP_COLLECTIONS = [
  "prompts",
  "purchases",
  "promptversions",
  "indexerstates",
  "auditlogs",
];

export interface BackupCollectionManifest {
  name: string;
  key: string;
  docCount: number;
  sha256: string;
  uncompressedBytes: number;
  compressedBytes: number;
}

export interface BackupManifest {
  version: "1.0.0";
  timestamp: string;
  prefix: string;
  totalDocuments: number;
  manifestSha256?: string;
  collections: Record<string, BackupCollectionManifest>;
}

// ---------------------------------------------------------------------------
// Core Export & Compression Helpers
// ---------------------------------------------------------------------------

async function exportCollectionToNdjson(collectionName: string): Promise<Buffer> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB not connected");
  const collection = db.collection(collectionName);
  const cursor = collection.find({});
  const lines: string[] = [];
  for await (const doc of cursor) {
    lines.push(JSON.stringify(doc));
  }
  return Buffer.from(lines.length > 0 ? lines.join("\n") + "\n" : "");
}

async function gzip(buf: Buffer): Promise<Buffer> {
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  const gz = createGzip();
  const readable = Readable.from([buf]);
  pass.on("data", (chunk: Buffer) => chunks.push(chunk));
  await pipelineAsync(readable, gz, pass);
  return Buffer.concat(chunks);
}

async function gunzip(buf: Buffer): Promise<Buffer> {
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  const gz = createGunzip();
  const readable = Readable.from([buf]);
  pass.on("data", (chunk: Buffer) => chunks.push(chunk));
  await pipelineAsync(readable, gz, pass);
  return Buffer.concat(chunks);
}

function computeSha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Main Backup Routine
// ---------------------------------------------------------------------------

export async function runBackup(options?: { localDir?: string }): Promise<BackupManifest> {
  const start = Date.now();
  const prefix = process.env.BACKUP_S3_PREFIX ?? "backups";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const s3Keys: string[] = [];
  let totalDocuments = 0;

  const manifest: BackupManifest = {
    version: "1.0.0",
    timestamp,
    prefix,
    totalDocuments: 0,
    collections: {},
  };

  try {
    for (const colName of BACKUP_COLLECTIONS) {
      const ndjson = await exportCollectionToNdjson(colName);
      const lines = ndjson.toString("utf8").split("\n").filter((l) => l.trim().length > 0);
      const docCount = lines.length;
      totalDocuments += docCount;

      const sha256 = computeSha256(ndjson);
      const compressed = await gzip(ndjson);
      const key = `${prefix}/${timestamp}/${colName}.ndjson.gz`;

      manifest.collections[colName] = {
        name: colName,
        key,
        docCount,
        sha256,
        uncompressedBytes: ndjson.length,
        compressedBytes: compressed.length,
      };

      if (options?.localDir) {
        const targetDir = path.join(options.localDir, timestamp);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, `${colName}.ndjson.gz`), compressed);
      } else {
        await uploadToS3(key, compressed, "application/gzip");
        s3Keys.push(key);
      }

      console.log(`[backup] Exported ${colName}: ${docCount} docs (SHA-256: ${sha256.slice(0, 12)}...)`);
    }

    manifest.totalDocuments = totalDocuments;
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    manifest.manifestSha256 = computeSha256(manifestBuffer);

    if (options?.localDir) {
      const targetDir = path.join(options.localDir, timestamp);
      fs.writeFileSync(path.join(targetDir, "manifest.json"), manifestBuffer);
    } else {
      const manifestKey = `${prefix}/${timestamp}/manifest.json`;
      await uploadToS3(manifestKey, manifestBuffer, "application/json");
      s3Keys.push(manifestKey);
    }

    await BackupRun.create({
      status: "success",
      s3Keys,
      totalDocuments,
      manifestSha256: manifest.manifestSha256,
      durationMs: Date.now() - start,
    });

    console.log(`[backup] Backup completed in ${Date.now() - start}ms (${totalDocuments} total docs)`);
    return manifest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[backup] Backup failed:", message);

    await BackupRun.create({
      status: "failure",
      s3Keys,
      totalDocuments,
      errorMessage: message,
      durationMs: Date.now() - start,
    }).catch(() => {});

    await alertOnFailure(message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Restore Routine with Integrity Check & Dry-Run (#607)
// ---------------------------------------------------------------------------

export interface RestoreOptions {
  timestamp?: string;
  prefix?: string;
  localDir?: string;
  dryRun?: boolean;
  confirm?: boolean;
  manifest?: BackupManifest;
  backupFiles?: Record<string, Buffer>; // colName -> compressed or raw buffer
}

export interface RestoreCollectionSummary {
  name: string;
  docCount: number;
  sha256Verified: boolean;
  jsonValid: boolean;
}

export interface RestoreResult {
  success: boolean;
  dryRun: boolean;
  timestamp: string;
  totalDocuments: number;
  collections: RestoreCollectionSummary[];
  message: string;
}

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const isDryRun = options.dryRun ?? false;

  // Live restore safety guard: prevent accidental database overwrite without explicit confirmation
  if (!isDryRun && !options.confirm) {
    throw new Error(
      "Restore safety guard: confirm option or --confirm flag is required for live restore to prevent accidental data overwrites.",
    );
  }

  const prefix = options.prefix ?? process.env.BACKUP_S3_PREFIX ?? "backups";
  let manifest: BackupManifest;

  // Step 1: Obtain manifest
  if (options.manifest) {
    manifest = options.manifest;
  } else if (options.localDir && options.timestamp) {
    const manifestPath = path.join(options.localDir, options.timestamp, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest file not found at ${manifestPath}`);
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } else if (options.timestamp) {
    const manifestKey = `${prefix}/${options.timestamp}/manifest.json`;
    const manifestBuf = await downloadFromS3(manifestKey);
    manifest = JSON.parse(manifestBuf.toString("utf8"));
  } else {
    throw new Error("Must provide timestamp, localDir, or manifest to restore.");
  }

  const collectionSummaries: RestoreCollectionSummary[] = [];
  const parsedDocsPerCollection: Record<string, any[]> = {};
  let totalDocuments = 0;

  // Step 2: Integrity verification (SHA-256 checksum + NDJSON syntax parsing) BEFORE touching live DB
  for (const colName of Object.keys(manifest.collections)) {
    const colMeta = manifest.collections[colName];
    let compressedBuf: Buffer;

    if (options.backupFiles && options.backupFiles[colName]) {
      compressedBuf = options.backupFiles[colName];
    } else if (options.localDir && options.timestamp) {
      const filePath = path.join(options.localDir, options.timestamp, `${colName}.ndjson.gz`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Backup file missing for collection '${colName}' at ${filePath}`);
      }
      compressedBuf = fs.readFileSync(filePath);
    } else if (options.timestamp) {
      compressedBuf = await downloadFromS3(colMeta.key);
    } else {
      throw new Error(`Unable to resolve backup file for collection '${colName}'`);
    }

    // Decompress if gzipped (magic bytes 0x1f 0x8b)
    let ndjsonBuf: Buffer;
    if (compressedBuf[0] === 0x1f && compressedBuf[1] === 0x8b) {
      ndjsonBuf = await gunzip(compressedBuf);
    } else {
      ndjsonBuf = compressedBuf;
    }

    // Integrity Check A: SHA-256 Checksum Comparison
    const computedSha = computeSha256(ndjsonBuf);
    if (computedSha !== colMeta.sha256) {
      throw new Error(
        `Backup integrity failure: SHA-256 checksum mismatch for collection '${colName}'. Expected ${colMeta.sha256}, got ${computedSha}. Aborting restore without modifying database.`,
      );
    }

    // Integrity Check B: NDJSON Line-by-Line JSON Parsing
    const lines = ndjsonBuf.toString("utf8").split("\n").filter((l) => l.trim().length > 0);
    const docs: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        docs.push(JSON.parse(lines[i]));
      } catch {
        throw new Error(
          `Backup integrity failure: Corrupted NDJSON syntax on line ${i + 1} of collection '${colName}'. Aborting restore without modifying database.`,
        );
      }
    }

    if (docs.length !== colMeta.docCount) {
      throw new Error(
        `Backup integrity failure: Document count mismatch for collection '${colName}'. Expected ${colMeta.docCount}, got ${docs.length}. Aborting restore without modifying database.`,
      );
    }

    totalDocuments += docs.length;
    parsedDocsPerCollection[colName] = docs;
    collectionSummaries.push({
      name: colName,
      docCount: docs.length,
      sha256Verified: true,
      jsonValid: true,
    });
  }

  // Step 3: Dry-run path — return summary without writing DB
  if (isDryRun) {
    return {
      success: true,
      dryRun: true,
      timestamp: manifest.timestamp,
      totalDocuments,
      collections: collectionSummaries,
      message: "Backup integrity verified successfully. Dry run completed without modifying database.",
    };
  }

  // Step 4: Live restore — drop & import into MongoDB
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB not connected for live restore");

  for (const colName of Object.keys(parsedDocsPerCollection)) {
    const docs = parsedDocsPerCollection[colName];
    const collection = db.collection(colName);

    // Drop existing documents
    await collection.deleteMany({});

    if (docs.length > 0) {
      await collection.insertMany(docs);
    }
    console.log(`[restore] Restored collection '${colName}': ${docs.length} docs`);
  }

  return {
    success: true,
    dryRun: false,
    timestamp: manifest.timestamp,
    totalDocuments,
    collections: collectionSummaries,
    message: "Backup restored successfully into MongoDB.",
  };
}

// ---------------------------------------------------------------------------
// Alert on failure
// ---------------------------------------------------------------------------

async function alertOnFailure(message: string): Promise<void> {
  const webhookUrl = process.env.BACKUP_ALERT_WEBHOOK;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[PromptHash] ⚠️ Backup FAILED: ${message}`,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    console.error("[backup] Failed to send failure alert to webhook");
  }
}

// ---------------------------------------------------------------------------
// Backup health check — called by /health endpoint
// ---------------------------------------------------------------------------

export interface BackupHealth {
  lastRun: Date | null;
  lastStatus: "success" | "failure" | "never";
  ageHours: number | null;
  healthy: boolean;
}

export async function getBackupHealth(): Promise<BackupHealth> {
  const last = await BackupRun.findOne().sort({ createdAt: -1 }).lean();
  if (!last) {
    return { lastRun: null, lastStatus: "never", ageHours: null, healthy: false };
  }
  const ageMs = Date.now() - new Date(last.createdAt).getTime();
  const ageHours = ageMs / 3_600_000;
  return {
    lastRun: last.createdAt,
    lastStatus: last.status,
    ageHours: Math.round(ageHours * 10) / 10,
    healthy: last.status === "success" && ageHours < 26,
  };
}
