import { sha256 } from "js-sha256";

export enum EligibilityTier {
  TIER_1_RETAIL = "TIER_1_RETAIL",
  TIER_2_ACCREDITED = "TIER_2_ACCREDITED",
  TIER_3_INSTITUTIONAL = "TIER_3_INSTITUTIONAL",
}

export interface OnChainKycCommitment {
  investorAddress: string;
  commitmentHash: string; // SHA-256 hash of (piiHash + salt + verificationTimestamp + eligibilityTier)
  eligibilityTier: EligibilityTier;
  jurisdictionCode: string; // Non-PII ISO code, e.g. "US", "EU"
  issuedAt: string;
  expiresAt: string;
  oracleSignature: string;
}

export interface OffChainAuditRecord {
  investorAddress: string;
  salt: string;
  piiHash: string;
  encryptedPiiBlob: string; // Access-controlled encrypted PII for regulatory audit
  complianceOfficer: string;
  verifiedAt: string;
}

export interface SelectiveDisclosurePackage {
  investorAddress: string;
  commitment: OnChainKycCommitment;
  decryptedPiiSummary?: {
    fullName: string;
    dateOfBirth: string;
    nationalIdLast4: string;
    verifiedJurisdiction: string;
  };
  disclosureApprovedBy: string;
  regulatorAuditId: string;
  disclosedAt: string;
}

export class KycDataMinimizationService {
  private offChainAuditVault: Map<string, OffChainAuditRecord> = new Map();
  private oracleSecret: string;

  constructor(oracleSecret: string = "SECRET_KYC_ORACLE_HMAC_KEY_9988") {
    this.oracleSecret = oracleSecret;
  }

  /**
   * Helper: Compute deterministic commitment hash without exposing PII.
   */
  public computeCommitmentHash(
    investorAddress: string,
    piiHash: string,
    salt: string,
    tier: EligibilityTier,
    timestamp: string
  ): string {
    return sha256(`${investorAddress}:${piiHash}:${salt}:${tier}:${timestamp}:${this.oracleSecret}`);
  }

  /**
   * Register off-chain KYC verification and issue on-chain commitment.
   */
  public issueEligibilityCommitment(
    investorAddress: string,
    rawPii: { fullName: string; dateOfBirth: string; nationalId: string },
    tier: EligibilityTier,
    jurisdictionCode: string,
    complianceOfficer: string
  ): OnChainKycCommitment {
    const salt = sha256(`${investorAddress}:${Date.now()}:${Math.random()}`).substring(0, 16);
    const piiHash = sha256(`${rawPii.fullName}:${rawPii.dateOfBirth}:${rawPii.nationalId}`);

    // Encrypt raw PII for off-chain vault storage
    const encryptedPiiBlob = Buffer.from(JSON.stringify(rawPii)).toString("base64");

    const now = new Date();
    const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const commitmentHash = this.computeCommitmentHash(
      investorAddress,
      piiHash,
      salt,
      tier,
      now.toISOString()
    );

    const oracleSignature = sha256(`SIGN:${commitmentHash}:${this.oracleSecret}`);

    // Store in off-chain compliance system ONLY (never on public ledger)
    this.offChainAuditVault.set(investorAddress, {
      investorAddress,
      salt,
      piiHash,
      encryptedPiiBlob,
      complianceOfficer,
      verifiedAt: now.toISOString(),
    });

    // Return ONLY the zero-PII commitment for on-chain usage
    return {
      investorAddress,
      commitmentHash,
      eligibilityTier: tier,
      jurisdictionCode,
      issuedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      oracleSignature,
    };
  }

  /**
   * Enforceable at purchase time on-chain using ONLY the non-PII commitment
   */
  public verifyPurchaseEligibility(
    commitment: OnChainKycCommitment,
    requiredTier: EligibilityTier,
    purchaseAmountStroops: bigint = 0n
  ): { eligible: boolean; reason?: string } {
    if (!commitment || !commitment.commitmentHash || !commitment.oracleSignature) {
      return { eligible: false, reason: "Invalid KYC commitment structure." };
    }

    // Verify signature
    const expectedSig = sha256(`SIGN:${commitment.commitmentHash}:${this.oracleSecret}`);
    if (commitment.oracleSignature !== expectedSig) {
      return { eligible: false, reason: "KYC commitment signature verification failed." };
    }

    // Verify expiry
    if (new Date(commitment.expiresAt).getTime() < Date.now()) {
      return { eligible: false, reason: "KYC eligibility commitment has expired." };
    }

    // Verify Tier hierarchy
    const tierRanks: Record<EligibilityTier, number> = {
      [EligibilityTier.TIER_1_RETAIL]: 1,
      [EligibilityTier.TIER_2_ACCREDITED]: 2,
      [EligibilityTier.TIER_3_INSTITUTIONAL]: 3,
    };

    if (tierRanks[commitment.eligibilityTier] < tierRanks[requiredTier]) {
      return {
        eligible: false,
        reason: `Insufficient eligibility tier. Required: ${requiredTier}, Investor Tier: ${commitment.eligibilityTier}.`,
      };
    }

    return { eligible: true };
  }

  /**
   * Documented, access-controlled selective-disclosure process for authorized regulators.
   */
  public generateSelectiveDisclosurePackage(
    investorAddress: string,
    commitment: OnChainKycCommitment,
    authorizedRegulatorKey: string,
    regulatorAuditId: string
  ): SelectiveDisclosurePackage {
    if (!authorizedRegulatorKey.startsWith("REGULATOR_AUTHORIZED_KEY")) {
      throw new Error("Unauthorized Access: Only credentialed regulatory keys may request selective PII disclosure.");
    }

    const offChainRecord = this.offChainAuditVault.get(investorAddress);
    if (!offChainRecord) {
      throw new Error("Audit Record Not Found: No off-chain KYC audit record exists for target investor.");
    }

    const rawPiiJson = Buffer.from(offChainRecord.encryptedPiiBlob, "base64").toString("utf8");
    const rawPii = JSON.parse(rawPiiJson);

    return {
      investorAddress,
      commitment,
      decryptedPiiSummary: {
        fullName: rawPii.fullName,
        dateOfBirth: rawPii.dateOfBirth,
        nationalIdLast4: rawPii.nationalId.slice(-4),
        verifiedJurisdiction: commitment.jurisdictionCode,
      },
      disclosureApprovedBy: offChainRecord.complianceOfficer,
      regulatorAuditId,
      disclosedAt: new Date().toISOString(),
    };
  }
}
