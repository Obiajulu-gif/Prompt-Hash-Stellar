#!/usr/bin/env node
/**
 * PromptHash Stellar — local setup validation script
 *
 * Run with:  node scripts/check-local-setup.mjs
 * Or via:    yarn check:setup
 *
 * Checks Node, Yarn, Rust, Stellar CLI, and required environment variables
 * without printing secret values.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// ─── helpers ────────────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

let passed = 0;
let warned = 0;
let failed = 0;

function ok(label, detail = "") {
  passed++;
  console.log(`  ${GREEN}✔${RESET}  ${label}${detail ? `  ${CYAN}(${detail})${RESET}` : ""}`);
}

function warn(label, hint = "") {
  warned++;
  console.log(`  ${YELLOW}⚠${RESET}  ${label}${hint ? `\n       ${YELLOW}→ ${hint}${RESET}` : ""}`);
}

function fail(label, hint = "") {
  failed++;
  console.log(`  ${RED}✖${RESET}  ${label}${hint ? `\n       ${RED}→ ${hint}${RESET}` : ""}`);
}

function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

function run(cmd) {
  try {
    return execSync(cmd, { stdio: "pipe" }).toString().trim();
  } catch {
    return null;
  }
}

function parseVersion(raw) {
  const match = raw && raw.match(/(\d+)\.(\d+)\.?(\d*)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3] || "0", 10),
    raw: match[0],
  };
}

// ─── 1. Node.js ─────────────────────────────────────────────────────────────

section("1. Node.js");

const nodeRaw = run("node --version");
const nodeVer = parseVersion(nodeRaw);
if (!nodeVer) {
  fail("node not found", "Install Node.js 22+ from https://nodejs.org");
} else if (nodeVer.major < 22) {
  fail(
    `node ${nodeVer.raw} is too old (need 22+)`,
    "Upgrade via nvm: nvm install 22 && nvm use 22",
  );
} else {
  ok(`node ${nodeVer.raw}`);
}

// ─── 2. Yarn ────────────────────────────────────────────────────────────────

section("2. Yarn");

const yarnRaw = run("yarn --version");
const yarnVer = parseVersion(yarnRaw);
if (!yarnVer) {
  fail("yarn not found", "Enable Corepack: corepack enable && corepack prepare yarn@stable --activate");
} else if (yarnVer.major < 4) {
  warn(
    `yarn ${yarnVer.raw} detected (project uses Yarn 4+)`,
    "Run: corepack enable && corepack prepare yarn@4.9.2 --activate",
  );
} else {
  ok(`yarn ${yarnVer.raw}`);
}

// ─── 3. Rust toolchain ──────────────────────────────────────────────────────

section("3. Rust toolchain");

const rustcRaw = run("rustc --version");
const cargoRaw = run("cargo --version");

if (!rustcRaw) {
  fail("rustc not found", "Install Rust: https://rustup.rs");
} else {
  ok(rustcRaw);
}

if (!cargoRaw) {
  fail("cargo not found", "Install Rust: https://rustup.rs");
} else {
  ok(cargoRaw);
}

// Check wasm32 target
const wasmTarget = run("rustup target list --installed");
if (wasmTarget && wasmTarget.includes("wasm32-unknown-unknown")) {
  ok("wasm32-unknown-unknown target installed");
} else {
  warn(
    "wasm32-unknown-unknown target not found",
    "Run: rustup target add wasm32-unknown-unknown",
  );
}

// ─── 4. Stellar CLI ─────────────────────────────────────────────────────────

section("4. Stellar CLI");

const stellarRaw = run("stellar --version");
if (!stellarRaw) {
  warn(
    "stellar CLI not found",
    "Install: cargo install --locked stellar-cli --features opt\n       See: https://developers.stellar.org/docs/tools/developer-tools/cli/install-stellar-cli",
  );
} else {
  ok(stellarRaw);
}

// ─── 5. Frontend dependencies ───────────────────────────────────────────────

section("5. Frontend dependencies");

if (existsSync("node_modules")) {
  ok("node_modules present");
} else {
  fail("node_modules not found", "Run: yarn install");
}

// ─── 6. Server dependencies ─────────────────────────────────────────────────

section("6. Server dependencies");

if (existsSync("server/node_modules")) {
  ok("server/node_modules present");
} else {
  warn(
    "server/node_modules not found",
    "Run: cd server && npm install",
  );
}

// ─── 7. Environment variables ───────────────────────────────────────────────

section("7. Environment variables");

// Load .env if present (simple key=value parser, no external deps)
const envPath = resolve(".env");
const envExamplePath = resolve(".env.example");

const envValues = {};
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    envValues[key] = val;
  }
  ok(".env file found");
} else {
  warn(
    ".env file not found",
    "Run: cp .env.example .env  then fill in the required values",
  );
}

// Required frontend variables
const requiredFrontend = [
  "PUBLIC_STELLAR_NETWORK",
  "PUBLIC_STELLAR_NETWORK_PASSPHRASE",
  "PUBLIC_STELLAR_RPC_URL",
  "PUBLIC_STELLAR_HORIZON_URL",
  "PUBLIC_PROMPT_HASH_CONTRACT_ID",
  "PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID",
  "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
  "PUBLIC_UNLOCK_PUBLIC_KEY",
];

// Required backend/serverless variables
const requiredBackend = [
  "CHALLENGE_TOKEN_SECRET",
  "UNLOCK_PUBLIC_KEY",
  "UNLOCK_PRIVATE_KEY",
];

// Placeholder values that indicate the variable has not been filled in
const PLACEHOLDER_PATTERNS = [
  /^replace-with/i,
  /^BASE64_/i,
  /^[CG]X{10,}/,   // CXXX... or GXXX... contract/account placeholders
  /^your-/i,
  /^<.*>$/,
];

function isPlaceholder(val) {
  if (!val) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(val));
}

function checkVar(key, required) {
  const val = envValues[key] ?? process.env[key];
  if (!val) {
    if (required) {
      fail(`${key} is not set`, "Add it to your .env file (see .env.example)");
    } else {
      warn(`${key} is not set`, "Optional — set if needed");
    }
    return;
  }
  if (isPlaceholder(val)) {
    if (required) {
      fail(`${key} still has a placeholder value`, "Replace the placeholder in .env with a real value");
    } else {
      warn(`${key} still has a placeholder value`, "Replace when ready");
    }
    return;
  }
  // Never print the actual value — just confirm it is set
  ok(`${key} is set`);
}

console.log("\n  Frontend variables:");
for (const key of requiredFrontend) {
  checkVar(key, true);
}

console.log("\n  Backend / serverless variables:");
for (const key of requiredBackend) {
  checkVar(key, true);
}

// Optional
console.log("\n  Optional variables:");
checkVar("REDIS_URL", false);
checkVar("PUBLIC_CHAT_API_BASE", false);
checkVar("CHALLENGE_TOKEN_SECRET_PREVIOUS", false);

// ─── 8. Summary ─────────────────────────────────────────────────────────────

section("Summary");

const total = passed + warned + failed;
console.log(
  `  ${GREEN}${passed} passed${RESET}  ${YELLOW}${warned} warnings${RESET}  ${RED}${failed} failed${RESET}  (${total} checks)\n`,
);

if (failed > 0) {
  console.log(
    `${RED}${BOLD}Setup is incomplete.${RESET} Fix the items marked ✖ above before running the project.\n`,
  );
  process.exit(1);
} else if (warned > 0) {
  console.log(
    `${YELLOW}${BOLD}Setup looks mostly ready.${RESET} Review the warnings above for optional improvements.\n`,
  );
} else {
  console.log(
    `${GREEN}${BOLD}All checks passed. You are ready to develop PromptHash Stellar!${RESET}\n`,
  );
  console.log("  Next steps:");
  console.log("    yarn dev              — start the frontend");
  console.log("    yarn test:frontend    — run frontend tests");
  console.log("    cargo test -p prompt-hash  — run contract tests\n");
}
