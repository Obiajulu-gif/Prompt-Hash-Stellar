import { describe, it, expect, beforeEach } from "vitest";
import {
  KycDataMinimizationService,
  EligibilityTier,
} from "../lib/auth/kycDataMinimization";

describe("KYC Data Minimization & Selective Disclosure (#334)", () => {
  let kycService: KycDataMinimizationService;
  const investorWallet = "GINVESTOR_PUBLIC_KEY_1234567890ABCDEFGH";
  const rawPiiData = {
    fullName: "Alice Vance",
    dateOfBirth: "1988-05-14",
    nationalId: "SSN-99887766",
  };

  beforeEach(() => {
    kycService = new KycDataMinimizationService();
  });

  it("issues zero-PII commitment containing only commitment hash and non-identifying eligibility tier", () => {
    const commitment = kycService.issueEligibilityCommitment(
      investorWallet,
      rawPiiData,
      EligibilityTier.TIER_2_ACCREDITED,
      "US",
      "OFFICER_BOB"
    );

    expect(commitment.investorAddress).toBe(investorWallet);
    expect(commitment.eligibilityTier).toBe(EligibilityTier.TIER_2_ACCREDITED);
    expect(commitment.jurisdictionCode).toBe("US");
    expect(commitment.commitmentHash).toBeDefined();

    // Verify ZERO PII fields exist on commitment object or in serialized string
    const stringifiedCommitment = JSON.stringify(commitment);
    expect(stringifiedCommitment).not.toContain("Alice Vance");
    expect(stringifiedCommitment).not.toContain("1988-05-14");
    expect(stringifiedCommitment).not.toContain("SSN-99887766");
  });

  it("enforces purchase-time eligibility using ONLY the on-chain commitment without leaking PII", () => {
    const commitment = kycService.issueEligibilityCommitment(
      investorWallet,
      rawPiiData,
      EligibilityTier.TIER_2_ACCREDITED,
      "US",
      "OFFICER_BOB"
    );

    // Eligible for Tier 1 (Retail) and Tier 2 (Accredited)
    const checkTier1 = kycService.verifyPurchaseEligibility(commitment, EligibilityTier.TIER_1_RETAIL);
    expect(checkTier1.eligible).toBe(true);

    const checkTier2 = kycService.verifyPurchaseEligibility(commitment, EligibilityTier.TIER_2_ACCREDITED);
    expect(checkTier2.eligible).toBe(true);

    // Ineligible for Tier 3 (Institutional)
    const checkTier3 = kycService.verifyPurchaseEligibility(commitment, EligibilityTier.TIER_3_INSTITUTIONAL);
    expect(checkTier3.eligible).toBe(false);
    expect(checkTier3.reason).toContain("Insufficient eligibility tier");
  });

  it("allows access-controlled selective disclosure process for credentialed regulators", () => {
    const commitment = kycService.issueEligibilityCommitment(
      investorWallet,
      rawPiiData,
      EligibilityTier.TIER_2_ACCREDITED,
      "US",
      "OFFICER_BOB"
    );

    const validRegulatorKey = "REGULATOR_AUTHORIZED_KEY_SEC_AUDIT_2026";
    const auditId = "AUDIT_CASE_99001";

    const disclosurePackage = kycService.generateSelectiveDisclosurePackage(
      investorWallet,
      commitment,
      validRegulatorKey,
      auditId
    );

    expect(disclosurePackage.investorAddress).toBe(investorWallet);
    expect(disclosurePackage.regulatorAuditId).toBe(auditId);
    expect(disclosurePackage.decryptedPiiSummary?.fullName).toBe("Alice Vance");
    expect(disclosurePackage.decryptedPiiSummary?.nationalIdLast4).toBe("7766");
  });

  it("blocks unauthorized actors from requesting selective PII disclosure", () => {
    const commitment = kycService.issueEligibilityCommitment(
      investorWallet,
      rawPiiData,
      EligibilityTier.TIER_2_ACCREDITED,
      "US",
      "OFFICER_BOB"
    );

    expect(() =>
      kycService.generateSelectiveDisclosurePackage(
        investorWallet,
        commitment,
        "UNAUTHORIZED_MALICIOUS_KEY",
        "AUDIT_HACK"
      )
    ).toThrow("Unauthorized Access");
  });
});
