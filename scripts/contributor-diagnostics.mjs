#!/usr/bin/env node
/**
 * Contributor diagnostics - one command that verifies a local checkout.
 *
 * Checks tooling, dependencies, env config (including cross-variable
 * consistency), seed/fixture data, authorization configuration, and the
 * external services the app assumes (Soroban RPC, Horizon, optional
 * MongoDB/Redis/chat gateway). Every non-pass result carries a concrete fix.
 * Secret values are never printed.
 *
 * Usage:
 *   node scripts/contributor-diagnostics.mjs [--offline] [--json] [--strict] [--fix] [--verbose] [--retries=<n>]
 *   yarn diagnose
 *
 *   --offline    skip every network probe (checks are reported as "skip")
 *   --json       machine-readable report on stdout
 *   --strict     treat warnings as failures (useful in CI)
 *   --fix        apply SAFE fixes only: create .env from .env.example if missing
 *   --retries=n  number of retry attempts for transient network probes (default: 1)
 *
 * Exit code: 0 = no failures, 1 = at least one failure (or warning with --strict).
 * See docs/operations/contributor-diagnostics.md for failure modes and recovery.
 */

import { execSync } from "node:child_process";
import { constants, copyFileSync, existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_NODE_MAJOR = 22;
const NETWORK_TIMEOUT_MS = 5000;

export const NETWORK_PASSPHRASES = {
  TESTNET: "Test SDF Network ; September 2015",
  PUBLIC: "Public Global Stellar Network ; September 2015",
  FUTURENET: "Test SDF Future Network ; October 2022",
  LOCAL: "Standalone Network ; February 2017",
};

export const REQUIRED_ENV = [
  "STELLAR_SCAFFOLD_ENV",
  "PUBLIC_STELLAR_NETWORK",
  "PUBLIC_STELLAR_NETWORK_PASSPHRASE",
  "PUBLIC_STELLAR_RPC_URL",
  "PUBLIC_STELLAR_HORIZON_URL",
  "PUBLIC_PROMPT_HASH_CONTRACT_ID",
  "PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID",
  "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
  "PUBLIC_UNLOCK_PUBLIC_KEY",
  "CHALLENGE_TOKEN_SECRET",
  "UNLOCK_PUBLIC_KEY",
  "UNLOCK_PRIVATE_KEY",
];

/** Secrets that must not keep the value shipped in .env.example. */
const SECRET_ENV = [
  "CHALLENGE_TOKEN_SECRET",
  "UNLOCK_PUBLIC_KEY",
  "UNLOCK_PRIVATE_KEY",
  "RECEIPT_SIGNING_PUBLIC_KEY",
  "RECEIPT_SIGNING_PRIVATE_KEY",
];

const PLACEHOLDER = [/^replace-with/i, /^BASE64_/i, /^[CG]X{10,}/, /^[CG]A{55}$/, /^your[-_]/i, /_here$/i, /^<.*>$/];
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ID = /^G[A-Z2-7]{55}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Remediation catalog: check id -> what to run / change. */
export const FIXES = {
  "tool.node": `Install Node ${MIN_NODE_MAJOR}+ (nvm install ${MIN_NODE_MAJOR} && nvm use ${MIN_NODE_MAJOR}).`,
  "tool.yarn": "corepack enable && corepack prepare yarn@4.9.2 --activate",
  "tool.rust": "Install Rust via https://rustup.rs (toolchain is pinned by rust-toolchain.toml).",
  "tool.wasm": "rustup target add wasm32-unknown-unknown",
  "tool.stellar": "cargo install --locked stellar-cli --features opt",
  "tool.git": "git config --global user.name '<name>' && git config --global user.email '<email>'",
  "deps.node_modules": "yarn install",
  "deps.server": "cd server && npm install",
  "deps.lockfile": "Run yarn install to regenerate yarn.lock; commit it with package.json changes.",
  "env.file": "cp .env.example .env  (or re-run with --fix), then fill in real values.",
  "env.template": "Restore .env.example from git: git checkout -- .env.example",
  "env.missing": "Add the missing keys to .env (see .env.example and docs/environments.md).",
  "env.placeholder": "Replace the placeholder with a real value (deploy the contract: ./scripts/deploy.sh).",
  "env.format": "Fix the value format; see docs/environments.md for the expected shape.",
  "env.secret_default": "Generate unique secrets; never reuse .env.example values outside local dev (docs/secret-rotation.md).",
  "env.network_passphrase": "Set PUBLIC_STELLAR_NETWORK_PASSPHRASE to the passphrase matching PUBLIC_STELLAR_NETWORK (see .env.example).",
  "env.url_network": "Point RPC/Horizon URLs at the same network as PUBLIC_STELLAR_NETWORK; do not mix testnet and mainnet endpoints.",
  "env.unlock_keys": "PUBLIC_UNLOCK_PUBLIC_KEY (frontend) and UNLOCK_PUBLIC_KEY (serverless) must be the same key.",
  "env.scaffold_env": "Use STELLAR_SCAFFOLD_ENV=production only with PUBLIC network; development/staging/testing otherwise.",
  "env.quorum": "PUBLIC_STELLAR_ENTITLEMENT_QUORUM must be an integer between 1 and the number of PUBLIC_STELLAR_RPC_URLS.",
  "seed.fixtures": "Restore the file from git (git checkout -- <path>); deterministic tests depend on it.",
  "seed.script": "Restore server/scripts/seedPreview.mjs; it must keep its production guardrail.",
  "seed.env_guard": "Seeding is refused when APP_ENV/VERCEL_ENV/NODE_ENV is production. Unset it for preview seeding.",
  "auth.private_key_leak": "Remove private keys from PUBLIC_* and VITE_* environment variables to prevent leaking them to the frontend.",
  "auth.secret_format": "Ensure private keys are valid base64-encoded strings with at least 32 bytes or 64 hex characters.",
  "auth.operator_boundary": "Ensure operator credentials are appropriately configured for the execution environment.",
  "net.rpc": "Check connectivity/VPN, status.stellar.org, or switch PUBLIC_STELLAR_RPC_URL to another provider.",
  "net.rpc_network": "RPC reports a different network than PUBLIC_STELLAR_NETWORK_PASSPHRASE; fix the URL or the passphrase.",
  "net.horizon": "Check connectivity or switch PUBLIC_STELLAR_HORIZON_URL; Horizon outages degrade balances only.",
  "net.horizon_network": "Horizon reports a different network than PUBLIC_STELLAR_NETWORK_PASSPHRASE; fix the URL or the passphrase.",
  "net.mongo": "docker compose up -d mongo  (or fix MONGODB_URI in server/.env).",
  "net.redis": "Start Redis or unset REDIS_URL; rate limiting falls back to in-memory.",
  "net.chat": "Optional gateway is unreachable; chat features degrade. Unset PUBLIC_CHAT_API_BASE to silence.",
};

// ─── pure helpers ────────────────────────────────────────────────────────────

export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export function parseVersion(raw) {
  const m = raw && String(raw).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? { major: +m[1], minor: +m[2], patch: +(m[3] ?? 0), raw: m[0] } : null;
}

export function normalizeNetwork(value) {
  const n = String(value ?? "").trim().toUpperCase();
  // The frontend (src/lib/env.ts) treats STANDALONE as a deprecated alias of LOCAL.
  // MAINNET is deliberately NOT an alias: the frontend schema rejects it.
  return n === "STANDALONE" ? "LOCAL" : n;
}

/** Classify an endpoint URL by the network its hostname implies, or null if unknown. */
export function classifyUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return "LOCAL";
  if (host.includes("futurenet")) return "FUTURENET";
  if (host.includes("testnet")) return "TESTNET";
  if (host.includes("mainnet") || host === "horizon.stellar.org") return "PUBLIC";
  return null;
}

