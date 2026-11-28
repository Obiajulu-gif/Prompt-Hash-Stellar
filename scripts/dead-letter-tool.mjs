#!/usr/bin/env node
/**
 * Dead-letter inspection and safe retry tooling.
 *
 * Provides inspection, filtering, dry-run simulation, and throttled safe retry
 * for dead-lettered background jobs and webhook outbox events.
 *
 * Usage:
 *   node scripts/dead-letter-tool.mjs list [--queue=jobs|webhooks|all] [--limit=<n>] [--json]
 *   node scripts/dead-letter-tool.mjs retry [--id=<id>] [--all] [--queue=jobs|webhooks] [--dry-run] [--batch-size=<n>] [--actor=<name>]
 *   node scripts/dead-letter-tool.mjs --help
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_DELAY_MS = 50;
export const MAX_BATCH_SIZE = 100;

const SENSITIVE_KEYS = [/secret/i, /token/i, /password/i, /private/i, /key/i, /auth/i];

export function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload.map(sanitizePayload);
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.some((re) => re.test(k))) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object") {
      out[k] = sanitizePayload(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function validateAuthorization(actor, { secret = "", requiredRole = "operator" } = {}) {
  const adminSecret = process.env.DLQ_ADMIN_TOKEN || process.env.ADMIN_SECRET || "";
  if (adminSecret && secret && secret === adminSecret) {
    return { authorized: true, role: "admin", actor: actor || "admin_secret" };
  }
  if (!actor || typeof actor !== "string" || actor.trim().length === 0) {
    return { authorized: false, reason: "Actor identifier is required for dead-letter operations" };
  }
  const normalized = actor.trim();
  const deniedRoles = ["guest", "anonymous", "viewer", "unauthorized"];
  if (deniedRoles.includes(normalized.toLowerCase())) {
    return { authorized: false, reason: `Actor "${normalized}" lacks ${requiredRole} privileges` };
  }
  return { authorized: true, role: requiredRole, actor: normalized };
}

export async function inspectDeadLetters({
  queue = "all",
  limit = 50,
  since = null,
  adapter = null,
  actor = "operator",
} = {}) {
  const auth = validateAuthorization(actor, { requiredRole: "viewer" });
  if (!auth.authorized) {
    throw new Error(`Authorization failed: ${auth.reason}`);
  }

  const effectiveLimit = Math.max(1, Math.min(limit, 500));
  const sinceDate = since ? new Date(since) : null;
  const records = [];

  if (adapter) {
    const raw = await adapter.listDeadLetters({ queue, limit: effectiveLimit, since: sinceDate });
    for (const r of raw) {
      records.push({
        id: String(r.id || r._id),
        queue: r.queue || (r.subscriptionId ? "webhooks" : "jobs"),
        target: r.target || r.handler || r.subscriptionId || "unknown",
        attempts: r.attempts || r.retryCount || 0,
        lastError: r.lastError || r.failureReason || "Unknown failure",
        deadLetteredAt: r.deadLetteredAt || r.updatedAt || new Date().toISOString(),
        payload: sanitizePayload(r.payload || {}),
      });
    }
  }

  records.sort((a, b) => new Date(b.deadLetteredAt).getTime() - new Date(a.deadLetteredAt).getTime());
  return records.slice(0, effectiveLimit);
}

export async function safeRetryDeadLetters({
  queue = "all",
  ids = [],
  all = false,
  dryRun = false,
  batchSize = DEFAULT_BATCH_SIZE,
  delayMs = DEFAULT_DELAY_MS,
  adapter = null,
  actor = "",
  adminSecret = "",
} = {}) {
  const auth = validateAuthorization(actor, { secret: adminSecret, requiredRole: "operator" });
  if (!auth.authorized) {
    throw new Error(`Authorization failed: ${auth.reason}`);
  }

  if (!all && (!ids || ids.length === 0)) {
    throw new Error("Must specify at least one item ID via --id or set --all to retry dead-letter records");
  }

  const effectiveBatchSize = Math.max(1, Math.min(batchSize, MAX_BATCH_SIZE));
  const effectiveDelay = Math.max(0, delayMs);

  const targets = await inspectDeadLetters({ queue, limit: 500, adapter, actor });
  const toProcess = all ? targets : targets.filter((t) => ids.includes(t.id));

  if (dryRun) {
    return {
      dryRun: true,
      actor: auth.actor,
      plannedCount: toProcess.length,
      batchSize: effectiveBatchSize,
      delayMs: effectiveDelay,
      items: toProcess.map((t) => ({ id: t.id, queue: t.queue, target: t.target, lastError: t.lastError })),
      message: `Dry-run: ${toProcess.length} record(s) would be safely re-queued in batches of ${effectiveBatchSize}`,
    };
  }

  const retried = [];
  const failed = [];

  for (let i = 0; i < toProcess.length; i += effectiveBatchSize) {
    const batch = toProcess.slice(i, i + effectiveBatchSize);
    for (const item of batch) {
      try {
        if (adapter && typeof adapter.retryDeadLetter === "function") {
          await adapter.retryDeadLetter(item.id, { queue: item.queue, actor: auth.actor });
        }
        retried.push(item.id);
      } catch (err) {
        failed.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (i + effectiveBatchSize < toProcess.length && effectiveDelay > 0) {
      await new Promise((r) => setTimeout(r, effectiveDelay));
    }
  }

  return {
    dryRun: false,
    actor: auth.actor,
    totalAttempted: toProcess.length,
    retriedCount: retried.length,
    failedCount: failed.length,
    retriedIds: retried,
    failedItems: failed,
    success: failed.length === 0,
    message: `${retried.length} record(s) safely re-queued for processing`,
  };
}

export function formatTable(records) {
  if (!records || records.length === 0) {
    return "No dead-letter records found.";
  }
  const lines = [
    `ID                   QUEUE      ATTEMPTS  TARGET                  ERROR`,
    `------------------------------------------------------------------------------------------------`,
  ];
  for (const r of records) {
    const id = String(r.id).padEnd(20).slice(0, 20);
    const q = String(r.queue).padEnd(10).slice(0, 10);
    const att = String(r.attempts).padEnd(10).slice(0, 10);
    const target = String(r.target).padEnd(23).slice(0, 23);
    const err = String(r.lastError).slice(0, 35);
    lines.push(`${id} ${q} ${att} ${target} ${err}`);
  }
  return lines.join("\n");
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  if (command === "--help" || command === "-h" || command === "help") {
    console.log(`Dead-letter inspection and safe retry tooling

Usage:
  node scripts/dead-letter-tool.mjs list [--queue=jobs|webhooks|all] [--limit=<n>] [--json]
  node scripts/dead-letter-tool.mjs retry [--id=<id>] [--all] [--queue=jobs|webhooks] [--dry-run] [--batch-size=<n>] [--actor=<name>]
  node scripts/dead-letter-tool.mjs --help

Options:
  --queue=<name>       Filter by queue: jobs, webhooks, or all (default: all)
  --limit=<n>          Maximum items to inspect (default: 50, max: 500)
  --id=<id>            Specific dead-letter record ID to retry
  --all                Retry all eligible dead-letter records
  --dry-run            Preview retry actions without modifying records
  --batch-size=<n>     Throttle retry batches (default: 10, max: 100)
  --delay-ms=<n>       Delay in milliseconds between batches (default: 50)
  --actor=<name>       Operator identity executing the retry
  --json               Output machine-readable JSON`);
    process.exit(0);
  }

  const getArg = (prefix, fallback = null) => {
    const found = args.find((a) => a.startsWith(`${prefix}=`));
    return found ? found.slice(prefix.length + 1) : fallback;
  };
  const hasFlag = (flag) => args.includes(flag);

  const queue = getArg("--queue", "all");
  const limit = parseInt(getArg("--limit", "50"), 10) || 50;
  const isJson = hasFlag("--json");
  const dryRun = hasFlag("--dry-run");
  const all = hasFlag("--all");
  const id = getArg("--id", null);
  const actor = getArg("--actor", process.env.USER || "operator");
  const batchSize = parseInt(getArg("--batch-size", "10"), 10) || DEFAULT_BATCH_SIZE;
  const delayMs = parseInt(getArg("--delay-ms", "50"), 10) || DEFAULT_DELAY_MS;

  if (command === "list") {
    inspectDeadLetters({ queue, limit, actor })
      .then((records) => {
        if (isJson) {
          console.log(JSON.stringify({ queue, count: records.length, records }, null, 2));
        } else {
          console.log(formatTable(records));
        }
        process.exit(0);
      })
      .catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
  } else if (command === "retry") {
    const ids = id ? [id] : [];
    safeRetryDeadLetters({ queue, ids, all, dryRun, batchSize, delayMs, actor })
      .then((res) => {
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(res.message);
          if (res.dryRun && res.items) {
            console.log(`Affected records (${res.items.length}):`);
            for (const item of res.items) {
              console.log(`  - [${item.queue}] ${item.id}: ${item.target} (${item.lastError})`);
            }
          }
        }
        process.exit(res.success !== false ? 0 : 1);
      })
      .catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
  } else {
    console.error(`Unknown command: ${command}. Run with --help for usage.`);
    process.exit(2);
  }
}
