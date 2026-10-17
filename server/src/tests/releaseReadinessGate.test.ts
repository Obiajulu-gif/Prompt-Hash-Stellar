/**
 * Tests for the release readiness gate (Issue #1002).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
// @ts-expect-error -- untyped ESM script, executed directly in CI
import { evaluateReleaseGate } from "../../../scripts/release-readiness-gate.mjs";

const TEMPLATE = readFileSync(path.resolve(__dirname, "../../../.github/pull_request_template.md"), "utf8");
const tickAll = (body: string) => body.replace(/- \[ \]/g, "- [x]");

const base = {
  highRisk: true,
  hasMigration: false,
  hasContractChange: false,
  jobs: { checklist: "success", migration: "skipped", contract: "skipped", readiness: "success" },
};

describe("evaluateReleaseGate", () => {
  it("passes non-high-risk changes untouched", () => {
    expect(evaluateReleaseGate({ ...base, highRisk: false, prBody: "" }).ok).toBe(true);
  });

  it("fails closed when high-risk detection did not succeed", () => {
    const r = evaluateReleaseGate({ ...base, highRisk: false, detectResult: "failure", prBody: "" });
    expect(r).toEqual({ ok: false, failures: ["High-risk detection job failure."], waived: [] });
  });

  it("passes a fully checked PR template", () => {
    const r = evaluateReleaseGate({ ...base, prBody: tickAll(TEMPLATE) });
    expect(r).toEqual({ ok: true, failures: [], waived: [] });
  });

  it("blocks an unchecked template, naming each missing piece of evidence", () => {
    const r = evaluateReleaseGate({ ...base, prBody: TEMPLATE });
    expect(r.ok).toBe(false);
    for (const key of ["smoke", "security", "rollback-plan", "rollback-rehearsal"]) {
      expect(r.failures.some((f: string) => f.includes(`(${key})`))).toBe(true);
    }
  });

  it("requires migration evidence and a successful dry-run job when migrations change", () => {
    const body = tickAll(TEMPLATE).replace("- [x] Schema migration dry-run", "- [ ] Schema migration dry-run");
    const r = evaluateReleaseGate({ ...base, hasMigration: true, prBody: body });
    expect(r.failures).toEqual([
      "Migration dry-run job did not run (result: skipped).",
      expect.stringContaining("(migration-dry-run)"),
    ]);
  });

  it("treats a failed or cancelled job as blocking", () => {
    const r = evaluateReleaseGate({
      ...base,
      hasContractChange: true,
      prBody: tickAll(TEMPLATE),
      jobs: { ...base.jobs, contract: "cancelled" },
    });
    expect(r.failures).toEqual(["Contract upgrade preflight job cancelled."]);
  });

  it("blocks when the readiness self-test (#1047) failed or did not run", () => {
    const failed = evaluateReleaseGate({ ...base, prBody: tickAll(TEMPLATE), jobs: { ...base.jobs, readiness: "failure" } });
    expect(failed.failures).toEqual(["Readiness self-test job failure."]);
    const missing = evaluateReleaseGate({ ...base, prBody: tickAll(TEMPLATE), jobs: { ...base.jobs, readiness: undefined } });
    expect(missing.failures).toEqual(["Readiness self-test job did not run (result: missing)."]);
  });

  it("allows waivers only with an incident ticket", () => {
    const body = tickAll(TEMPLATE)
      .replace("- [x] Smoke verification", "- [ ] Smoke verification")
      .replace(/Skipped items: <!--.*-->/, "Skipped items: smoke");
    expect(evaluateReleaseGate({ ...base, prBody: body }).ok).toBe(false);

    const withTicket = body.replace(/Incident ticket: <!--.*-->/, "Incident ticket: https://example.test/INC-42");
    expect(evaluateReleaseGate({ ...base, prBody: withTicket })).toEqual({ ok: true, failures: [], waived: ["smoke"] });
  });
});