function isPlaceholder(v) {
  return !v || PLACEHOLDER.some((re) => re.test(v));
}

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function result(id, group, status, label, detail = "") {
  const r = { id, group, status, label };
  if (detail) r.detail = detail;
  if (status === "warn" || status === "fail") {
    const fix = FIXES[id.split(":")[0]];
    if (fix) r.fix = fix;
  }
  return r;
}

// ─── check groups (all I/O injected) ─────────────────────────────────────────

export function checkTooling(run) {
  const g = "tooling";
  const out = [];

  const node = parseVersion(run("node --version"));
  if (!node) out.push(result("tool.node", g, "fail", "node not found"));
  else if (node.major < MIN_NODE_MAJOR)
    out.push(result("tool.node", g, "fail", `node ${node.raw} is too old (need ${MIN_NODE_MAJOR}+)`));
  else out.push(result("tool.node", g, "pass", `node ${node.raw}`));

  const yarn = parseVersion(run("yarn --version"));
  if (!yarn) out.push(result("tool.yarn", g, "fail", "yarn not found"));
  else if (yarn.major < 4) out.push(result("tool.yarn", g, "warn", `yarn ${yarn.raw} (project uses Yarn 4+)`));
  else out.push(result("tool.yarn", g, "pass", `yarn ${yarn.raw}`));

  const rustc = run("rustc --version");
  const cargo = run("cargo --version");
  out.push(
    rustc && cargo
      ? result("tool.rust", g, "pass", rustc)
      : result("tool.rust", g, "warn", "rustc/cargo not found (needed only for contract work)"),
  );

  const targets = run("rustup target list --installed");
  out.push(
    targets && targets.includes("wasm32-unknown-unknown")
      ? result("tool.wasm", g, "pass", "wasm32-unknown-unknown target installed")
      : result("tool.wasm", g, "warn", "wasm32-unknown-unknown target missing (needed to build contracts)"),
  );

  const stellar = run("stellar --version") ?? run("soroban --version");
  out.push(
    stellar
      ? result("tool.stellar", g, "pass", stellar.split("\n")[0])
      : result("tool.stellar", g, "warn", "stellar CLI not found (needed to deploy contracts)"),
  );

  const name = run("git config user.name");
  const email = run("git config user.email");
  out.push(
    name && email
      ? result("tool.git", g, "pass", "git user.name/user.email configured")
      : result("tool.git", g, "warn", "git identity not configured"),
  );
  return out;
}

