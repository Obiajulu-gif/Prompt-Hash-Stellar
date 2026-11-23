import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatTable,
  inspectDeadLetters,
  safeRetryDeadLetters,
  sanitizePayload,
  validateAuthorization,
} from "./dead-letter-tool.mjs";

test("CLI explains usage and options", () => {
  const cli = new URL("./dead-letter-tool.mjs", import.meta.url);
  const run = (flag) => spawnSync(process.execPath, [fileURLToPath(cli), flag], { encoding: "utf8" });
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Dead-letter inspection and safe retry tooling/);
  assert.match(help.stdout, /--dry-run/);
  assert.match(help.stdout, /--batch-size/);

  const unknown = run("unknown_cmd");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command/);
});

test("payload sanitization redacts sensitive authentication fields", () => {
  const raw = {
    userId: "usr_123",
    authHeader: "Bearer token_abc123",
    secretKey: "super_secret_val",
    details: {
      nestedToken: "tok_nested",
      action: "retry_payment",
    },
  };
  const clean = sanitizePayload(raw);
  assert.equal(clean.userId, "usr_123");
  assert.equal(clean.authHeader, "[REDACTED]");
  assert.equal(clean.secretKey, "[REDACTED]");
  assert.equal(clean.details.nestedToken, "[REDACTED]");
  assert.equal(clean.details.action, "retry_payment");
});

test("authorization path: enforces operator privileges and rejects unauthorized actors", () => {
  const opAuth = validateAuthorization("ops_user");
  assert.equal(opAuth.authorized, true);
  assert.equal(opAuth.role, "operator");

  const guestAuth = validateAuthorization("guest");
  assert.equal(guestAuth.authorized, false);
  assert.match(guestAuth.reason, /lacks operator privileges/);

  const emptyAuth = validateAuthorization("");
  assert.equal(emptyAuth.authorized, false);
  assert.match(emptyAuth.reason, /Actor identifier is required/);
});

test("inspection normal path: retrieves and formats dead-letter records", async () => {
  const mockAdapter = {
    listDeadLetters: async ({ queue, limit }) => [
      {
        id: "job-101",
        queue: "jobs",
        target: "settlement_poll",
        attempts: 5,
        lastError: "Connection timeout to RPC",
        deadLetteredAt: "2026-11-21T18:00:00Z",
        payload: { txHash: "0x123", token: "tok_secret" },
      },
      {
        id: "webhook-202",
        queue: "webhooks",
        target: "sub-alpha",
        attempts: 8,
        lastError: "HTTP 500 receiver failure",
        deadLetteredAt: "2026-11-21T19:00:00Z",
      },
    ],
  };

  const records = await inspectDeadLetters({ adapter: mockAdapter, actor: "ops_team" });
  assert.equal(records.length, 2);
  assert.equal(records[0].id, "webhook-202");
  assert.equal(records[1].id, "job-101");
  assert.equal(records[1].payload.token, "[REDACTED]");

  const table = formatTable(records);
  assert.match(table, /webhook-202/);
  assert.match(table, /job-101/);
  assert.equal(table.includes("\u2014"), false);
});

test("safe retry dry-run: previews affected items without executing mutations", async () => {
  let mutated = false;
  const mockAdapter = {
    listDeadLetters: async () => [
      { id: "dl-1", queue: "jobs", target: "mailer", lastError: "SMTP drop" },
      { id: "dl-2", queue: "jobs", target: "indexer", lastError: "Ledger missing" },
    ],
    retryDeadLetter: async () => {
      mutated = true;
    },
  };

  const dryResult = await safeRetryDeadLetters({
    all: true,
    dryRun: true,
    adapter: mockAdapter,
    actor: "ops_admin",
  });

  assert.equal(dryResult.dryRun, true);
  assert.equal(dryResult.plannedCount, 2);
  assert.equal(mutated, false);
  assert.match(dryResult.message, /Dry-run: 2 record\(s\) would be safely re-queued/);
});

test("safe retry execution path: executes throttled retries and tracks successes and failures", async () => {
  const retried = [];
  const mockAdapter = {
    listDeadLetters: async () => [
      { id: "dl-ok-1", queue: "webhooks", target: "sub-1" },
      { id: "dl-fail-2", queue: "webhooks", target: "sub-2" },
    ],
    retryDeadLetter: async (id) => {
      if (id === "dl-fail-2") throw new Error("Subscription inactive");
      retried.push(id);
    },
  };

  const result = await safeRetryDeadLetters({
    all: true,
    dryRun: false,
    batchSize: 5,
    delayMs: 10,
    adapter: mockAdapter,
    actor: "ops_admin",
  });

  assert.equal(result.totalAttempted, 2);
  assert.equal(result.retriedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.retriedIds, ["dl-ok-1"]);
  assert.equal(result.failedItems[0].id, "dl-fail-2");
  assert.equal(result.success, false);
});

test("failure path: throws descriptive error when neither item IDs nor --all is specified", async () => {
  await assert.rejects(
    async () => {
      await safeRetryDeadLetters({
        all: false,
        ids: [],
        actor: "ops_admin",
      });
    },
    { message: /Must specify at least one item ID via --id or set --all/ }
  );
});
