export interface JurisdictionRule {
  jurisdiction: string;
  instrumentType: string;
  investorCapStroops: bigint;
  accreditationRequired: boolean;
  isAllowed: boolean;
  updatedAt: string;
  version: number;
}

export type NonComplianceStatus = "COMPLIANT" | "NON_COMPLIANT_GRACE_PERIOD" | "NON_COMPLIANT_FORCED_SALE";

export interface EvaluationResult {
  allowed: boolean;
  reason?: string;
  nonComplianceStatus: NonComplianceStatus;
  forcedSaleDeadline?: string;
}

export class ComplianceRulesEngine {
  private rules: Map<string, JurisdictionRule> = new Map();
  private governanceAdmin: string;

  constructor(governanceAdmin: string = "GGOVERNANCE_ADMIN_WALLET_123456789") {
    this.governanceAdmin = governanceAdmin;
    this.initializeDefaultRules();
  }

  private getRuleKey(jurisdiction: string, instrumentType: string): string {
    return `${jurisdiction.toUpperCase()}:${instrumentType.toUpperCase()}`;
  }

  private initializeDefaultRules(): void {
    const defaults: JurisdictionRule[] = [
      {
        jurisdiction: "US",
        instrumentType: "GLOBAL",
        investorCapStroops: 100_000_000_000n, // 10,000 XLM
        accreditationRequired: true,
        isAllowed: true,
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      {
        jurisdiction: "EU",
        instrumentType: "GLOBAL",
        investorCapStroops: 500_000_000_000n, // 50,000 XLM
        accreditationRequired: false,
        isAllowed: true,
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      {
        jurisdiction: "JP",
        instrumentType: "GLOBAL",
        investorCapStroops: 250_000_000_000n, // 25,000 XLM
        accreditationRequired: false,
        isAllowed: true,
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      {
        jurisdiction: "RESTRICTED",
        instrumentType: "GLOBAL",
        investorCapStroops: 0n,
        accreditationRequired: true,
        isAllowed: false,
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    ];

    for (const rule of defaults) {
      this.rules.set(this.getRuleKey(rule.jurisdiction, rule.instrumentType), rule);
    }
  }

  /**
   * Governance update without contract redeploy
   */
  public updateRule(
    actor: string,
    jurisdiction: string,
    instrumentType: string,
    updates: Partial<Omit<JurisdictionRule, "jurisdiction" | "instrumentType" | "updatedAt" | "version">>
  ): JurisdictionRule {
    if (actor !== this.governanceAdmin) {
      throw new Error("Unauthorized: Only governance admin can update compliance rules.");
    }

    const key = this.getRuleKey(jurisdiction, instrumentType);
    const existing = this.rules.get(key) || {
      jurisdiction: jurisdiction.toUpperCase(),
      instrumentType: instrumentType.toUpperCase(),
      investorCapStroops: 100_000_000_000n,
      accreditationRequired: false,
      isAllowed: true,
      updatedAt: new Date().toISOString(),
      version: 0,
    };

    const updatedRule: JurisdictionRule = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };

    this.rules.set(key, updatedRule);
    return updatedRule;
  }

  public getRule(jurisdiction: string, instrumentType: string): JurisdictionRule {
    const specificKey = this.getRuleKey(jurisdiction, instrumentType);
    if (this.rules.has(specificKey)) {
      return this.rules.get(specificKey)!;
    }
    const globalKey = this.getRuleKey(jurisdiction, "GLOBAL");
    if (this.rules.has(globalKey)) {
      return this.rules.get(globalKey)!;
    }
    // Default fallback rule for unknown jurisdictions
    return {
      jurisdiction: jurisdiction.toUpperCase(),
      instrumentType: instrumentType.toUpperCase(),
      investorCapStroops: 0n,
      accreditationRequired: true,
      isAllowed: false,
      updatedAt: new Date().toISOString(),
      version: 1,
    };
  }

  /**
   * Enforced on primary issuance
   */
  public evaluateIssuance(
    jurisdiction: string,
    isAccredited: boolean,
    instrumentType: string,
    amountStroops: bigint,
    currentBalanceStroops: bigint = 0n
  ): EvaluationResult {
    const rule = this.getRule(jurisdiction, instrumentType);

    if (!rule.isAllowed) {
      return {
        allowed: false,
        reason: `Issuance blocked: Jurisdiction ${jurisdiction} is restricted from holding ${instrumentType}.`,
        nonComplianceStatus: "NON_COMPLIANT_FORCED_SALE",
      };
    }

    if (rule.accreditationRequired && !isAccredited) {
      return {
        allowed: false,
        reason: `Issuance blocked: Investor in ${jurisdiction} requires accreditation.`,
        nonComplianceStatus: "NON_COMPLIANT_FORCED_SALE",
      };
    }

    const projectedBalance = currentBalanceStroops + amountStroops;
    if (projectedBalance > rule.investorCapStroops) {
      return {
        allowed: false,
        reason: `Issuance blocked: Projected balance ${projectedBalance} Stroops exceeds jurisdiction investor cap of ${rule.investorCapStroops} Stroops.`,
        nonComplianceStatus: "COMPLIANT",
      };
    }

    return {
      allowed: true,
      nonComplianceStatus: "COMPLIANT",
    };
  }

  /**
   * Enforced on every secondary transfer
   */
  public evaluateTransfer(
    recipientJurisdiction: string,
    isRecipientAccredited: boolean,
    instrumentType: string,
    transferAmountStroops: bigint,
    recipientCurrentBalanceStroops: bigint = 0n
  ): EvaluationResult {
    const rule = this.getRule(recipientJurisdiction, instrumentType);

    if (!rule.isAllowed) {
      return {
        allowed: false,
        reason: `Transfer blocked: Recipient jurisdiction ${recipientJurisdiction} is restricted.`,
        nonComplianceStatus: "NON_COMPLIANT_FORCED_SALE",
      };
    }

    if (rule.accreditationRequired && !isRecipientAccredited) {
      return {
        allowed: false,
        reason: `Transfer blocked: Recipient in ${recipientJurisdiction} requires accreditation.`,
        nonComplianceStatus: "NON_COMPLIANT_FORCED_SALE",
      };
    }

    const projectedRecipientBalance = recipientCurrentBalanceStroops + transferAmountStroops;
    if (projectedRecipientBalance > rule.investorCapStroops) {
      return {
        allowed: false,
        reason: `Transfer blocked: Recipient projected balance exceeds cap of ${rule.investorCapStroops} Stroops.`,
        nonComplianceStatus: "COMPLIANT",
      };
    }

    return {
      allowed: true,
      nonComplianceStatus: "COMPLIANT",
    };
  }

  /**
   * Non-punitive handling path for existing holders who become non-compliant after a rule change
   */
  public evaluateExistingPositionCompliance(
    jurisdiction: string,
    isAccredited: boolean,
    instrumentType: string,
    currentBalanceStroops: bigint,
    gracePeriodDays: number = 30
  ): EvaluationResult {
    const rule = this.getRule(jurisdiction, instrumentType);

    const isNonCompliant =
      !rule.isAllowed ||
      (rule.accreditationRequired && !isAccredited) ||
      currentBalanceStroops > rule.investorCapStroops;

    if (!isNonCompliant) {
      return {
        allowed: true,
        nonComplianceStatus: "COMPLIANT",
      };
    }

    const deadline = new Date(Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000).toISOString();

    return {
      allowed: false,
      reason: `Position is non-compliant following rule update. Active 30-day forced-sale window for divestment without instant freeze.`,
      nonComplianceStatus: "NON_COMPLIANT_FORCED_SALE",
      forcedSaleDeadline: deadline,
    };
  }
}