export function checkDependencies(root, exists = existsSync) {
  const g = "dependencies";
  const p = (f) => resolve(root, f);
  const out = [];
  out.push(
    exists(p("node_modules"))
      ? result("deps.node_modules", g, "pass", "node_modules present")
      : result("deps.node_modules", g, "fail", "node_modules missing"),
  );
  out.push(
    exists(p("server/node_modules"))
      ? result("deps.server", g, "pass", "server/node_modules present")
      : result("deps.server", g, "warn", "server/node_modules missing (only needed for the MongoDB API)"),
  );
  out.push(
    exists(p("yarn.lock"))
      ? result("deps.lockfile", g, "pass", "yarn.lock present")
      : result("deps.lockfile", g, "fail", "yarn.lock missing"),
  );
  return out;
}

/**
 * @param {Record<string,string|undefined>} env  merged view (.env file over process.env)
 * @param {{ example?: Record<string,string>, envFilePresent?: boolean, templatePresent?: boolean }} ctx
 */
export function checkEnvironment(env, ctx = {}) {
  const g = "env";
  const out = [];
  const { example = {}, envFilePresent = true, templatePresent = true } = ctx;

  out.push(
    templatePresent
      ? result("env.template", g, "pass", ".env.example present")
      : result("env.template", g, "fail", ".env.example missing"),
  );
  out.push(
    envFilePresent
      ? result("env.file", g, "pass", ".env present")
      : result("env.file", g, "warn", ".env missing (falling back to process environment)"),
  );

  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  const placeholders = REQUIRED_ENV.filter((k) => env[k] && isPlaceholder(env[k]));
  for (const k of missing) out.push(result(`env.missing:${k}`, g, "fail", `${k} is not set`));
  for (const k of placeholders) out.push(result(`env.placeholder:${k}`, g, "fail", `${k} still holds a placeholder`));

  const bad = (k, why) => out.push(result(`env.format:${k}`, g, "fail", `${k} is invalid`, why));
  const live = (k) => env[k] && !isPlaceholder(env[k]);

  if (live("PUBLIC_PROMPT_HASH_CONTRACT_ID") && !CONTRACT_ID.test(env.PUBLIC_PROMPT_HASH_CONTRACT_ID))
    bad("PUBLIC_PROMPT_HASH_CONTRACT_ID", "expected 56-char contract ID starting with C");
  if (live("PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID") && !CONTRACT_ID.test(env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID))
    bad("PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID", "expected 56-char contract ID starting with C");
  if (live("PUBLIC_STELLAR_SIMULATION_ACCOUNT") && !ACCOUNT_ID.test(env.PUBLIC_STELLAR_SIMULATION_ACCOUNT))
    bad("PUBLIC_STELLAR_SIMULATION_ACCOUNT", "expected 56-char account starting with G");
  for (const k of ["PUBLIC_STELLAR_RPC_URL", "PUBLIC_STELLAR_HORIZON_URL"]) {
    if (live(k) && !isHttpUrl(env[k])) bad(k, "expected an http(s) URL");
  }
  for (const k of ["PUBLIC_UNLOCK_PUBLIC_KEY", "UNLOCK_PUBLIC_KEY", "UNLOCK_PRIVATE_KEY"]) {
    if (live(k) && !(BASE64.test(env[k]) && env[k].length >= 20)) bad(k, "expected a base64 key");
  }
  if (live("CHALLENGE_TOKEN_SECRET") && env.CHALLENGE_TOKEN_SECRET.length < 16)
    bad("CHALLENGE_TOKEN_SECRET", "use at least 16 characters");

  // Cross-variable consistency.
  const network = normalizeNetwork(env.PUBLIC_STELLAR_NETWORK);
  if (env.PUBLIC_STELLAR_NETWORK && !NETWORK_PASSPHRASES[network]) {
    bad("PUBLIC_STELLAR_NETWORK", "use TESTNET, PUBLIC, FUTURENET, or LOCAL (MAINNET is rejected by the frontend)");
  } else if (network && env.PUBLIC_STELLAR_NETWORK_PASSPHRASE) {
    out.push(
      env.PUBLIC_STELLAR_NETWORK_PASSPHRASE === NETWORK_PASSPHRASES[network]
        ? result("env.network_passphrase", g, "pass", "network passphrase matches PUBLIC_STELLAR_NETWORK")
        : result(
            "env.network_passphrase",
            g,
            "fail",
            "PUBLIC_STELLAR_NETWORK_PASSPHRASE does not match PUBLIC_STELLAR_NETWORK",
            `expected the ${network} passphrase`,
          ),
    );
  }

  if (NETWORK_PASSPHRASES[network]) {
    for (const k of ["PUBLIC_STELLAR_RPC_URL", "PUBLIC_STELLAR_HORIZON_URL"]) {
      const implied = env[k] ? classifyUrl(env[k]) : null;
      if (implied && implied !== network) {
        out.push(
          result("env.url_network", g, "fail", `${k} points at ${implied} but PUBLIC_STELLAR_NETWORK is ${network}`),
        );
      }
    }
    const scaffold = env.STELLAR_SCAFFOLD_ENV;
    if (scaffold) {
      if (network === "PUBLIC" && scaffold !== "production")
        out.push(result("env.scaffold_env", g, "warn", `PUBLIC network with STELLAR_SCAFFOLD_ENV=${scaffold}`));
      if (network !== "PUBLIC" && scaffold === "production")
        out.push(result("env.scaffold_env", g, "warn", `STELLAR_SCAFFOLD_ENV=production on ${network}`));
    }
  }

  if (env.PUBLIC_UNLOCK_PUBLIC_KEY && env.UNLOCK_PUBLIC_KEY) {
    out.push(
      env.PUBLIC_UNLOCK_PUBLIC_KEY === env.UNLOCK_PUBLIC_KEY
        ? result("env.unlock_keys", g, "pass", "frontend and serverless unlock public keys match")
        : result("env.unlock_keys", g, "fail", "PUBLIC_UNLOCK_PUBLIC_KEY differs from UNLOCK_PUBLIC_KEY"),
    );
  }

  if (env.PUBLIC_STELLAR_RPC_URLS) {
    const urls = env.PUBLIC_STELLAR_RPC_URLS.split(",").map((u) => u.trim()).filter(Boolean);
    const quorum = Number(env.PUBLIC_STELLAR_ENTITLEMENT_QUORUM ?? 1);
    if (!urls.every(isHttpUrl) || !Number.isInteger(quorum) || quorum < 1 || quorum > urls.length)
      out.push(result("env.quorum", g, "fail", "PUBLIC_STELLAR_RPC_URLS / ENTITLEMENT_QUORUM are inconsistent"));
  }

  // Shipped example secrets are fine locally, never on the public network.
  const reused = SECRET_ENV.filter((k) => env[k] && example[k] && env[k] === example[k]);
  if (reused.length) {
    out.push(
      result(
        "env.secret_default",
        g,
        network === "PUBLIC" ? "fail" : "warn",
        `${reused.length} secret(s) still use .env.example defaults`,
        reused.join(", "),
      ),
    );
  }

  if (!out.some((r) => r.status === "fail")) out.push(result("env.complete", g, "pass", "required env config is valid"));
  return out;
}

