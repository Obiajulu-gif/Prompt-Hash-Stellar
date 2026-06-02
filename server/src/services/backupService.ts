/**
 * Automated Backup Service for Indexer DB (Issue #135)
 *
 * Exports the Prompt, Purchase, PromptVersion, and IndexerState collections
 * as NDJSON to S3-compatible storage, then records a BackupRun document so
 * operators can track backup health.
 *
 * Environment variables:
 *   BACKUP_S3_BUCKET        – Target S3 bucket name (required)
 *   BACKUP_S3_PREFIX        – Key prefix, e.g. "backups/prompthash" (default: "backups")
 *   BACKUP_S3_REGION        – AWS region (default: "us-east-1")
 *   AWS_ACCESS_KEY_ID       – AWS credentials (standard env)
 *   AWS_SECRET_ACCESS_KEY   – AWS credentials (standard env)
 *   BACKUP_ALERT_WEBHOOK    – Optional URL to POST backup health alerts
 *   MONGODB_URI             – MongoDB connection string (required)
 */

import mongoose from "mongoose";
import { createGzip } from "zlib";
import { pipeline, Readable, PassThrough } from "stream";
import { promisify } from "util";

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
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

// ---------------------------------------------------------------------------
// BackupRun model — tracks each backup attempt for health monitoring
// ---------------------------------------------------------------------------

const backupRunSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["success", "failure"], required: true, index: true },
    s3Keys: [{ type: String }],
    totalDocuments: { type: Number, default: 0 },
    errorMessage: { type: String, default: null },
    durationMs: { type: Number, default: null },
  },
  { timestamps: true },
);

export const BackupRun =
  mongoose.models.BackupRun || mongoose.model("BackupRun", backupRunSchema);

// ---------------------------------------------------------------------------
// Collection list to back up
// ---------------------------------------------------------------------------

const BACKUP_COLLECTIONS = ["prompts", "purchases", "promptversions", "indexerstates", "auditlogs"];

// ---------------------------------------------------------------------------
// Core export function
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
  return Buffer.from(lines.join("\n") + "\n");
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

// ---------------------------------------------------------------------------
// Main backup routine
// ---------------------------------------------------------------------------

export async function runBackup(): Promise<void> {
  const start = Date.now();
  const prefix = process.env.BACKUP_S3_PREFIX ?? "backups";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const s3Keys: string[] = [];
  let totalDocuments = 0;

  try {
    for (const colName of BACKUP_COLLECTIONS) {
      const ndjson = await exportCollectionToNdjson(colName);
      const docCount = ndjson.toString().split("\n").filter(Boolean).length;
      totalDocuments += docCount;

      const compressed = await gzip(ndjson);
      const key = `${prefix}/${timestamp}/${colName}.ndjson.gz`;
      await uploadToS3(key, compressed, "application/gzip");
      s3Keys.push(key);

      console.log(`[backup] Exported ${colName}: ${docCount} docs → s3://${process.env.BACKUP_S3_BUCKET}/${key}`);
    }

    await BackupRun.create({
      status: "success",
      s3Keys,
      totalDocuments,
      durationMs: Date.now() - start,
    });

    console.log(`[backup] Backup completed in ${Date.now() - start}ms (${totalDocuments} total docs)`);
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
    healthy: last.status === "success" && ageHours < 26, // alert if > 26 h since last success
  };
}
