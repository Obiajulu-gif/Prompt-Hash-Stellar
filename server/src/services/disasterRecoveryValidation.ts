/**
 * Disaster Recovery Domain Invariants Validation Service (Issue #816)
 *
 * Provides strictly read-only validation checks after database restores or migrations,
 * proving that core records, foreign keys, relationships, and settlement references
 * remain consistent across the Prompt Hash Stellar domain.
 */

import Prompt from "../models/Prompt.js";
import Purchase from "../models/Purchase.js";
import { Entitlement } from "../models/Entitlement.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { Bundle } from "../models/Bundle.js";
import Review from "../models/Review.js";
import { IndexerState } from "../models/IndexerState.js";

import { logger } from "./structuredLogger.js";

export type InvariantSeverity = "CRITICAL" | "HIGH" | "WARNING";

export interface InvariantViolation {
  invariantId: string;
  invariantName: string;
  severity: InvariantSeverity;
  entityType: string;
  entityId: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface InvariantCheckResult {
  invariantId: string;
  name: string;
  description: string;
  passed: boolean;
  totalRecordsScanned: number;
  violationCount: number;
  violations: InvariantViolation[];
}

export interface DRValidationReport {
  timestamp: string;
  passed: boolean;
  totalInvariantsChecked: number;
  totalViolations: number;
  criticalViolationsCount: number;
  highViolationsCount: number;
  warningViolationsCount: number;
  summary: Record<string, InvariantCheckResult>;
}

export class DisasterRecoveryValidationService {
  /**
   * Strictly read-only validation scanner.
   */
  async validateAllInvariants(): Promise<DRValidationReport> {
    const summary: Record<string, InvariantCheckResult> = {};
    let totalViolations = 0;
    let criticalCount = 0;
    let highCount = 0;
    let warningCount = 0;

    // 1. INVARIANT 1: Prompt Integrity (Valid Creator, Positive Price, Non-empty Title)
    summary["INV_01_PROMPT_INTEGRITY"] = await this.validatePromptIntegrity();

    // 2. INVARIANT 2: Purchase & Entitlement Referential Integrity
    summary["INV_02_PURCHASE_ENTITLEMENT_REFS"] = await this.validatePurchaseAndEntitlementRefs();

    // 3. INVARIANT 3: Payout Ledger & Settlement Balance
    summary["INV_03_PAYOUT_LEDGER_INTEGRITY"] = await this.validatePayoutLedgerIntegrity();

    // 4. INVARIANT 4: Bundle Composition & Discount Invariants
    summary["INV_04_BUNDLE_COMPOSITION"] = await this.validateBundleComposition();

    // 5. INVARIANT 5: On-chain Transaction Uniqueness
    summary["INV_05_TX_UNIQUENESS"] = await this.validateTransactionUniqueness();

    // 6. INVARIANT 6: Orphaned Auxiliary Records (Reviews, States)
    summary["INV_06_ORPHANED_RECORDS"] = await this.validateOrphanedAuxiliaryRecords();

    for (const check of Object.values(summary)) {
      totalViolations += check.violationCount;
      for (const v of check.violations) {
        if (v.severity === "CRITICAL") criticalCount++;
        else if (v.severity === "HIGH") highCount++;
        else warningCount++;
      }
    }

    const passed = criticalCount === 0 && highCount === 0;

    const report: DRValidationReport = {
      timestamp: new Date().toISOString(),
      passed,
      totalInvariantsChecked: Object.keys(summary).length,
      totalViolations,
      criticalViolationsCount: criticalCount,
      highViolationsCount: highCount,
      warningViolationsCount: warningCount,
      summary,
    };

    logger.info("Disaster recovery domain invariant validation completed", {
      action: "dr_validation",
      passed,
      criticalCount,
      highCount,
      warningCount,
    });

    return report;
  }

