/**
 * Incident Drill Service (Issue #972)
 *
 * Provides executable verification checks that prove recovery, rollback,
 * data validation, and user-impact reporting steps actually work.
 *
 * Each drill step:
 *  1. Has a human-readable description (documents what the runbook step does).
 *  2. Executes a read-only or safe synthetic check.
 *  3. Returns a structured pass/fail result with evidence.
 *
 * Drill categories align with the INCIDENT_RUNBOOK.md incident categories:
 *  - A: Data Visibility & Search
 *  - B: Contract & Settlement
 *  - C: Operational (jobs, worker health)
 *  - D: Authentication & Authorization
 *
 * Usage:
 *  const runner = new IncidentDrillRunner();
 *  const report = await runner.runFullDrill();
 *  // report.passed === true means all verification checks are green.
 */

import { logger } from "./structuredLogger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrillCategory = "A_visibility" | "B_settlement" | "C_operational" | "D_auth";
export type DrillStepStatus = "pass" | "fail" | "skip";

export interface DrillStep {
  /** Unique stable identifier for this drill step. */
  id: string;
  /** Runbook section this step belongs to. */
  category: DrillCategory;
  /** Human-readable title (maps to a runbook bullet). */
  title: string;
  /** What this check proves in the context of an incident drill. */
  description: string;
  /** Executes the check; must not mutate production data. */
  run: () => Promise<DrillStepResult>;
}

export interface DrillStepResult {
  stepId: string;
  status: DrillStepStatus;
  /** Evidence string that an operator can inspect to confirm the check is real. */
  evidence: string;
  /** Non-null when status === "fail". */
  failureReason?: string;
  durationMs: number;
}

export interface DrillReport {
  drillId: string;
  startedAt: string;
  completedAt: string;
  passed: boolean;
  totalSteps: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  results: DrillStepResult[];
  /** Steps that failed; empty array means the drill is fully green. */
  failures: DrillStepResult[];
  /** User-impact summary: which user-facing capabilities are at risk. */
  userImpactSummary: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, durationMs: Date.now() - start };
}

