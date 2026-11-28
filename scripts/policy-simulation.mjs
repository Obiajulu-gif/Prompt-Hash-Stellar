#!/usr/bin/env node
/**
 * Policy Simulation CLI Tool with Affected-Record Previews (#1182).
 *
 * Provides safe, side-effect-free dry-run policy evaluation across marketplace
 * records with diff previews, rollback constraint analysis, and HMAC confirmation tokens.
 *
 * Usage:
 *   node scripts/policy-simulation.mjs --policy=<type|file> [options]
 *
 * Examples:
 *   node scripts/policy-simulation.mjs --policy=fee_adjustment --param.newFeePercentage=0.08
 *   node scripts/policy-simulation.mjs --policy=price_limit --param.maxPrice=100
 *   node scripts/policy-simulation.mjs --policy=creator_suspension --param.creatorAddress=G1234 --param.action=quarantine
 *   node scripts/policy-simulation.mjs --policy=bulk_refund --param.promptId=prompt_abc
 *   node scripts/policy-simulation.mjs --verify-token=<token> --policy-id=<id> --records=records.json
 *
 * Options:
 *   --policy=<type|file>      Policy change type or path to JSON policy definition
 *   --param.<key>=<val>       Policy parameters (e.g. --param.newFeePercentage=0.08)
 *   --records=<file>          Optional JSON file containing candidate records to evaluate
 *   --actor=<id>              Operator actor identity (default: "ops-admin")
 *   --permissions=<csv>       Comma-separated permissions (default: "policy:evaluate")
 *   --secret=<secret>         Secret key for HMAC confirmation token generation/verification
 *   --verify-token=<token>    Verify an existing confirmation token against candidate records
 *   --format=summary|json     Output display mode (default: "summary")
 *   --dry-run                 Pure evaluation without state mutation (default: true)
 *   --help                    Show this help manual
 *
 * Exit Codes:
 *   0 = Success (simulation completed or token verified successfully)
 *   1 = Validation or argument parsing failure
 *   2 = Unauthorized operator
 *   3 = Bounded record limit exceeded or token verification drift detected
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  simulatePolicyChange,
  verifySimulationConfirmationToken,
  PolicyEvaluationError,
  MAX_EVALUATION_RECORDS,
  MAX_PREVIEW_RECORDS,
  getSimulationSecret,
} from "../server/src/services/policySimulation.ts";

export function parseCliArgs(argv) {
  const args = {
    policy: "",
    parameters: {},
    recordsFile: "",
    actor: "ops-admin",
    permissions: "policy:evaluate",
    secret: "",
    verifyToken: "",
    format: "summary",
    dryRun: true,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--policy=")) {
      args.policy = arg.slice("--policy=".length).trim();
    } else if (arg.startsWith("--param.")) {
      const rest = arg.slice("--param.".length);
      const eqIdx = rest.indexOf("=");
      if (eqIdx !== -1) {
        const key = rest.slice(0, eqIdx);
        let val = rest.slice(eqIdx + 1);
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (!isNaN(Number(val)) && val !== "") val = Number(val);
        args.parameters[key] = val;
      }
    } else if (arg.startsWith("--records=")) {
      args.recordsFile = arg.slice("--records=".length).trim();
    } else if (arg.startsWith("--actor=")) {
      args.actor = arg.slice("--actor=".length).trim();
    } else if (arg.startsWith("--permissions=")) {
      args.permissions = arg.slice("--permissions=".length).trim();
    } else if (arg.startsWith("--secret=")) {
      args.secret = arg.slice("--secret=".length).trim();
    } else if (arg.startsWith("--verify-token=")) {
      args.verifyToken = arg.slice("--verify-token=".length).trim();
    } else if (arg.startsWith("--format=")) {
      args.format = arg.slice("--format=".length).trim();
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

export function printHelp() {
  console.log(`
Policy Simulation CLI Tool (#1182)

Usage:
  node scripts/policy-simulation.mjs --policy=<type|file> [options]

Commands & Types:
  fee_adjustment       Simulate marketplace protocol fee adjustments
  price_limit          Simulate pricing ceilings and floors
  creator_suspension   Simulate creator quarantine or suspension
  bulk_refund          Simulate bulk refund with platform treasury impact
  custom_rule          Simulate composite predicate policies

Options:
  --policy=<type|file>      Policy type or path to JSON policy definition
  --param.<key>=<val>       Policy parameters (e.g. --param.newFeePercentage=0.08)
  --records=<path>          Path to JSON file containing candidate records
  --actor=<id>              Operator actor identifier (default: "ops-admin")
  --permissions=<csv>       Comma-separated permission scopes (default: "policy:evaluate")
  --secret=<secret>         HMAC confirmation secret key
  --verify-token=<token>    Verify an existing confirmation token against drift
  --format=summary|json     Output formatting mode (default: "summary")
  --dry-run                 Guarantee zero state mutations (default: true)
  --help                    Show this help manual
`);
}

export async function runPolicySimulationCli(argv) {
  const args = parseCliArgs(argv);

  if (args.help) {
    printHelp();
    return { exitCode: 0 };
  }

  // Parse permissions
  const permissionSet = new Set(
    args.permissions
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  );

  const actor = {
    id: args.actor,
    role: "operator",
    permissions: permissionSet,
  };

  // Load candidate records if specified
  let candidateRecords = [];
  if (args.recordsFile) {
    const fullPath = resolve(process.cwd(), args.recordsFile);
    if (!existsSync(fullPath)) {
      console.error(`Error: Candidate records file not found at: ${fullPath}`);
      return { exitCode: 1, error: "records_file_not_found" };
    }
    try {
      const raw = readFileSync(fullPath, "utf8");
      candidateRecords = JSON.parse(raw);
      if (!Array.isArray(candidateRecords)) {
        console.error("Error: Candidate records file must contain a JSON array.");
        return { exitCode: 1, error: "invalid_records_json" };
      }
    } catch (err) {
      console.error(`Error: Failed to parse candidate records: ${err.message}`);
      return { exitCode: 1, error: "records_parse_error" };
    }
  }

  // Build policy definition
  let policyChange;
  if (args.policy.endsWith(".json") || existsSync(resolve(process.cwd(), args.policy))) {
    const fullPath = resolve(process.cwd(), args.policy);
    try {
      const raw = readFileSync(fullPath, "utf8");
      policyChange = JSON.parse(raw);
    } catch (err) {
      console.error(`Error: Failed to parse policy file: ${err.message}`);
      return { exitCode: 1, error: "policy_parse_error" };
    }
  } else {
    if (!args.policy && !args.verifyToken) {
      console.error("Error: --policy=<type|file> is required (or pass --verify-token=<token>).");
      return { exitCode: 1, error: "missing_policy" };
    }

    policyChange = {
      type: args.policy,
      parameters: args.parameters,
      reason: `CLI execution by ${actor.id}`,
      scheduledBy: actor.id,
    };
  }

  try {
    const result = await simulatePolicyChange(policyChange, {
      actor,
      candidateRecords,
      secret: args.secret || undefined,
    });

    // Token verification path
    if (args.verifyToken) {
      const isValid = verifySimulationConfirmationToken(
        args.verifyToken,
        result,
        args.secret || undefined,
      );
      if (isValid) {
        console.log("PASS: Confirmation token matches simulation plan with zero record drift.");
        return { exitCode: 0, valid: true, result };
      } else {
        console.error("FAIL: Confirmation token mismatch or record version drift detected.");
        return { exitCode: 3, valid: false, error: "token_drift_detected" };
      }
    }

    // Output formatting
    if (args.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return { exitCode: 0, result };
    }

    // Summary output format
    console.log("=================================================================");
    console.log(`Policy Simulation Preview: ${result.policyChange.type}`);
    console.log("=================================================================");
    console.log(`Scheduled By:       ${result.policyChange.scheduledBy}`);
    console.log(`Timestamp:          ${result.timestamp}`);
    console.log(`Scanned Records:    ${result.scannedCount}`);
    console.log(`Affected Records:   ${result.affectedCount}`);
    console.log(`Total XLM Impact:   ${result.affectedRecords.totalXlmImpact} XLM`);
    console.log(`Irreversible:       ${result.isIrreversible ? "YES (HIGH RISK)" : "NO"}`);
    console.log(
      `Severity Profile:   Low: ${result.severityCounts.low}, Medium: ${result.severityCounts.medium}, High: ${result.severityCounts.high}, Critical: ${result.severityCounts.critical}`,
    );
    console.log("-----------------------------------------------------------------");
    console.log("Side Effects & Risk Analysis:");
    for (const effect of result.sideEffects) {
      console.log(`  - [${effect.severity.toUpperCase()}] ${effect.description} (Reversible: ${effect.reversible})`);
    }
    for (const risk of result.risks) {
      console.log(`  - Risk [${risk.impact}]: ${risk.description} -> Mitigation: ${risk.mitigation}`);
    }
    console.log("-----------------------------------------------------------------");
    console.log("Rollback Constraints & Procedures:");
    for (const rb of result.rollbackConstraints) {
      console.log(`  - ${rb.constraint} [Rollback possible: ${rb.canRollback}]`);
      if (rb.rollbackProcedure) {
        console.log(`    Procedure: ${rb.rollbackProcedure} (Window: ${rb.timeWindow || "N/A"})`);
      }
    }

    if (result.preview.affectedPreviews.length > 0) {
      console.log("-----------------------------------------------------------------");
      console.log(`Affected Record Previews (showing up to ${MAX_PREVIEW_RECORDS}):`);
      for (const p of result.preview.affectedPreviews) {
        const diffStr = p.diffs
          .map((d) => `${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`)
          .join(", ");
        console.log(
          `  [${p.severity.toUpperCase()}] ${p.recordId} (v${p.version}) | ${p.statusBefore} -> ${p.statusAfter} | ${diffStr}`,
        );
      }
    }

    console.log("-----------------------------------------------------------------");
    console.log(`Confirmation Token (HMAC-SHA256):`);
    console.log(result.confirmationToken);
    console.log("=================================================================");

    return { exitCode: 0, result };
  } catch (err) {
    if (err instanceof PolicyEvaluationError) {
      if (err.code === "unauthorized") {
        console.error(`Authorization Error: ${err.message}`);
        return { exitCode: 2, error: err.code };
      }
      if (err.code === "selection_too_large") {
        console.error(`Bounds Error: ${err.message}`);
        return { exitCode: 3, error: err.code };
      }
      console.error(`Policy Validation Error: ${err.message}`);
      return { exitCode: 1, error: err.code };
    }

    console.error(`Unexpected Simulation Failure: ${err.message}`);
    return { exitCode: 1, error: err.message };
  }
}

// Direct CLI invocation
const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isMainModule) {
  runPolicySimulationCli(process.argv).then(({ exitCode }) => {
    process.exit(exitCode);
  });
}