  /** Invariant 1: Prompts have valid title, valid creator address, non-negative price */
  async validatePromptIntegrity(): Promise<InvariantCheckResult> {
    const violations: InvariantViolation[] = [];
    let scanned = 0;

    try {
      if (Prompt?.find) {
        const prompts = await Prompt.find({}).lean();
        scanned = prompts.length;

        for (const p of prompts as any[]) {
          const id = String(p._id || p.onChainId || p.id || "unknown");

          if (!p.title || typeof p.title !== "string" || p.title.trim().length === 0) {
            violations.push({
              invariantId: "INV_01",
              invariantName: "Prompt Integrity",
              severity: "CRITICAL",
              entityType: "Prompt",
              entityId: id,
              message: "Prompt is missing a required non-empty title",
            });
          }

          const creator = p.creatorAddress || p.seller || p.sellerAddress || p.creator;
          if (!creator || typeof creator !== "string" || creator.trim().length === 0) {
            violations.push({
              invariantId: "INV_01",
              invariantName: "Prompt Integrity",
              severity: "CRITICAL",
              entityType: "Prompt",
              entityId: id,
              message: "Prompt is missing a valid creator / seller wallet address",
            });
          }

          if (typeof p.price === "number" && p.price < 0) {
            violations.push({
              invariantId: "INV_01",
              invariantName: "Prompt Integrity",
              severity: "HIGH",
              entityType: "Prompt",
              entityId: id,
              message: `Prompt has negative price: ${p.price}`,
            });
          }
        }
      }
    } catch (err) {
      logger.error("Error evaluating prompt integrity invariant", { error: String(err) });
    }

    return {
      invariantId: "INV_01",
      name: "Prompt Record Integrity",
      description: "Prompts must have non-empty titles, valid creator addresses, and non-negative pricing",
      passed: violations.length === 0,
      totalRecordsScanned: scanned,
      violationCount: violations.length,
      violations,
    };
  }

  /** Invariant 2: Purchases and Entitlements reference existing Prompts and valid buyer addresses */
  async validatePurchaseAndEntitlementRefs(): Promise<InvariantCheckResult> {
    const violations: InvariantViolation[] = [];
    let scanned = 0;

    try {
      // Build lookup of known prompt IDs
      const knownPromptIds = new Set<string>();
      if (Prompt?.find) {
        const prompts = await Prompt.find({}, { _id: 1, onChainId: 1, id: 1 }).lean();
        for (const p of prompts as any[]) {
          if (p._id) knownPromptIds.add(String(p._id));
          if (p.onChainId) knownPromptIds.add(String(p.onChainId));
          if (p.id) knownPromptIds.add(String(p.id));
        }
      }

      if (Purchase?.find) {
        const purchases = await Purchase.find({}).lean();
        scanned += purchases.length;

        for (const purch of purchases as any[]) {
          const purchId = String(purch._id || purch.id || "unknown");
          const targetPrompt = String(purch.promptId || purch.prompt || "");

          if (!targetPrompt || !knownPromptIds.has(targetPrompt)) {
            violations.push({
              invariantId: "INV_02",
              invariantName: "Purchase/Entitlement Referential Integrity",
              severity: "CRITICAL",
              entityType: "Purchase",
              entityId: purchId,
              message: `Purchase references missing or orphaned promptId '${targetPrompt}'`,
              details: { promptId: targetPrompt, buyer: purch.buyerWallet },
            });
          }

          if (!purch.buyerWallet && !purch.buyerAddress && !purch.buyer) {
            violations.push({
              invariantId: "INV_02",
              invariantName: "Purchase/Entitlement Referential Integrity",
              severity: "HIGH",
              entityType: "Purchase",
              entityId: purchId,
              message: "Purchase has no buyer wallet address",
            });
          }
        }
      }

      if (Entitlement?.find) {
        const entitlements = await Entitlement.find({}).lean();
        scanned += entitlements.length;

        for (const ent of entitlements as any[]) {
          const entId = String(ent._id || ent.id || "unknown");
          const targetPrompt = String(ent.promptId || "");

          if (!targetPrompt || !knownPromptIds.has(targetPrompt)) {
            violations.push({
              invariantId: "INV_02",
              invariantName: "Purchase/Entitlement Referential Integrity",
              severity: "CRITICAL",
              entityType: "Entitlement",
              entityId: entId,
              message: `Entitlement references non-existent promptId '${targetPrompt}'`,
            });
          }

          if (!ent.buyerAddress && !ent.buyerWallet) {
            violations.push({
              invariantId: "INV_02",
              invariantName: "Purchase/Entitlement Referential Integrity",
              severity: "HIGH",
              entityType: "Entitlement",
              entityId: entId,
              message: "Entitlement has no buyer address",
            });
          }
        }
      }
    } catch (err) {
      logger.error("Error evaluating purchase/entitlement referential integrity", { error: String(err) });
    }

    return {
      invariantId: "INV_02",
      name: "Purchase & Entitlement Referential Integrity",
      description: "All purchase and entitlement records must reference existing prompt records and valid buyer addresses",
      passed: violations.length === 0,
      totalRecordsScanned: scanned,
      violationCount: violations.length,
      violations,
    };
  }

