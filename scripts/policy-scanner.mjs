#!/usr/bin/env node
/**
 * PromptHash Stellar — Production Code Policy Scanner
 *
 * Scans production codebase for prohibited mocks, stubs, seeded data, and testnet fallbacks.
 * Enforces strict production readiness rules before build and CI release.
 *
 * Run with: node scripts/policy-scanner.mjs [--check-production-build]
 * Or via:   yarn check:policy
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// Allowlist for test files, test fixtures, documentation, and tooling
const ALLOWED_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.test\.rs$/,
  /[/\\]tests?[/\\]/,
  /[/\\]src[/\\]test[/\\]/,
  /[/\\]docs[/\\]/,
  /[/\\]scripts[/\\]/,
  /[/\\]node_modules[/\\]/,
  /[/\\]target[/\\]/,
  /[/\\]\.git[/\\]/,
  /[/\\]dist[/\\]/,
  /[/\\]build[/\\]/,
];

function isAllowed(filePath) {
  const relPath = path.relative(ROOT_DIR, filePath);
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(relPath));
}

// Scanning Rules Definition
const RULES = [
  {
    id: "MOCK_PROMPT_HASH_CLIENT",
    name: "Mock PromptHashClient Detection",
    description: "Production code must not contain mock contract implementations or mock transaction hashes.",
    remediation: "Remove mock fallbacks from promptHashClient.ts. Inject test mocks strictly via test suites in src/test/ or tests/.",
    check: (content, filePath) => {
      if (filePath.endsWith("promptHashClient.ts")) {
        const violations = [];
        if (content.includes("WARNING: MOCK CONTRACT IMPLEMENTATION")) {
          violations.push("Contains warning header 'WARNING: MOCK CONTRACT IMPLEMENTATION'");
        }
        if (content.includes("⚠️ USING MOCK PromptHashClient")) {
          violations.push("Contains mock warning log '⚠️ USING MOCK PromptHashClient'");
        }
        if (content.includes("tx_mock") || content.includes("tx_bundle_mock") || content.includes("tx_pass_mock")) {
          violations.push("Contains hardcoded mock transaction hashes (tx_mock / tx_bundle_mock / tx_pass_mock)");
        }
        if (content.includes("mock_hash_")) {
          violations.push("Contains fake content hashes ('mock_hash_')");
        }
        return violations;
      }
      return [];
    },
  },
  {
    id: "SEEDED_REVIEWS",
    name: "Seeded Review Data Detection",
    description: "Production API endpoints must not contain in-memory seed data or mock review arrays.",
    remediation: "Remove seedMockReviews and process-local review storage from production API endpoints (api/reviews/list.ts and api/reviews/submit.ts). Use durable persistent storage.",
    check: (content, filePath) => {
      if (filePath.includes("api" + path.sep + "reviews") || filePath.includes("api/reviews")) {
        const violations = [];
        if (content.includes("seedMockReviews")) {
          violations.push("Found 'seedMockReviews' function in production review API");
        }
        if (content.includes("mockReviews")) {
          violations.push("Found 'mockReviews' hardcoded array in production review API");
        }
        return violations;
      }
      return [];
    },
  },
  {
    id: "PAGINATION_STUB",
    name: "Rust Pagination Stub Detection",
    description: "Production Rust smart contracts must not contain placeholder catalog pagination functions.",
    remediation: "Implement full cursor-based pagination in contracts/prompt-hash/src/pagination.rs instead of a placeholder stub.",
    check: (content, filePath) => {
      if (filePath.endsWith("pagination.rs")) {
        const violations = [];
        if (content.includes("Implementation placeholder") || content.includes("pub fn paginate_catalog() {\n    // Implementation placeholder")) {
          violations.push("Found placeholder stub 'pub fn paginate_catalog()'");
        }
        return violations;
      }
      return [];
    },
  },
  {
    id: "TTL_STUB",
    name: "Rust TTL Policy Stub Detection",
    description: "Production Rust smart contracts must not contain placeholder TTL policy functions.",
    remediation: "Implement explicit TTL extension and restoration policy in contracts/prompt-hash/src/ttl_policy.rs instead of a placeholder stub.",
    check: (content, filePath) => {
      if (filePath.endsWith("ttl_policy.rs")) {
        const violations = [];
        if (content.includes("Implementation placeholder") || content.includes("pub fn apply_ttl_policy() {\n    // Implementation placeholder")) {
          violations.push("Found placeholder stub 'pub fn apply_ttl_policy()'");
        }
        return violations;
      }
      return [];
    },
  },
  {
    id: "OUTBOX_STUB",
    name: "Server Outbox Stub Detection",
    description: "Production server services must not contain empty webhook outbox stubs.",
    remediation: "Implement durable signed webhook outbox event delivery in server/src/services/webhookOutbox.ts instead of a placeholder stub.",
    check: (content, filePath) => {
      if (filePath.endsWith("webhookOutbox.ts")) {
        const violations = [];
        if (content.includes("Implementation placeholder")) {
          violations.push("Found placeholder stub in WebhookOutbox implementation");
        }
        return violations;
      }
      return [];
    },
  },
  {
    id: "SILENT_TESTNET_FALLBACK",
    name: "Silent Production Testnet Fallback Detection",
    description: "Production environment validation must fail when chain-critical configuration is missing instead of defaulting to testnet.",
    remediation: "In src/lib/env.ts, throw explicit validation errors during production builds if PUBLIC_STELLAR_NETWORK, PUBLIC_STELLAR_RPC_URL, or PUBLIC_PROMPT_HASH_CONTRACT_ID are missing or set to testnet fallbacks.",
    check: (content, filePath) => {
      if (filePath.endsWith("src" + path.sep + "lib" + path.sep + "env.ts") || filePath.endsWith("src/lib/env.ts")) {
        const violations = [];
        if (content.includes('import.meta.env.PUBLIC_STELLAR_NETWORK ?? fallback.PUBLIC_STELLAR_NETWORK') && !content.includes('isProduction')) {
          violations.push("Environment validator unconditionally falls back to TESTNET defaults without validating production mode");
        }
        return violations;
      }
      return [];
    },
  },
];

function getAllFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!isAllowed(filePath)) {
        getAllFiles(filePath, fileList);
      }
    } else {
      if (!isAllowed(filePath)) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

function runScanner() {
  console.log(`${BOLD}${CYAN}PromptHash Stellar — Production Policy Scanner${RESET}\n`);

  const targetDirs = [
    path.join(ROOT_DIR, "src"),
    path.join(ROOT_DIR, "api"),
    path.join(ROOT_DIR, "server"),
    path.join(ROOT_DIR, "contracts"),
  ];

  let filesToScan = [];
  for (const dir of targetDirs) {
    getAllFiles(dir, filesToScan);
  }

  console.log(`Scanning ${filesToScan.length} production files across src, api, server, and contracts...\n`);

  let totalViolations = 0;
  const results = [];

  for (const filePath of filesToScan) {
    const relPath = path.relative(ROOT_DIR, filePath);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    for (const rule of RULES) {
      const violations = rule.check(content, filePath);
      if (violations.length > 0) {
        totalViolations += violations.length;
        results.push({
          file: relPath,
          ruleId: rule.id,
          ruleName: rule.name,
          violations,
          remediation: rule.remediation,
        });
      }
    }
  }

  if (results.length > 0) {
    console.log(`${RED}${BOLD}✖ Production Policy Violations Found (${totalViolations} total):${RESET}\n`);
    for (const res of results) {
      console.log(`${RED}● File:${RESET} ${BOLD}${res.file}${RESET}`);
      console.log(`  ${YELLOW}Rule:${RESET} [${res.ruleId}] ${res.ruleName}`);
      for (const v of res.violations) {
        console.log(`  ${RED}Violation:${RESET} ${v}`);
      }
      console.log(`  ${GREEN}Remediation:${RESET} ${res.remediation}\n`);
    }
    console.log(`${RED}${BOLD}Production build scan failed.${RESET} Fix all violations above before shipping.\n`);
    process.exit(1);
  } else {
    console.log(`${GREEN}${BOLD}✔ Policy Scan Passed:${RESET} No prohibited mocks, stubs, seeded data, or silent testnet fallbacks detected in production code.\n`);
  }
}

// Execution
runScanner();