export function checkAuthorization(env) {
  const g = "authorization";
  const out = [];

  // 1. Prevent leaking private keys into public-facing variables
  const leakedKeys = Object.keys(env).filter((k) => {
    const isPublic = k.startsWith("PUBLIC_") || k.startsWith("VITE_");
    const containsSecretName = /PRIVATE|SECRET|PASS(?:WORD|PHRASE)?_KEY/i.test(k);
    return isPublic && containsSecretName;
  });

  if (leakedKeys.length > 0) {
    out.push(
      result(
        "auth.private_key_leak",
        g,
        "fail",
        `Private key detected in public environment variable (${leakedKeys.join(", ")})`,
        "PUBLIC_* and VITE_* variables are exposed to client bundles"
      )
    );
  } else {
    out.push(result("auth.private_key_leak", g, "pass", "no private keys leaked into public variables"));
  }

  // 2. Validate cryptographic key encoding format for sensitive private keys
  const privateKeyVars = ["UNLOCK_PRIVATE_KEY", "RECEIPT_SIGNING_PRIVATE_KEY"];
  for (const k of privateKeyVars) {
    if (env[k] && !isPlaceholder(env[k])) {
      const val = env[k];
      const isBase64Key = BASE64.test(val) && val.length >= 32;
      const isHexKey = /^[0-9a-fA-F]{64}$/.test(val);
      if (isBase64Key || isHexKey) {
        out.push(result(`auth.secret_format:${k}`, g, "pass", `${k} has valid cryptographic key encoding`));
      } else {
        out.push(
          result(
            `auth.secret_format:${k}`,
            g,
            "fail",
            `${k} does not meet cryptographic key format requirements`,
            "expected at least 32 bytes in base64 or 64 hex characters"
          )
        );
      }
    }
  }

  // 3. Operator boundary and capability checks
  const hasOperatorPrivilege = Boolean(env.UNLOCK_PRIVATE_KEY && !isPlaceholder(env.UNLOCK_PRIVATE_KEY));
  const isOperatorMode = env.STELLAR_SCAFFOLD_ENV === "production" || env.NODE_ENV === "production";
  if (isOperatorMode && !hasOperatorPrivilege) {
    out.push(
      result(
        "auth.operator_boundary",
        g,
        "warn",
        "running in production mode without configured operator unlock key"
      )
    );
  } else {
    out.push(
      result(
        "auth.operator_boundary",
        g,
        "pass",
        hasOperatorPrivilege
          ? "operator authorization keys configured"
          : "contributor scope (unprivileged local mode)"
      )
    );
  }

  return out;
}

