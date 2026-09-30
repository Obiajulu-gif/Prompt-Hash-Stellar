/**
 * Content Moderation Policy Rules
 * 
 * Enforces auto-quarantine thresholds, review requirements, and content safety policies.
 */

import type { PolicyContext, PolicyResult, PolicyRule } from '../types';
import { globalPolicyEvaluator } from '../evaluator';

interface ModerationContext extends PolicyContext {
  metadata: {
    reportCount?: number;
    reviewScore?: number;
    isQuarantined?: boolean;
  };
}

export const autoQuarantineRule: PolicyRule = {
  id: 'auto-quarantine-threshold',
  name: 'Auto-Quarantine Threshold',
  description: 'Automatically quarantines prompts exceeding report threshold',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as ModerationContext;
    const config = globalPolicyEvaluator.getConfig();
    
    const reportCount = metadata.reportCount ?? 0;
    
    if (reportCount >= config.maxReportsBeforeAutoQuarantine) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: `Prompt has been auto-quarantined due to ${reportCount} reports (threshold: ${config.maxReportsBeforeAutoQuarantine})`,
          actualValue: reportCount,
          expectedValue: config.maxReportsBeforeAutoQuarantine,
        }],
      };
    }
    
    return { allowed: true };
  },
};

export const minReviewScoreRule: PolicyRule = {
  id: 'min-review-score',
  name: 'Minimum Review Score',
  description: 'Enforces minimum review score for active listings',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as ModerationContext;
    const config = globalPolicyEvaluator.getConfig();
    
    // Allow prompts with no reviews
    if (metadata.reviewScore === undefined || metadata.reviewScore === null) {
      return { allowed: true };
    }
    
    if (metadata.reviewScore < config.minReviewScoreForListing) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'warning',
          message: `Review score ${metadata.reviewScore} is below minimum of ${config.minReviewScoreForListing}`,
          actualValue: metadata.reviewScore,
          expectedValue: config.minReviewScoreForListing,
        }],
      };
    }
    
    return { allowed: true };
  },
};

export const quarantineBypassRule: PolicyRule = {
  id: 'quarantine-bypass-prevention',
  name: 'Quarantine Bypass Prevention',
  description: 'Prevents operations on quarantined content',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as ModerationContext;
    
    if (metadata.isQuarantined === true && context.action !== 'admin-review') {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: 'This content is under moderation review and cannot be accessed',
        }],
      };
    }
    
    return { allowed: true };
  },
};

// Auto-register moderation rules
globalPolicyEvaluator.registerRule(autoQuarantineRule);
globalPolicyEvaluator.registerRule(minReviewScoreRule);
globalPolicyEvaluator.registerRule(quarantineBypassRule);
