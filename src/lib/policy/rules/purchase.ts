/**
 * Purchase Policy Rules
 * 
 * Enforces purchase limits, duplicate prevention, and buyer eligibility.
 */

import type { PolicyContext, PolicyResult, PolicyRule } from '../types';
import { globalPolicyEvaluator } from '../evaluator';

interface PurchaseContext extends PolicyContext {
  metadata: {
    buyerWallet: string;
    promptId: string;
    existingPurchaseCount?: number;
    dailyPurchaseCount?: number;
  };
}

export const duplicatePurchaseRule: PolicyRule = {
  id: 'duplicate-purchase-prevention',
  name: 'Duplicate Purchase Prevention',
  description: 'Prevents buyers from purchasing the same prompt multiple times',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as PurchaseContext;
    const config = globalPolicyEvaluator.getConfig();
    
    const existingCount = metadata.existingPurchaseCount ?? 0;
    
    if (existingCount >= config.maxPurchasesPerPromptPerWallet) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: 'You have already purchased this prompt',
        }],
      };
    }
    
    return { allowed: true };
  },
};

export const dailyPurchaseLimitRule: PolicyRule = {
  id: 'daily-purchase-limit',
  name: 'Daily Purchase Limit',
  description: 'Limits number of purchases per wallet per day',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as PurchaseContext;
    const config = globalPolicyEvaluator.getConfig();
    
    const dailyCount = metadata.dailyPurchaseCount ?? 0;
    
    if (dailyCount >= config.maxDailyPurchasesPerWallet) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: `Daily purchase limit of ${config.maxDailyPurchasesPerWallet} reached`,
          actualValue: dailyCount,
          expectedValue: config.maxDailyPurchasesPerWallet,
        }],
      };
    }
    
    return { allowed: true };
  },
};

// Auto-register purchase rules
globalPolicyEvaluator.registerRule(duplicatePurchaseRule);
globalPolicyEvaluator.registerRule(dailyPurchaseLimitRule);
