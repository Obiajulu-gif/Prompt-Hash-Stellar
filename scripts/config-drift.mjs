#!/usr/bin/env node
/**
 * Compare explicitly selected environment files without exposing their values.
 * Only keys in CONFIG_KEYS are inspected; unknown variables are ignored.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ENVIRONMENTS = ["local", "staging", "production"];

/**
 * Chain endpoints, deployment identifiers, and credentials are expected to
 * differ between environments. Every other listed key is compared verbatim.
 */
export const ALLOWED_DIFFERENCE_KEYS = new Set([
  "STELLAR_SCAFFOLD_ENV",
  "PUBLIC_STELLAR_NETWORK",
  "PUBLIC_STELLAR_NETWORK_PASSPHRASE",
  "PUBLIC_STELLAR_RPC_URL",
  "PUBLIC_STELLAR_HORIZON_URL",
  "PUBLIC_PROMPT_HASH_CONTRACT_ID",
  "PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID",
  "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
  "PUBLIC_CHAT_API_BASE",
  "PUBLIC_PINATA_JWT",
  "CHALLENGE_TOKEN_SECRET",
  "CHALLENGE_TOKEN_SECRET_PREVIOUS",
  "UNLOCK_PUBLIC_KEY",
  "UNLOCK_PRIVATE_KEY",
  "PUBLIC_UNLOCK_PUBLIC_KEY",
  "RECEIPT_SIGNING_KEY_ID",
  "RECEIPT_SIGNING_PUBLIC_KEY",
  "RECEIPT_SIGNING_PRIVATE_KEY",
  "RECEIPT_SIGNING_KEYS_JSON",
  "MONGODB_URI",
  "REDIS_URL",
  "SENTRY_DSN",
  "PUBLIC_SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "WEBHOOK_SECRET",
  "GITHUB_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_SECRET",
  "ADMIN_TOKEN_SECRET",
  "SECRET_ENCRYPTION_KEY",
  "EXTERNAL_EVIDENCE_TRUSTED_KEYS",
]);

/** Chain/runtime configuration required in every supplied environment file. */
export const REQUIRED_KEYS = [
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

/** Optional safety controls: compare only when configured in any profile. */
export const OPTIONAL_MATCH_KEYS = [
  "ABUSE_RISK_MODE",
  "ALLOWLIST_MODE",
  "LOG_LEVEL",
  "PUBLIC_STELLAR_ENTITLEMENT_QUORUM",
];

/** Explicit key contract; unknown env keys are intentionally not emitted. */
export const CONFIG_KEYS = [...new Set([
  ...REQUIRED_KEYS,
  ...ALLOWED_DIFFERENCE_KEYS,
  ...OPTIONAL_MATCH_KEYS,
])];

const SECRET_KEY = /(secret|token|password|private|credential|api.?key|dsn|jwt|key)/i;

export function parseEnvironment(text) {
  const values = Object.create(null);
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    const raw = trimmed.slice(separator + 1).trim();
    values[key] = raw.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_match, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  }
  return values;
}

/**
 * Return value-free drift findings. The report never contains configuration
 * values, file contents, or parser errors that could echo a secret.
 */
export function compareConfigurations(configurations) {
  const findings = [];
  for (const key of CONFIG_KEYS) {
    const missing = ENVIRONMENTS.filter((environment) => !configurations[environment]?.[key]);
    const values = ENVIRONMENTS
      .filter((environment) => configurations[environment]?.[key])
      .map((environment) => configurations[environment][key]);
    const isAllowedDifference = ALLOWED_DIFFERENCE_KEYS.has(key);
    const isRequired = REQUIRED_KEYS.includes(key);
    const configuredSomewhere = values.length > 0;

    if (missing.length > 0 && (isRequired || configuredSomewhere)) {
      findings.push({
        key,
        status: "missing",
        missingEnvironments: missing,
        severity: isRequired ? "error" : "warning",
        sensitive: SECRET_KEY.test(key),
      });
      continue;
    }

    if (new Set(values).size > 1) {
      findings.push({
        key,
        status: isAllowedDifference ? "allowed_difference" : "mismatch",
        environments: ENVIRONMENTS,
        severity: isAllowedDifference ? "info" : "error",
        sensitive: SECRET_KEY.test(key),
      });
    }
  }

  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings,
    summary: {
      missing: findings.filter((finding) => finding.status === "missing").length,
      mismatched: findings.filter((finding) => finding.status === "mismatch").length,
      allowedDifferences: findings.filter((finding) => finding.status === "allowed_difference").length,
    },
  };
}

function parseArguments(args) {
  const paths = {};
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") return { help: true };
    if (["--local", "--staging", "--production"].includes(argument)) {
      const environment = argument.slice(2);
      const filePath = args[index + 1];
      if (!filePath || filePath.startsWith("--")) throw new Error(`Missing path for ${argument}.`);
      paths[environment] = filePath;
      index += 1;
      continue;
    }
    throw new Error("Unknown option.");
  }
  if (ENVIRONMENTS.some((environment) => !paths[environment])) {
    throw new Error("Provide --local, --staging, and --production environment files.");
  }
  return { paths, json };
}

export function runConfigDriftCli(args, { readFile = (filePath) => readFileSync(filePath, "utf8") } = {}) {
  const options = parseArguments(args);
  if (options.help) {
    return { exitCode: 0, output: "Usage: yarn config:drift --local <file> --staging <file> --production <file> [--json]" };
  }

  const configurations = {};
  for (const environment of ENVIRONMENTS) {
    try {
      configurations[environment] = parseEnvironment(readFile(resolve(options.paths[environment])));
    } catch {
      return {
        exitCode: 2,
        output: options.json
          ? JSON.stringify({ ok: false, error: "Unable to read one or more environment files." })
          : "Unable to read one or more environment files. Check the supplied paths.",
      };
    }
  }

  const report = compareConfigurations(configurations);
  const output = options.json
    ? JSON.stringify(report, null, 2)
    : formatReport(report);
  return { exitCode: report.ok ? 0 : 1, output };
}

function formatReport(report) {
  const lines = report.findings.length === 0
    ? ["No configuration drift detected."]
    : report.findings.map((finding) => {
      if (finding.status === "missing") {
        return `${finding.severity.toUpperCase()}: ${finding.key} is missing from ${finding.missingEnvironments.join(", ")}${finding.sensitive ? " (sensitive value not shown)" : ""}`;
      }
      return `${finding.status.toUpperCase()}: ${finding.key}${finding.sensitive ? " (values redacted)" : ""}`;
    });
  lines.push(`Summary: ${report.summary.missing} missing, ${report.summary.mismatched} mismatched, ${report.summary.allowedDifferences} allowed differences.`);
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runConfigDriftCli(process.argv.slice(2));
    console.log(result.output);
    process.exitCode = result.exitCode;
  } catch {
    console.error("Invalid config drift command. Use --help for usage.");
    process.exitCode = 2;
  }
}