export function checkSeedData(root, exists = existsSync, read = (f) => readFileSync(f, "utf8"), env = {}) {
  const g = "seed";
  const p = (f) => resolve(root, f);
  const out = [];

  for (const f of ["src/test/fixtures/prompts.ts", "src/test/fixtures/rareFailureFixtures.ts"]) {
    out.push(
      exists(p(f))
        ? result("seed.fixtures", g, "pass", `${f} present`)
        : result("seed.fixtures", g, "fail", `${f} missing`),
    );
  }

  const spec = "tests/abi-conformance/fixtures/contract-spec.json";
  if (!exists(p(spec))) out.push(result("seed.fixtures", g, "fail", `${spec} missing`));
  else {
    try {
      JSON.parse(read(p(spec)));
      out.push(result("seed.fixtures", g, "pass", `${spec} is valid JSON`));
    } catch {
      out.push(result("seed.fixtures", g, "fail", `${spec} is not valid JSON`));
    }
  }

  const seed = "server/scripts/seedPreview.mjs";
  if (!exists(p(seed))) out.push(result("seed.script", g, "warn", `${seed} missing`));
  else {
    const src = read(p(seed));
    out.push(
      /blockedEnvironments/.test(src) && /preview-seed-v1/.test(src)
        ? result("seed.script", g, "pass", "preview seed script keeps its production guardrail")
        : result("seed.script", g, "fail", "preview seed script lost its production guardrail or seed tag"),
    );
  }

  const blocked = ["production", "prod", "mainnet"];
  const hot = ["APP_ENV", "VERCEL_ENV", "NODE_ENV"].filter((k) => blocked.includes(String(env[k] ?? "").toLowerCase()));
  out.push(
    hot.length
      ? result("seed.env_guard", g, "warn", `${hot.join(", ")} is production-like; yarn seed:preview will refuse to run`)
      : result("seed.env_guard", g, "pass", "environment allows preview seeding"),
  );
  return out;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function retryWithBackoff(fn, retries = 1, delayMs = 150) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export function tcpProbe(host, port, timeoutMs = NETWORK_TIMEOUT_MS) {
  return new Promise((done) => {
    const sock = connect({ host, port });
    const finish = (ok) => {
      sock.destroy();
      done(ok);
    };
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.once("connect", () => finish(true));
    sock.once("error", () => finish(false));
  });
}

function hostPort(uri, defaultPort) {
  try {
    const u = new URL(uri);
    return { host: u.hostname, port: Number(u.port) || defaultPort };
  } catch {
    return null;
  }
}

export async function checkNetwork(env, { fetchImpl = globalThis.fetch, probe = tcpProbe, offline = false, retries = 1 } = {}) {
  const g = "network";
  const out = [];
  const skip = (id, label) => out.push(result(id, g, "skip", `${label} (offline)`));
  const expected = NETWORK_PASSPHRASES[normalizeNetwork(env.PUBLIC_STELLAR_NETWORK)];

  const rpc = env.PUBLIC_STELLAR_RPC_URL;
  if (offline) skip("net.rpc", "Soroban RPC");
  else if (!rpc || !isHttpUrl(rpc)) out.push(result("net.rpc", g, "skip", "Soroban RPC URL not configured"));
  else {
    try {
      const rpcCall = async (method) => {
        return await retryWithBackoff(async () => {
          const res = await fetchWithTimeout(
            fetchImpl,
            rpc,
            { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) },
            NETWORK_TIMEOUT_MS,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()).result ?? {};
        }, retries);
      };
      const health = await rpcCall("getHealth");
      if (health.status && health.status !== "healthy") {
        out.push(result("net.rpc", g, "warn", `Soroban RPC reports ${health.status}`));
      } else {
        out.push(result("net.rpc", g, "pass", "Soroban RPC healthy"));
      }
      const net = await rpcCall("getNetwork").catch(() => ({}));
      if (net.passphrase && expected) {
        out.push(
          net.passphrase === expected
            ? result("net.rpc_network", g, "pass", "RPC network matches configured passphrase")
            : result("net.rpc_network", g, "fail", "RPC serves a different network than configured"),
        );
      }
    } catch (e) {
      out.push(result("net.rpc", g, "fail", "Soroban RPC unreachable", e?.name === "AbortError" ? "timed out" : e?.message));
    }
  }

  const horizon = env.PUBLIC_STELLAR_HORIZON_URL;
  if (offline) skip("net.horizon", "Horizon");
  else if (!horizon || !isHttpUrl(horizon)) out.push(result("net.horizon", g, "skip", "Horizon URL not configured"));
  else {
    try {
      const res = await retryWithBackoff(async () => {
        const r = await fetchWithTimeout(fetchImpl, horizon, { headers: { accept: "application/json" } }, NETWORK_TIMEOUT_MS);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r;
      }, retries);
      const body = await res.json();
      out.push(result("net.horizon", g, "pass", "Horizon reachable"));
      if (body.network_passphrase && expected) {
        out.push(
          body.network_passphrase === expected
            ? result("net.horizon_network", g, "pass", "Horizon network matches configured passphrase")
            : result("net.horizon_network", g, "fail", "Horizon serves a different network than configured"),
        );
      }
    } catch (e) {
      out.push(result("net.horizon", g, "warn", "Horizon unreachable", e?.name === "AbortError" ? "timed out" : e?.message));
    }
  }

  for (const [id, key, port, label] of [
    ["net.mongo", "MONGODB_URI", 27017, "MongoDB"],
    ["net.redis", "REDIS_URL", 6379, "Redis"],
  ]) {
    if (!env[key]) continue;
    if (offline) {
      skip(id, label);
      continue;
    }
    const target = hostPort(env[key], port);
    if (!target) out.push(result(id, g, "warn", `${key} is not a valid URI`));
    else {
      let isReachable = false;
      try {
        isReachable = await retryWithBackoff(async () => {
          const ok = await probe(target.host, target.port);
          if (!ok) throw new Error("probe failed");
          return true;
        }, retries);
      } catch {
        isReachable = false;
      }
      out.push(
        isReachable
          ? result(id, g, "pass", `${label} reachable`)
          : result(id, g, "warn", `${label} unreachable at ${target.host}:${target.port}`),
      );
    }
  }

  const chat = env.PUBLIC_CHAT_API_BASE;
  if (chat && isHttpUrl(chat)) {
    if (offline) skip("net.chat", "chat gateway");
    else {
      try {
        await retryWithBackoff(async () => {
          await fetchWithTimeout(fetchImpl, chat, { method: "HEAD" }, NETWORK_TIMEOUT_MS);
        }, retries);
        out.push(result("net.chat", g, "pass", "chat gateway reachable"));
      } catch {
        out.push(result("net.chat", g, "warn", "chat gateway unreachable"));
      }
    }
  }
  return out;
}

