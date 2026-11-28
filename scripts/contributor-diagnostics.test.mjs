import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applySafeFixes,
  checkAuthorization,
  checkNetwork,
  formatReport,
  runDiagnostics,
  summarize,
} from "./contributor-diagnostics.mjs";

test("the CLI explains usage and rejects mistyped options before running checks", () => {
  const cli = new URL("./contributor-diagnostics.mjs", import.meta.url);
  const run = (flag) => spawnSync(process.execPath, [fileURLToPath(cli), flag], { encoding: "utf8" });
  assert.match(run("--help").stdout, /Usage.*--offline/);
  assert.match(run("--help").stdout, /--retries/);
  const typo = run("--offine");
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /Unknown option/);
});

test("safe fix does not overwrite a file created concurrently and can be retried", () => {
  const exists = (path) => path.endsWith(".env.example");
  const deniedCopy = (_from, _to, flags) => {
    assert.equal(flags, constants.COPYFILE_EXCL);
    throw Object.assign(new Error("already exists"), { code: "EEXIST" });
  };
  assert.deepEqual(applySafeFixes(".", { exists, copy: deniedCopy }), []);
  assert.equal(applySafeFixes(".", { exists, copy() {} }).length, 1);
});

test("normal path: formatReport formats passed and skipped results without em dashes", () => {
  const checks = [
    { id: "tool.node", group: "tooling", status: "pass", label: "node 22.0.0" },
    { id: "seed.fixtures", group: "seed", status: "pass", label: "fixtures present" },
    { id: "net.rpc", group: "network", status: "skip", label: "Soroban RPC (offline)" },
  ];
  const summary = summarize(checks);
  assert.equal(summary.ok, true);
  const report = formatReport({ checks, summary }, { verbose: true });
  assert.match(report, /Diagnostics OK\./);
  assert.equal(report.includes("\u2014"), false);
});

test("failure path: strict mode treats warnings as failures", () => {
  const checks = [
    { id: "tool.node", group: "tooling", status: "pass", label: "node 22.0.0" },
    { id: "net.horizon", group: "network", status: "warn", label: "Horizon unreachable", fix: "Check URL" },
  ];
  const relaxed = summarize(checks, { strict: false });
  assert.equal(relaxed.ok, true);
  const strict = summarize(checks, { strict: true });
  assert.equal(strict.ok, false);
});

test("authorization path: detects private key leakage in public environment variables", () => {
  const cleanEnv = {
    PUBLIC_STELLAR_NETWORK: "TESTNET",
    UNLOCK_PRIVATE_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  };
  const cleanChecks = checkAuthorization(cleanEnv);
  assert.equal(cleanChecks.some((c) => c.id === "auth.private_key_leak" && c.status === "pass"), true);

  const leakedEnv = {
    PUBLIC_UNLOCK_PRIVATE_KEY: "secret_leak_123",
  };
  const leakedChecks = checkAuthorization(leakedEnv);
  assert.equal(leakedChecks.some((c) => c.id === "auth.private_key_leak" && c.status === "fail"), true);
});

test("authorization path: validates key encoding format and operator privilege boundaries", () => {
  const invalidKeyEnv = {
    UNLOCK_PRIVATE_KEY: "too_short",
  };
  const badKeyChecks = checkAuthorization(invalidKeyEnv);
  assert.equal(badKeyChecks.some((c) => c.id.startsWith("auth.secret_format") && c.status === "fail"), true);

  const validKeyEnv = {
    UNLOCK_PRIVATE_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
  const goodKeyChecks = checkAuthorization(validKeyEnv);
  assert.equal(goodKeyChecks.some((c) => c.id.startsWith("auth.secret_format") && c.status === "pass"), true);
});

test("retry path: retries transient network probe failures up to configured count", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    if (attempts < 2) {
      throw new Error("Temporary network timeout");
    }
    return {
      ok: true,
      json: async () => ({ result: { status: "healthy" } }),
    };
  };

  const env = {
    PUBLIC_STELLAR_NETWORK: "TESTNET",
    PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  };

  const results = await checkNetwork(env, {
    fetchImpl: mockFetch,
    offline: false,
    retries: 2,
  });

  assert.equal(attempts >= 2, true);
  const rpcCheck = results.find((r) => r.id === "net.rpc");
  assert.equal(rpcCheck.status, "pass");
});
