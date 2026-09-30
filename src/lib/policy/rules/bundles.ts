/**
 * Bundle Policy Rules
 * 
 * Enforces bundle composition limits, discount ranges, and bundle-specific eligibility.
 */

import type { PolicyContext, PolicyResult, PolicyRule, PolicyViolation } from '../types';
import { globalPolicyEvaluator } from '../evaluator';

interface BundleContext extends PolicyContext {
  metadata: {
    promptCount?: number;
    discountPercentage?: number;
    totalPrice?: bigint;
    individualPricesSum?: bigint;
  };
}

export const bundleSizeLimitRule: PolicyRule = {
  id: 'bundle-size-limit',
  name: 'Bundle Size Limit',
  description: 'Enforces maximum number of prompts per bundle',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as BundleContext;
    const config = globalPolicyEvaluator.getConfig();
    
    const count = metadata.promptCount ?? 0;
    
    if (count > config.maxPromptsPerBundle) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: `Bundle cannot contain more than ${config.maxPromptsPerBundle} prompts`,
          actualValue: count,
          expectedValue: config.maxPromptsPerBundle,
        }],
      };
    }
    
    if (count < 2) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: 'Bundle must contain at least 2 prompts',
          actualValue: count,
          expectedValue: 2,
        }],
      };
    }
    
    return { allowed: true };
  },
};

export const bundleDiscountRangeRule: PolicyRule = {
  id: 'bundle-discount-range',
  name: 'Bundle Discount Range',
  description: 'Enforces minimum and maximum discount percentages',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as BundleContext;
    const config = globalPolicyEvaluator.getConfig();
    const violations: PolicyViolation[] = [];
    
    if (metadata.discountPercentage === undefined) {
      return {
        allowed: false,
        reason: 'Discount percentage is required for bundles',
      };
    }
    
    if (metadata.discountPercentage < config.minBundleDiscount) {
      violations.push({
        rule: this.id,
        severity: 'error',
        message: `Bundle discount must be at least ${config.minBundleDiscount}%`,
        actualValue: metadata.discountPercentage,
        expectedValue: config.minBundleDiscount,
      });
    }
    
    if (metadata.discountPercentage > config.maxBundleDiscount) {
      violations.push({
        rule: this.id,
        severity: 'error',
        message: `Bundle discount cannot exceed ${config.maxBundleDiscount}%`,
        actualValue: metadata.discountPercentage,
        expectedValue: config.maxBundleDiscount,
      });
    }
    
    return {
      allowed: violations.length === 0,
      violations: violations.length > 0 ? violations : undefined,
    };
  },
};

export const bundlePricingConsistencyRule: PolicyRule = {
  id: 'bundle-pricing-consistency',
  name: 'Bundle Pricing Consistency',
  description: 'Ensures bundle price matches individual prices with discount applied',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as BundleContext;
    
    if (!metadata.totalPrice || !metadata.individualPricesSum || !metadata.discountPercentage) {
      return { allowed: true }; // Skip if required data not provided
    }
    
    const expectedPrice = metadata.individualPricesSum * BigInt(100 - metadata.discountPercentage) / BigInt(100);
    const actualPrice = metadata.totalPrice;
    
    // Allow 1% tolerance for rounding
    const tolerance = metadata.individualPricesSum / BigInt(100);
    const difference = actualPrice > expectedPrice ? actualPrice - expectedPrice : expectedPrice - actualPrice;
    
    if (difference > tolerance) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: 'Bundle price does not match individual prices with discount applied',
          actualValue: actualPrice.toString(),
          expectedValue: expectedPrice.toString(),
        }],
      };
    }
    
    return { allowed: true };
  },
};

// Auto-register bundle rules
globalPolicyEvaluator.registerRule(bundleSizeLimitRule);
globalPolicyEvaluator.registerRule(bundleDiscountRangeRule);
globalPolicyEvaluator.registerRule(bundlePricingConsistencyRule);