// ─── orchestration ───────────────────────────────────────────────────────────

export function summarize(checks, { strict = false } = {}) {
  const count = (s) => checks.filter((c) => c.status === s).length;
  const summary = { pass: count("pass"), warn: count("warn"), fail: count("fail"), skip: count("skip") };
  summary.ok = summary.fail === 0 && !(strict && summary.warn > 0);
  return summary;
}

export function applySafeFixes(root, { exists = existsSync, copy = copyFileSync } = {}) {
  const applied = [];
  if (!exists(resolve(root, ".env")) && exists(resolve(root, ".env.example"))) {
    try {
      copy(resolve(root, ".env.example"), resolve(root, ".env"), constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code === "EEXIST") return applied;
      throw error;
    }
    applied.push("created .env from .env.example (fill in real values before use)");
  }
  return applied;
}

export async function runDiagnostics({
  root = process.cwd(),
  processEnv = process.env,
  run = defaultRun,
  fetchImpl = globalThis.fetch,
  probe = tcpProbe,
  offline = false,
  strict = false,
  retries = 1,
} = {}) {
  const envPath = resolve(root, ".env");
  const examplePath = resolve(root, ".env.example");
  const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  const serverEnvPath = resolve(root, "server/.env");
  const serverEnv = existsSync(serverEnvPath) ? parseEnv(readFileSync(serverEnvPath, "utf8")) : {};
  const example = existsSync(examplePath) ? parseEnv(readFileSync(examplePath, "utf8")) : {};
  // Precedence matches scripts/check-local-setup.mjs: .env file, then process env.
  const env = { ...serverEnv, ...processEnv, ...fileEnv };

  const checks = [
    ...checkTooling(run),
    ...checkDependencies(root),
    ...checkEnvironment(env, { example, envFilePresent: existsSync(envPath), templatePresent: existsSync(examplePath) }),
    ...checkAuthorization(env),
    ...checkSeedData(root, existsSync, (f) => readFileSync(f, "utf8"), env),
    ...(await checkNetwork(env, { fetchImpl, probe, offline, retries })),
  ];
  return { checks, summary: summarize(checks, { strict }) };
}

