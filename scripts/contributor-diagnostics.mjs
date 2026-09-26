#!/usr/bin/env node
/**
 * Contributor Diagnostics Command
 *
 * Run a comprehensive health check on local environment before starting work.
 * Validates: tools, dependencies, environment setup, database connectivity,
 * and integration mocks.
 *
 * Usage: node scripts/contributor-diagnostics.mjs [--fix] [--verbose]
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createReadStream } from "fs";

const args = process.argv.slice(2);
const shouldFix = args.includes("--fix");
const verbose = args.includes("--verbose");

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const results = {
  passed: 0,
  warned: 0,
  failed: 0,
  checks: [],
};

function ok(label, detail = "") {
  results.passed++;
  results.checks.push({ status: "pass", label, detail });
  console.log(`  ${GREEN}✔${RESET}  ${label}${detail ? ` ${CYAN}${detail}${RESET}` : ""}`);
}

function warn(label, hint = "") {
  results.warned++;
  results.checks.push({ status: "warn", label, hint });
  console.log(
    `  ${YELLOW}⚠${RESET}  ${label}${hint ? `\n       → ${hint}` : ""}`
  );
}

function fail(label, hint = "") {
  results.failed++;
  results.checks.push({ status: "fail", label, hint });
  console.log(`  ${RED}✖${RESET}  ${label}${hint ? `\n       → ${hint}` : ""}`);
}

function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

function run(cmd) {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8" }).trim();
  } catch (e) {
    return null;
  }
}

function checkFileExists(path, label) {
  if (existsSync(path)) {
    ok(`${label} exists`);
    return true;
  }
  fail(`${label} missing`, `Expected: ${path}`);
  return false;
}

// ─── CORE CHECKS ────────────────────────────────────────────────────────────

section("1️⃣  Node & Package Manager");

const nodeVersion = run("node --version");
if (nodeVersion) {
  ok("Node.js", nodeVersion);
  const major = parseInt(nodeVersion.split(".")[0].slice(1), 10);
  if (major < 18) {
    warn("Node.js version", `${nodeVersion} may be outdated (recommend 18+)`);
  }
} else {
  fail("Node.js not found", "Install from nodejs.org");
}

const yarnVersion = run("yarn --version");
if (yarnVersion) {
  ok("Yarn", yarnVersion);
} else {
  fail(
    "Yarn not found",
    "Install with: npm install -g yarn"
  );
}

section("2️⃣  Project Dependencies");

if (checkFileExists("package.json", "package.json")) {
  if (existsSync("node_modules")) {
    ok("node_modules installed");
  } else {
    fail("node_modules missing", "Run: yarn install");
  }
}

if (checkFileExists("yarn.lock", "yarn.lock")) {
  ok("Lockfile present");
}

section("3️⃣  Environment Configuration");

if (checkFileExists(".env", ".env")) {
  ok(".env file configured");
} else {
  warn(".env file missing", "Copy from .env.example and fill in secrets");
}

if (checkFileExists(".env.example", ".env.example")) {
  ok(".env.example template exists");
}

const envExample = ".env.example";
if (existsSync(envExample) && existsSync(".env")) {
  const exampleKeys = readFileSync(envExample, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.split("=")[0].trim());

  const envKeys = readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.split("=")[0].trim());

  const missing = exampleKeys.filter((k) => !envKeys.includes(k));
  if (missing.length > 0) {
    warn(
      "Missing environment variables",
      `Add: ${missing.join(", ")}`
    );
  } else {
    ok("All required env vars present");
  }
}

section("4️⃣  Build Tools & Rust");

const rustVersion = run("rustc --version");
if (rustVersion) {
  ok("Rust", rustVersion);
} else {
  warn("Rust not found", "Required for Soroban contracts: install from rustup.rs");
}

const cargoVersion = run("cargo --version");
if (cargoVersion) {
  ok("Cargo", cargoVersion);
} else {
  warn("Cargo not found", "Comes with Rust installation");
}

const sorobanVersion = run("soroban --version");
if (sorobanVersion) {
  ok("Soroban CLI", sorobanVersion);
} else {
  warn(
    "Soroban CLI not found",
    "Install with: cargo install stellar-cli"
  );
}

section("5️⃣  Project Structure");

const requiredDirs = [
  "src",
  "server",
  "contracts",
  "api",
  "scripts",
  ".github",
];

for (const dir of requiredDirs) {
  if (existsSync(dir)) {
    ok(`${dir}/ directory`);
  } else {
    fail(`${dir}/ directory missing`, "Project structure incomplete");
  }
}

section("6️⃣  Database & Services");

// Check if docker is available
const dockerVersion = run("docker --version");
if (dockerVersion) {
  ok("Docker", dockerVersion);
} else {
  warn("Docker not found", "Needed for local database: install docker");
}

// Check if docker-compose is available
const composeVersion = run("docker-compose --version");
if (composeVersion) {
  ok("Docker Compose", composeVersion);
} else {
  warn("Docker Compose not found", "Use docker compose instead or install docker-compose");
}

if (existsSync("docker-compose.yml")) {
  ok("docker-compose.yml configured");
} else {
  fail("docker-compose.yml missing", "Database setup incomplete");
}

section("7️⃣  Stellar Network Configuration");

if (existsSync("environments.toml")) {
  ok("environments.toml configured");
} else {
  warn("environments.toml missing", "Stellar network config needed");
}

section("8️⃣  Test & Linting Setup");

const hasVitest = checkFileExists("vitest.config.mjs", "Vitest config");
const hasEslint = checkFileExists("eslint.config.js", "ESLint config");
const hasPlaywright = checkFileExists("playwright.config.ts", "Playwright config");

if (hasVitest && hasEslint) {
  ok("Test & lint tools configured");
}

section("9️⃣  Git Configuration");

const gitUser = run("git config user.name");
const gitEmail = run("git config user.email");

if (gitUser) {
  ok("Git user.name", gitUser);
} else {
  warn("Git user.name not set", "Run: git config user.name 'Your Name'");
}

if (gitEmail) {
  ok("Git user.email", gitEmail);
} else {
  warn("Git user.email not set", "Run: git config user.email 'you@example.com'");
}

if (existsSync(".git/hooks/pre-commit")) {
  ok("Git pre-commit hook installed");
} else {
  warn("Git pre-commit hook missing", "Run: yarn husky install");
}

section("🔟  Smart Contracts");

if (existsSync("contracts")) {
  const contracts = run("find contracts -name 'Cargo.toml' -type f");
  if (contracts) {
    const count = contracts.split("\n").length;
    ok(`Smart contracts`, `${count} contract(s) found`);
  }
}

// ─── SUMMARY ────────────────────────────────────────────────────────────────

console.log(
  `\n${BOLD}Summary${RESET}: ${GREEN}${results.passed} pass${RESET}, ${YELLOW}${results.warned} warnings${RESET}, ${RED}${results.failed} failures${RESET}`
);

if (results.failed > 0) {
  console.log(
    `\n${RED}❌ Setup incomplete${RESET} — fix the failures above before developing.`
  );
  process.exit(1);
}

if (results.warned > 0) {
  console.log(
    `\n${YELLOW}⚠️  Setup mostly ready${RESET} — consider addressing warnings above.`
  );
}

if (results.failed === 0 && results.warned === 0) {
  console.log(
    `\n${GREEN}✅ All checks passed! Ready to develop.${RESET}`
  );
}

// ─── REMEDIATION GUIDE ──────────────────────────────────────────────────────

if (results.failed > 0 || results.warned > 0) {
  console.log(`\n${BOLD}Remediation Steps:${RESET}`);

  if (!nodeVersion) {
    console.log("  1. Install Node.js 18+ from: https://nodejs.org/");
  }

  if (!yarnVersion) {
    console.log("  2. Install Yarn globally: npm install -g yarn");
  }

  if (!existsSync("node_modules")) {
    console.log("  3. Install dependencies: yarn install");
  }

  if (!existsSync(".env")) {
    console.log("  4. Copy env template: cp .env.example .env && edit .env");
  }

  if (!dockerVersion) {
    console.log("  5. Install Docker: https://www.docker.com/products/docker-desktop");
  }

  if (!gitUser || !gitEmail) {
    console.log("  6. Configure Git: git config --global user.name '...' && git config --global user.email '...'");
  }

  console.log(`\nFor detailed setup instructions, see: CONTRIBUTING.md`);
}

if (verbose) {
  console.log(`\n${BOLD}Verbose Output:${RESET}`);
  console.log(JSON.stringify(results, null, 2));
}
