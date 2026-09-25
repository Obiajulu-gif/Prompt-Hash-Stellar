#!/usr/bin/env node
/**
 * PromptHash Stellar — Automated Contract TTL Renewal Sweep Script (#685)
 *
 * Loops over `renew_critical_keys(cursor)` until all critical contract
 * persistent storage entries (Prompts, Purchases, Disputes) are extended
 * to their maximum operational TTLs.
 *
 * Usage:
 *   node scripts/renew-critical-keys.mjs [--network testnet] [--contract-id C...] [--admin admin]
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  const prefixMatch = args.find((a) => a.startsWith(`${flag}=`));
  if (prefixMatch) {
    return prefixMatch.split("=")[1];
  }
  return null;
}

function loadEnvFile(path) {
  const vars = {};
  if (!existsSync(path)) return vars;
  const lines = readFileSync(path, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    vars[k] = v;
  }
  return vars;
}

const envVars = {
  ...loadEnvFile(resolve(REPO_ROOT, ".env")),
  ...loadEnvFile(resolve(REPO_ROOT, ".env.local")),
};

const network =
  getArgValue("--network") ||
  process.env.NETWORK ||
  envVars.PUBLIC_STELLAR_NETWORK?.toLowerCase() ||
  "testnet";

const contractId =
  getArgValue("--contract-id") ||
  process.env.CONTRACT_ID ||
  envVars.PUBLIC_PROMPT_HASH_CONTRACT_ID ||
  "";

const adminAlias =
  getArgValue("--admin") ||
  process.env.ADMIN_ALIAS ||
  "admin";

console.log(`${BOLD}======================================================${RESET}`);
console.log(`${BOLD} PromptHash Contract TTL Renewal Sweep Tool (#685)${RESET}`);
console.log(`${BOLD}======================================================${RESET}`);
console.log(`🌐 Network:     ${CYAN}${network}${RESET}`);
console.log(`📄 Contract ID: ${contractId ? CYAN + contractId + RESET : RED + "MISSING" + RESET}`);
console.log(`🔑 Admin Alias: ${CYAN}${adminAlias}${RESET}\n`);

if (!contractId || contractId.startsWith("CXXXXXXXX")) {
  console.error(`${RED}❌ Error: Valid CONTRACT_ID is required to perform renewal sweep.${RESET}`);
  process.exit(1);
}

if (isDryRun) {
  console.log(`🔍 [DRY-RUN] Simulating TTL renewal sweep against contract ${contractId}...`);
  console.log(`✅ [DRY-RUN] Renewal sweep simulation completed successfully.`);
  process.exit(0);
}

let cursor = null;
let totalRenewed = 0;
let batchCount = 0;

console.log(`🚀 Starting cursor-based TTL renewal sweep...`);

try {
  while (true) {
    batchCount++;
    const cursorArg = cursor !== null ? `--cursor ${cursor}` : "";
    console.log(`  ▶ Invoking batch #${batchCount} (cursor=${cursor ?? "null"})...`);

    const command = `stellar contract invoke --id ${contractId} --source ${adminAlias} --network ${network} -- renew_critical_keys ${cursorArg}`;
    const output = execSync(command, { encoding: "utf-8", timeout: 60000 }).trim();

    let renewed = 0;
    let nextCursor = null;

    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        renewed = parsed[0] || 0;
        nextCursor = parsed[1] ?? null;
      }
    } catch {
      // Parse tuple format (u32, Option<u64>)
      const match = output.match(/\((\d+),\s*(Some\((\d+)\)|None|null)\)/);
      if (match) {
        renewed = parseInt(match[1], 10);
        nextCursor = match[2].startsWith("Some") ? match[3] : null;
      }
    }

    totalRenewed += renewed;
    console.log(`    ${GREEN}✔${RESET} Batch #${batchCount} extended ${BOLD}${renewed}${RESET} keys. (next_cursor=${nextCursor ?? "None"})`);

    if (nextCursor === null || nextCursor === undefined) {
      break;
    }
    cursor = nextCursor;
  }

  console.log(`\n${GREEN}🎉 Renewal sweep complete!${RESET}`);
  console.log(`   Total batches: ${BOLD}${batchCount}${RESET}`);
  console.log(`   Total keys renewed: ${BOLD}${totalRenewed}${RESET}\n`);
  process.exit(0);
} catch (err) {
  console.error(`\n${RED}❌ Renewal sweep failed: ${err.message}${RESET}`);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
}
