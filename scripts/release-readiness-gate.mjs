#!/usr/bin/env node

/**
 * Release readiness gate (Issue #1002).
 *
 * Blocks a high-risk release when migration, security, smoke-test or rollback
 * evidence is missing — not just when a job failed. A job that was skipped
 * while its path was touched counts as missing.
 *
 * Inputs (env, as set by .github/workflows/release-readiness.yml):
 *   PR_BODY, HIGH_RISK, HAS_MIGRATION, HAS_CONTRACT_CHANGE,
 *   CHECKLIST_RESULT, MIGRATION_RESULT, CONTRACT_RESULT, READINESS_RESULT
 *
 * Local use:
 *   PR_BODY="$(cat body.md)" HIGH_RISK=true CHECKLIST_RESULT=success READINESS_RESULT=success node scripts/release-readiness-gate.mjs
 *
 * A checklist item may be skipped only through the PR template's Exception
 * block: an "Incident ticket:" value plus the item's key in "Skipped items:".
 */

import process from "node:process";
import { fileURLToPath } from "node:url";

/** key → checklist text fragment that must appear as a ticked box. */
export const REQUIRED_EVIDENCE = {
  smoke: "Smoke verification passes",
  security: "Security checks pass",
  "rollback-plan": "Rollback plan described",
  "rollback-rehearsal": "Rollback rehearsed",
};

export const MIGRATION_EVIDENCE = {
  "migration-dry-run": "Schema migration dry-run passes",
  "migration-reversible": "No irreversible data transforms",
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTicked(body, fragment) {
  return new RegExp(`^\\s*[-*]\\s*\\[[xX]\\]\\s*${escapeRegExp(fragment)}`, "m").test(body);
}

/** Strip HTML comments so template placeholders never count as values. */
function fieldValue(body, label) {
  const line = body.replace(/<!--[\s\S]*?-->/g, "").match(new RegExp(`^${label}:(.*)$`, "m"));
  return line ? line[1].trim() : "";
}

export function parseException(body) {
  const ticket = fieldValue(body, "Incident ticket");
  const skipped = fieldValue(body, "Skipped items")
    .split(/[,\s]+/)
    .filter(Boolean);
  return { ticket, skipped: ticket ? skipped : [] };
}

/**
 * @returns {{ ok: boolean, failures: string[], waived: string[] }}
 */
export function evaluateReleaseGate(input) {
  const failures = [];
  const waived = [];
  // Fail closed: if path detection itself broke we cannot know the risk level.
  if (input.detectResult && input.detectResult !== "success") {
    return { ok: false, failures: [`High-risk detection job ${input.detectResult}.`], waived };
  }
  if (!input.highRisk) return { ok: true, failures, waived };

  const body = input.prBody ?? "";
  const exception = parseException(body);

  const jobOk = (name, result, required) => {
    if (result === "failure" || result === "cancelled") failures.push(`${name} job ${result}.`);
    else if (required && result !== "success") failures.push(`${name} job did not run (result: ${result || "missing"}).`);
  };
  jobOk("Checklist", input.jobs?.checklist, true);
  jobOk("Migration dry-run", input.jobs?.migration, input.hasMigration);
  jobOk("Contract upgrade preflight", input.jobs?.contract, input.hasContractChange);
  // Runs on every PR (scripts/release-readiness.mjs --self-test, #1047).
  jobOk("Readiness self-test", input.jobs?.readiness, true);

  const required = { ...REQUIRED_EVIDENCE, ...(input.hasMigration ? MIGRATION_EVIDENCE : {}) };
  for (const [key, fragment] of Object.entries(required)) {
    if (isTicked(body, fragment)) continue;
    if (exception.skipped.includes(key)) waived.push(key);
    else failures.push(`Missing evidence: "${fragment}" (${key}) is not checked.`);
  }

  return { ok: failures.length === 0, failures, waived };
}

function main() {
  const env = process.env;
  const result = evaluateReleaseGate({
    prBody: env.PR_BODY,
    detectResult: env.DETECT_RESULT,
    highRisk: env.HIGH_RISK === "true",
    hasMigration: env.HAS_MIGRATION === "true",
    hasContractChange: env.HAS_CONTRACT_CHANGE === "true",
    jobs: {
      checklist: env.CHECKLIST_RESULT,
      migration: env.MIGRATION_RESULT,
      contract: env.CONTRACT_RESULT,
      readiness: env.READINESS_RESULT,
    },
  });

  if (result.ok && env.HIGH_RISK !== "true") {
    console.log("✅ Not a high-risk change. Release readiness gate passed.");
    return 0;
  }
  for (const key of result.waived) console.log(`⚠️  Waived by exception: ${key}`);
  if (result.ok) {
    console.log("✅ Release readiness gate passed.");
    return 0;
  }
  for (const f of result.failures) console.log(`❌ ${f}`);
  console.log("\nFix the items above before merging. See docs/RELEASE_READINESS_CHECKLIST.md.");
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
