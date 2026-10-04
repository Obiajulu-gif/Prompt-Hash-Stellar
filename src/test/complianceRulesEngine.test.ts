import { describe, it, expect, beforeEach } from "vitest";
import { ComplianceRulesEngine } from "../lib/policy/complianceRulesEngine";

describe("Compliance Rules Engine (#335)", () => {
  let engine: ComplianceRulesEngine;
  const admin = "GGOVERNANCE_ADMIN_WALLET_123456789";

  beforeEach(() => {
    engine = new ComplianceRulesEngine(admin);
  });

  it("evaluates governance rules and enforces investor caps on primary issuance", () => {
    // US cap is 100,000,000,000 Stroops (10,000 XLM)
    const validIssuance = engine.evaluateIssuance("US", true, "GLOBAL", 50_000_000_000n, 0n);
    expect(validIssuance.allowed).toBe(true);
    expect(validIssuance.nonComplianceStatus).toBe("COMPLIANT");

    const excessiveIssuance = engine.evaluateIssuance("US", true, "GLOBAL", 150_000_000_000n, 0n);
    expect(excessiveIssuance.allowed).toBe(false);
    expect(excessiveIssuance.reason).toContain("exceeds jurisdiction investor cap");
  });

  it("enforces accreditation requirement consistently", () => {
    const unaccreditedUS = engine.evaluateIssuance("US", false, "GLOBAL", 10_000_000_000n, 0n);
    expect(unaccreditedUS.allowed).toBe(false);
    expect(unaccreditedUS.reason).toContain("requires accreditation");

    const unaccreditedEU = engine.evaluateIssuance("EU", false, "GLOBAL", 10_000_000_000n, 0n);
    expect(unaccreditedEU.allowed).toBe(true);
  });

  it("blocks transfers to restricted jurisdictions and enforces secondary transfer rules", () => {
    const transferToRestricted = engine.evaluateTransfer("RESTRICTED", true, "GLOBAL", 5_000_000_000n, 0n);
    expect(transferToRestricted.allowed).toBe(false);
    expect(transferToRestricted.reason).toContain("restricted");

    const transferToEU = engine.evaluateTransfer("EU", false, "GLOBAL", 20_000_000_000n, 0n);
    expect(transferToEU.allowed).toBe(true);
  });

  it("allows governance to update rules table without contract redeploy", () => {
    // Update US investor cap via governance admin
    engine.updateRule(admin, "US", "GLOBAL", {
      investorCapStroops: 500_000_000_000n, // Increase to 50,000 XLM
    });

    const issuanceAfterUpdate = engine.evaluateIssuance("US", true, "GLOBAL", 300_000_000_000n, 0n);
    expect(issuanceAfterUpdate.allowed).toBe(true);
  });

  it("prevents unauthorized actors from updating governance rules", () => {
    expect(() =>
      engine.updateRule("GUNAUTHORIZED_ACTOR", "US", "GLOBAL", {
        investorCapStroops: 1n,
      })
    ).toThrow("Unauthorized");
  });

  it("provides non-punitive forced-sale window handling path for holders who become non-compliant after a rule change", () => {
    // Investor in US holds 80,000,000,000 Stroops
    const currentBalance = 80_000_000_000n;

    // Rule change occurs: Governance lowers US investor cap to 50,000,000,000 Stroops
    engine.updateRule(admin, "US", "GLOBAL", {
      investorCapStroops: 50_000_000_000n,
    });

    // Evaluate existing position compliance
    const postChangeEvaluation = engine.evaluateExistingPositionCompliance("US", true, "GLOBAL", currentBalance);

    expect(postChangeEvaluation.allowed).toBe(false);
    expect(postChangeEvaluation.nonComplianceStatus).toBe("NON_COMPLIANT_FORCED_SALE");
    expect(postChangeEvaluation.reason).toContain("30-day forced-sale window");
    expect(postChangeEvaluation.forcedSaleDeadline).toBeDefined();
  });
});
