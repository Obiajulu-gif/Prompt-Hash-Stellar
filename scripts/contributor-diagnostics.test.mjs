import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applySafeFixes } from "./contributor-diagnostics.mjs";


test("the CLI explains usage and rejects mistyped options before running checks", () => {
  const cli = new URL("./contributor-diagnostics.mjs", import.meta.url);
  const run = (flag) => spawnSync(process.execPath, [fileURLToPath(cli), flag], { encoding: "utf8" });
  assert.match(run("--help").stdout, /Usage.*--offline/);
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