function defaultRun(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

export function formatReport({ checks, summary }, { verbose = false } = {}) {
  const icon = { pass: "[PASS]", warn: "[WARN]", fail: "[FAIL]", skip: "[SKIP]" };
  const lines = [];
  let group = "";
  for (const c of checks) {
    if (c.group !== group) {
      group = c.group;
      lines.push(`\n${group.toUpperCase()}`);
    }
    if (c.status === "pass" && !verbose && c.group !== "network") continue;
    lines.push(`  ${icon[c.status]}  ${c.label}${c.detail ? `  (${c.detail})` : ""}`);
    if (c.fix) lines.push(`       -> ${c.fix}`);
  }
  lines.push(
    `\n${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary.skip} skipped`,
    summary.ok ? "Diagnostics OK." : "Diagnostics FAILED - apply the fixes marked -> above and re-run.",
    "Recovery notes: docs/operations/contributor-diagnostics.md",
  );
  return lines.join("\n");
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const rawArgs = process.argv.slice(2);
  let retries = 1;
  const filteredArgs = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--retries=")) {
      const val = parseInt(arg.split("=")[1], 10);
      if (!Number.isNaN(val) && val >= 0) retries = val;
    } else if (arg === "--retries" && i + 1 < rawArgs.length) {
      const val = parseInt(rawArgs[++i], 10);
      if (!Number.isNaN(val) && val >= 0) retries = val;
    } else {
      filteredArgs.push(arg);
    }
  }

  const args = new Set(filteredArgs);
  const supported = new Set(["--offline", "--json", "--strict", "--fix", "--verbose", "--help"]);
  if ([...args].some((arg) => !supported.has(arg))) {
    console.error("Unknown option. Run yarn diagnose --help for usage.");
    process.exit(2);
  }
  if (args.has("--help")) {
    console.log("Usage: yarn diagnose [--offline] [--json] [--strict] [--fix] [--verbose] [--retries=<n>]");
    process.exit(0);
  }
  const root = process.cwd();
  const applied = args.has("--fix") ? applySafeFixes(root) : [];
  const report = await runDiagnostics({ root, offline: args.has("--offline"), strict: args.has("--strict"), retries });
  if (args.has("--json")) {
    console.log(JSON.stringify({ ...report, applied }, null, 2));
  } else {
    for (const a of applied) console.log(`fixed: ${a}`);
    console.log(formatReport(report, { verbose: args.has("--verbose") }));
  }
  process.exit(report.summary.ok ? 0 : 1);
}