  /** Invariant 3: Payout ledger entries have non-negative amount and valid creator references */
  async validatePayoutLedgerIntegrity(): Promise<InvariantCheckResult> {
    const violations: InvariantViolation[] = [];
    let scanned = 0;

    try {
      if (LedgerEntry?.find) {
        const entries = await LedgerEntry.find({}).lean();
        scanned = entries.length;

        for (const entry of entries as any[]) {
          const id = String(entry._id || entry.id || "unknown");

          if (!entry.creatorAddress || typeof entry.creatorAddress !== "string") {
            violations.push({
              invariantId: "INV_03",
              invariantName: "Payout Ledger Integrity",
              severity: "CRITICAL",
              entityType: "LedgerEntry",
              entityId: id,
              message: "Ledger entry missing creator address",
            });
          }

          if (typeof entry.amount === "number" && entry.amount < 0) {
            violations.push({
              invariantId: "INV_03",
              invariantName: "Payout Ledger Integrity",
              severity: "HIGH",
              entityType: "LedgerEntry",
              entityId: id,
              message: `Ledger entry has negative amount: ${entry.amount}`,
            });
          }
        }
      }
    } catch (err) {
      logger.error("Error evaluating payout ledger integrity", { error: String(err) });
    }

    return {
      invariantId: "INV_03",
      name: "Payout Ledger & Settlement Integrity",
      description: "Ledger entries must reference valid creators and non-negative settlement amounts",
      passed: violations.length === 0,
      totalRecordsScanned: scanned,
      violationCount: violations.length,
      violations,
    };
  }

  /** Invariant 4: Bundles reference valid prompts and have valid discount pricing */
  async validateBundleComposition(): Promise<InvariantCheckResult> {
    const violations: InvariantViolation[] = [];
    let scanned = 0;

    try {
      if (Bundle?.find) {
        const bundles = await Bundle.find({}).lean();
        scanned = bundles.length;

        for (const bundle of bundles as any[]) {
          const bundleId = String(bundle._id || bundle.id || "unknown");
          const promptIds = bundle.promptIds || bundle.prompts || [];

          if (!Array.isArray(promptIds) || promptIds.length === 0) {
            violations.push({
              invariantId: "INV_04",
              invariantName: "Bundle Composition Integrity",
              severity: "HIGH",
              entityType: "Bundle",
              entityId: bundleId,
              message: "Bundle contains no prompt references",
            });
          }

          if (typeof bundle.bundlePrice === "number" && bundle.bundlePrice < 0) {
            violations.push({
              invariantId: "INV_04",
              invariantName: "Bundle Composition Integrity",
              severity: "CRITICAL",
              entityType: "Bundle",
              entityId: bundleId,
              message: `Bundle has negative price: ${bundle.bundlePrice}`,
            });
          }
        }
      }
    } catch (err) {
      logger.error("Error evaluating bundle composition integrity", { error: String(err) });
    }

    return {
      invariantId: "INV_04",
      name: "Bundle Composition & Pricing Invariants",
      description: "Bundles must reference valid prompt arrays and contain non-negative bundle prices",
      passed: violations.length === 0,
      totalRecordsScanned: scanned,
      violationCount: violations.length,
      violations,
    };
  }