/** Safe HTTP GET with timeout — read-only, never mutates. */
async function httpGet(
  url: string,
  timeoutMs = 4_000
): Promise<{ ok: boolean; status?: number; body: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const body = await resp.text().catch(() => "");
    return { ok: resp.ok, status: resp.status, body };
  } catch (err: unknown) {
    return { ok: false, body: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Drill steps
// ---------------------------------------------------------------------------

function buildDrillSteps(env: DrillEnv): DrillStep[] {
  return [
    // ------------------------------------------------------------------ A
    {
      id: "A1_health_endpoint",
      category: "A_visibility",
      title: "Health endpoint responds with 200",
      description:
        "Verifies the /api/health endpoint is reachable and returns a 200 status. " +
        "This is the first check an operator runs after any deployment or incident.",
      run: async (): Promise<DrillStepResult> => {
        const { value: resp, durationMs } = await timed(() =>
          httpGet(`${env.apiBaseUrl}/api/health`, env.timeoutMs)
        );
        return {
          stepId: "A1_health_endpoint",
          status: resp.ok ? "pass" : "fail",
          evidence: `GET /api/health → HTTP ${resp.status ?? "ERR"}: ${resp.body.slice(0, 120)}`,
          failureReason: resp.ok ? undefined : `Expected 200, got ${resp.status ?? "no response"}`,
          durationMs,
        };
      },
    },

    {
      id: "A2_readiness_endpoint",
      category: "A_visibility",
      title: "Readiness endpoint confirms service is ready to serve traffic",
      description:
        "Verifies /api/readiness returns 200. Used by load balancers and Kubernetes probes. " +
        "A failing readiness probe means the instance should be taken out of rotation.",
      run: async (): Promise<DrillStepResult> => {
        const { value: resp, durationMs } = await timed(() =>
          httpGet(`${env.apiBaseUrl}/api/readiness`, env.timeoutMs)
        );
        return {
          stepId: "A2_readiness_endpoint",
          status: resp.ok ? "pass" : "fail",
          evidence: `GET /api/readiness → HTTP ${resp.status ?? "ERR"}`,
          failureReason: resp.ok ? undefined : `Expected 200, got ${resp.status ?? "no response"}`,
          durationMs,
        };
      },
    },

    {
      id: "A3_status_endpoint",
      category: "A_visibility",
      title: "Status endpoint reports multi-service state",
      description:
        "Verifies /api/status returns a parseable JSON body. During incidents this endpoint " +
        "shows which sub-services (RPC, Horizon, unlock) are degraded.",
      run: async (): Promise<DrillStepResult> => {
        const { value: resp, durationMs } = await timed(() =>
          httpGet(`${env.apiBaseUrl}/api/status`, env.timeoutMs)
        );
        let status: DrillStepStatus = "fail";
        let evidence = `GET /api/status → HTTP ${resp.status ?? "ERR"}`;
        let failureReason: string | undefined;

        if (resp.ok) {
          try {
            const parsed = JSON.parse(resp.body) as Record<string, unknown>;
            const keys = Object.keys(parsed);
            evidence += ` — keys: [${keys.join(", ")}]`;
            status = keys.length > 0 ? "pass" : "fail";
            if (keys.length === 0) failureReason = "Status response body is empty or not a JSON object";
          } catch {
            failureReason = "Status response is not valid JSON";
          }
        } else {
          failureReason = `HTTP ${resp.status ?? "no response"}`;
        }

        return { stepId: "A3_status_endpoint", status, evidence, failureReason, durationMs };
      },
    },

    // ------------------------------------------------------------------ B
    {
      id: "B1_dependency_probes_importable",
      category: "B_settlement",
      title: "Dependency degradation matrix can be imported and queried",
      description:
        "Verifies that the dependency degradation matrix module loads without error and " +
        "returns definitions for all critical third-party dependencies. This confirms " +
        "the operator tooling is intact after a deployment.",
      run: async (): Promise<DrillStepResult> => {
        const start = Date.now();
        try {
          const mod = await import("./dependencyDegradationMatrix.js");
          const matrix = mod.getDegradationMatrixDefinition();
          const names = matrix.map((e) => e.name);
          const required: string[] = ["stellar_rpc", "stellar_horizon", "mongodb", "redis", "ipfs_pinata", "safety_scanner"];
          const missing = required.filter(
            (n) => !(names as string[]).includes(n),
          );
          return {
            stepId: "B1_dependency_probes_importable",
            status: missing.length === 0 ? "pass" : "fail",
            evidence: `Matrix covers: [${names.join(", ")}]`,
            failureReason: missing.length > 0 ? `Missing entries: ${missing.join(", ")}` : undefined,
            durationMs: Date.now() - start,
          };
        } catch (err: unknown) {
          return {
            stepId: "B1_dependency_probes_importable",
            status: "fail",
            evidence: "Import failed",
            failureReason: String(err),
            durationMs: Date.now() - start,
          };
        }
      },
    },

    {
      id: "B2_fallback_matrix_failure_modes",
      category: "B_settlement",
      title: "Every critical dependency has documented failure modes with user messages",
      description:
        "Runs a structural assertion over the degradation matrix to confirm each dependency " +
        "has at least one failure mode with a non-empty userMessage. This prevents gaps in " +
        "operator playbooks from shipping to production.",
      run: async (): Promise<DrillStepResult> => {
        const start = Date.now();
        try {
          const mod = await import("./dependencyDegradationMatrix.js");
          const matrix = mod.getDegradationMatrixDefinition();
          const gaps: string[] = [];
          for (const entry of matrix) {
            if (entry.failureModes.length === 0) {
              gaps.push(`${entry.name}: no failure modes`);
            }
            for (const fm of entry.failureModes) {
              if (!fm.userMessage?.trim()) {
                gaps.push(`${entry.name}/${fm.mode}: empty userMessage`);
              }
              if (!fm.recoverySteps?.length) {
                gaps.push(`${entry.name}/${fm.mode}: no recovery steps`);
              }
            }
          }
          return {
            stepId: "B2_fallback_matrix_failure_modes",
            status: gaps.length === 0 ? "pass" : "fail",
            evidence: gaps.length === 0 ? "All failure modes have userMessages and recovery steps" : gaps.join("; "),
            failureReason: gaps.length > 0 ? `${gaps.length} gap(s) found in degradation matrix` : undefined,
            durationMs: Date.now() - start,
          };
        } catch (err: unknown) {
          return {
            stepId: "B2_fallback_matrix_failure_modes",
            status: "fail",
            evidence: "Import failed",
            failureReason: String(err),
            durationMs: Date.now() - start,
          };
        }
      },
    },

    // ------------------------------------------------------------------ C
    {
      id: "C1_structured_logger_redacts_secrets",
      category: "C_operational",
      title: "Structured logger redacts sensitive fields before output",
      description:
        "Confirms the structuredLogger.redact() function strips wallet addresses, private keys, " +
        "and tokens from log context. A failure here means secrets could leak into log aggregators.",
      run: async (): Promise<DrillStepResult> => {
        const start = Date.now();
        try {
          const { redact } = await import("./structuredLogger.js");
          const sensitiveInput = {
            walletAddress: "GCREATOR_SECRET_WALLET",
            privateKey: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
            token: "Bearer eyABC.XYZ",
            safeField: "this_is_safe",
            nested: { secret: "top_secret_value", publicId: "prompt_123" },
          };
          const result = redact(sensitiveInput) as Record<string, unknown>;
          const nested = result.nested as Record<string, unknown>;

          const leaked: string[] = [];
          if (result.walletAddress !== "[REDACTED]") leaked.push("walletAddress not redacted");
          if (result.privateKey !== "[REDACTED]") leaked.push("privateKey not redacted");
          if (result.token !== "[REDACTED]") leaked.push("token not redacted");
          if (nested?.secret !== "[REDACTED]") leaked.push("nested.secret not redacted");
          if (result.safeField !== "this_is_safe") leaked.push("safeField incorrectly redacted");

          return {
            stepId: "C1_structured_logger_redacts_secrets",
            status: leaked.length === 0 ? "pass" : "fail",
            evidence: leaked.length === 0
              ? "All sensitive fields redacted; safe fields preserved"
              : `Leaks: ${leaked.join(", ")}`,
            failureReason: leaked.length > 0 ? leaked.join("; ") : undefined,
            durationMs: Date.now() - start,
          };
        } catch (err: unknown) {
          return {
            stepId: "C1_structured_logger_redacts_secrets",
            status: "fail",
            evidence: "Import or assertion failed",
            failureReason: String(err),
            durationMs: Date.now() - start,
          };
        }
      },
    },

    {
      id: "C2_operational_health_service_importable",
      category: "C_operational",
      title: "Operational health service module loads correctly",
      description:
        "Verifies that operationalHealthService can be imported, confirming the dashboard " +
        "tooling is intact and usable by operators after a deployment or rollback.",
      run: async (): Promise<DrillStepResult> => {
        const start = Date.now();
        try {
          const mod = await import("./operationalHealthService.js");
          const has = typeof mod.operationalHealthService?.generateHealthReport === "function";
          return {
            stepId: "C2_operational_health_service_importable",
            status: has ? "pass" : "fail",
            evidence: has
              ? "operationalHealthService.generateHealthReport is callable"
              : "generateHealthReport is not a function",
            failureReason: has ? undefined : "operationalHealthService.generateHealthReport is missing",
            durationMs: Date.now() - start,
          };
        } catch (err: unknown) {
          return {
            stepId: "C2_operational_health_service_importable",
            status: "fail",
            evidence: "Import failed",
            failureReason: String(err),
            durationMs: Date.now() - start,
          };
        }
      },
    },

    {
      id: "C3_disaster_recovery_validator_importable",
      category: "C_operational",
      title: "Disaster recovery validation service loads and exposes invariant checks",
      description:
        "Verifies disasterRecoveryValidationService is importable and exposes all 6 invariant " +
        "check methods. These methods are called during rollback to confirm data integrity.",
      run: async (): Promise<DrillStepResult> => {
        const start = Date.now();
        try {
          const mod = await import("./disasterRecoveryValidation.js");
          const svc = mod.disasterRecoveryValidationService;
          const requiredMethods = [
            "validateAllInvariants",
            "validatePromptIntegrity",
            "validatePurchaseAndEntitlementRefs",
            "validatePayoutLedgerIntegrity",
            "validateBundleComposition",
            "validateTransactionUniqueness",
            "validateOrphanedAuxiliaryRecords",
          ];
          const missing = requiredMethods.filter(
            (m) => typeof (svc as unknown as Record<string, unknown>)[m] !== "function"
          );
          return {
            stepId: "C3_disaster_recovery_validator_importable",
            status: missing.length === 0 ? "pass" : "fail",
            evidence:
              missing.length === 0
                ? `All ${requiredMethods.length} invariant check methods are present`
                : `Missing methods: ${missing.join(", ")}`,
            failureReason: missing.length > 0 ? `Missing: ${missing.join(", ")}` : undefined,
            durationMs: Date.now() - start,
          };
        } catch (err: unknown) {
          return {
            stepId: "C3_disaster_recovery_validator_importable",
            status: "fail",
            evidence: "Import failed",
            failureReason: String(err),
            durationMs: Date.now() - start,
          };
        }
      },
    },

    // ------------------------------------------------------------------ D
    {
      id: "D1_sanitize_sensitive_data_function",
      category: "D_auth",
      title: "sanitizeSensitiveData strips Stellar secret keys and bearer tokens",
      description:
        "Confirms that the operational health service's sanitizer correctly masks Stellar secret " +
        "keys (S... format) and Bearer tokens before they appear in health dashboards or incident " +
        "reports. A failure here means credentials could be exposed to operators via the dashboard.",
      run: async (): Promise<DrillStepResult> => {
        const start = Date.now();
        try {
          const mod = await import("./operationalHealthService.js");
          const { sanitizeSensitiveData } = mod;

          const input = {
            error: "Auth failed for Bearer eyABC.token.XYZ and seed SABC12345678901234567890123456789012345678901234567890123",
            safeField: "this-is-safe",
          };
          const result = sanitizeSensitiveData(input) as Record<string, unknown>;
          const errorStr = String(result.error ?? "");

          const leaked: string[] = [];
          if (errorStr.includes("eyABC.token.XYZ")) leaked.push("Bearer token leaked");
          if (errorStr.includes("SABC123456789")) leaked.push("Stellar secret key leaked");
          if (result.safeField !== "this-is-safe") leaked.push("safeField incorrectly modified");

          return {
            stepId: "D1_sanitize_sensitive_data_function",
            status: leaked.length === 0 ? "pass" : "fail",
            evidence: leaked.length === 0
              ? "Bearer token and Stellar secret key redacted; safe field preserved"
              : leaked.join(", "),
            failureReason: leaked.length > 0 ? leaked.join("; ") : undefined,
            durationMs: Date.now() - start,
          };
        } catch (err: unknown) {
          return {
            stepId: "D1_sanitize_sensitive_data_function",
            status: "fail",
            evidence: "Import or assertion failed",
            failureReason: String(err),
            durationMs: Date.now() - start,
          };
        }
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface DrillEnv {
  /** Base URL of the running API server (used for HTTP probe steps). */
  apiBaseUrl: string;
  timeoutMs: number;
}

function defaultDrillEnv(): DrillEnv {
  return {
    apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:5000",
    timeoutMs: 4_000,
  };
}

export class IncidentDrillRunner {
  private readonly env: DrillEnv;

  constructor(envOverride?: Partial<DrillEnv>) {
    this.env = { ...defaultDrillEnv(), ...envOverride };
  }

  /** Returns all drill steps without running them — useful for documentation. */
  getSteps(): DrillStep[] {
    return buildDrillSteps(this.env);
  }

  /** Runs a single drill step by id. */
  async runStep(stepId: string): Promise<DrillStepResult | null> {
    const step = buildDrillSteps(this.env).find((s) => s.id === stepId);
    if (!step) return null;
    return step.run();
  }

  /** Runs all drill steps and returns a consolidated report. */
  async runFullDrill(): Promise<DrillReport> {
    const drillId = `drill_${Date.now()}`;
    const startedAt = new Date().toISOString();
    const steps = buildDrillSteps(this.env);

    logger.info("Incident drill started", { action: "incident_drill_start", drillId, stepCount: steps.length });

    const results: DrillStepResult[] = [];
    for (const step of steps) {
      try {
        const result = await step.run();
        results.push(result);
        if (result.status === "fail") {
          logger.warn("Drill step failed", {
            action: "incident_drill_step_fail",
            drillId,
            stepId: step.id,
            failureReason: result.failureReason,
          });
        }
      } catch (err: unknown) {
        // Should not happen since all steps catch internally, but belt-and-suspenders:
        results.push({
          stepId: step.id,
          status: "fail",
          evidence: "Step threw an unhandled error",
          failureReason: String(err),
          durationMs: 0,
        });
      }
    }

    const passedCount = results.filter((r) => r.status === "pass").length;
    const failedCount = results.filter((r) => r.status === "fail").length;
    const skippedCount = results.filter((r) => r.status === "skip").length;
    const failures = results.filter((r) => r.status === "fail");
    const passed = failedCount === 0;

    // Derive user-impact summary from failed steps
    const userImpactSummary = failures.map((f) => {
      const step = steps.find((s) => s.id === f.stepId);
      return step ? `[${step.category}] ${step.title}: ${f.failureReason ?? "check failed"}` : f.stepId;
    });

    const report: DrillReport = {
      drillId,
      startedAt,
      completedAt: new Date().toISOString(),
      passed,
      totalSteps: steps.length,
      passedCount,
      failedCount,
      skippedCount,
      results,
      failures,
      userImpactSummary,
    };

    logger.info("Incident drill completed", {
      action: "incident_drill_complete",
      drillId,
      passed,
      passedCount,
      failedCount,
    });

    return report;
  }
}

export const incidentDrillRunner = new IncidentDrillRunner();