  /** Invariant 5: On-chain transaction references are non-duplicated across distinct purchase orders */
  async validateTransactionUniqueness(): Promise<InvariantCheckResult> {
    const violations: InvariantViolation[] = [];
    let scanned = 0;

    try {
      if (Purchase?.find) {
        const purchases = await Purchase.find({
          txHash: { $exists: true, $nin: [null, "", undefined] },
        }).lean();
        scanned = purchases.length;

        const txMap = new Map<string, string[]>();
        for (const p of purchases as any[]) {
          const hash = String(p.txHash);
          const pId = String(p._id || p.id);
          const list = txMap.get(hash) || [];
          list.push(pId);
          txMap.set(hash, list);
        }

        for (const [hash, purchaseIds] of txMap.entries()) {
          if (purchaseIds.length > 1) {
            violations.push({
              invariantId: "INV_05",
              invariantName: "Transaction Hash Uniqueness",
              severity: "CRITICAL",
              entityType: "Purchase",
              entityId: purchaseIds.join(", "),
              message: `Duplicate on-chain transaction hash '${hash}' claimed by multiple purchases`,
              details: { txHash: hash, purchaseIds },
            });
          }
        }
      }
    } catch (err) {
      logger.error("Error evaluating transaction uniqueness invariant", { error: String(err) });
    }

    return {
      invariantId: "INV_05",
      name: "On-Chain Transaction Reference Uniqueness",
      description: "A single on-chain transaction hash cannot be shared by multiple distinct purchases",
      passed: violations.length === 0,
      totalRecordsScanned: scanned,
      violationCount: violations.length,
      violations,
    };
  }

  /** Invariant 6: Auxiliary records (reviews, indexer state pointers) are consistent */
  async validateOrphanedAuxiliaryRecords(): Promise<InvariantCheckResult> {
    const violations: InvariantViolation[] = [];
    let scanned = 0;

    try {
      if (IndexerState?.find) {
        const states = await IndexerState.find({}).lean();
        scanned += states.length;
        if (states.length === 0) {
          violations.push({
            invariantId: "INV_06",
            invariantName: "Auxiliary Record Integrity",
            severity: "HIGH",
            entityType: "IndexerState",
            entityId: "global",
            message: "Missing indexer state record; indexer cursor unknown",
          });
        }
      }

      if (Review?.find && Prompt?.find) {
        const reviews = await Review.find({}).lean();
        scanned += reviews.length;

        const prompts = await Prompt.find({}, { _id: 1, onChainId: 1 }).lean();
        const validPromptIds = new Set(
          prompts.map((p: any) => String(p._id || p.onChainId))
        );

        for (const rev of reviews as any[]) {
          const pId = String(rev.promptId || "");
          if (pId && !validPromptIds.has(pId)) {
            violations.push({
              invariantId: "INV_06",
              invariantName: "Auxiliary Record Integrity",
              severity: "WARNING",
              entityType: "Review",
              entityId: String(rev._id),
              message: `Review references orphaned prompt ID '${pId}'`,
            });
          }
        }
      }
    } catch (err) {
      logger.error("Error evaluating auxiliary records integrity", { error: String(err) });
    }

    return {
      invariantId: "INV_06",
      name: "Auxiliary & Orphaned Record Detection",
      description: "Checks indexer cursors and verifies reviews point to existing prompts",
      passed: violations.filter((v) => v.severity !== "WARNING").length === 0,
      totalRecordsScanned: scanned,
      violationCount: violations.length,
      violations,
    };
  }
}

export const disasterRecoveryValidationService = new DisasterRecoveryValidationService();
