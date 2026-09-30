/**
 * Prompt Listing Policy Rules
 * 
 * Enforces size limits, pricing bounds, and content requirements for new listings.
 */

import type { PolicyContext, PolicyResult, PolicyRule, PolicyViolation } from '../types';
import { globalPolicyEvaluator } from '../evaluator';

interface PromptListingContext extends PolicyContext {
  metadata: {
    titleLength?: number;
    descriptionLength?: number;
    contentSize?: number;
    price?: bigint | string | number;
  };
}

export const promptSizeLimitRule: PolicyRule = {
  id: 'prompt-size-limit',
  name: 'Prompt Size Limit',
  description: 'Enforces maximum prompt content size',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as PromptListingContext;
    const config = globalPolicyEvaluator.getConfig();
    
    const contentSize = metadata.contentSize ?? 0;
    
    if (contentSize > config.maxPromptSize) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: `Prompt content exceeds maximum size of ${config.maxPromptSize} bytes`,
          actualValue: contentSize,
          expectedValue: config.maxPromptSize,
        }],
      };
    }
    
    return { allowed: true };
  },
};

export const promptPricingRule: PolicyRule = {
  id: 'prompt-pricing',
  name: 'Prompt Pricing Range',
  description: 'Enforces minimum and maximum price limits',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as PromptListingContext;
    const config = globalPolicyEvaluator.getConfig();
    
    if (!metadata.price) {
      return {
        allowed: false,
        reason: 'Price is required',
      };
    }
    
    const price = BigInt(metadata.price);
    const violations: PolicyViolation[] = [];
    
    if (price < config.minPrice) {
      violations.push({
        rule: this.id,
        severity: 'error',
        message: `Price below minimum of ${config.minPrice} stroops`,
        actualValue: price.toString(),
        expectedValue: config.minPrice.toString(),
      });
    }
    
    if (price > config.maxPrice) {
      violations.push({
        rule: this.id,
        severity: 'error',
        message: `Price exceeds maximum of ${config.maxPrice} stroops`,
        actualValue: price.toString(),
        expectedValue: config.maxPrice.toString(),
      });
    }
    
    return {
      allowed: violations.length === 0,
      violations: violations.length > 0 ? violations : undefined,
    };
  },
};

export const promptMetadataLengthRule: PolicyRule = {
  id: 'prompt-metadata-length',
  name: 'Prompt Metadata Length',
  description: 'Enforces title and description length limits',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as PromptListingContext;
    const config = globalPolicyEvaluator.getConfig();
    const violations: PolicyViolation[] = [];
    
    if (metadata.titleLength && metadata.titleLength > config.maxTitleLength) {
      violations.push({
        rule: this.id,
        severity: 'error',
        message: `Title exceeds maximum length of ${config.maxTitleLength} characters`,
        actualValue: metadata.titleLength,
        expectedValue: config.maxTitleLength,
      });
    }
    
    if (metadata.descriptionLength && metadata.descriptionLength > config.maxDescriptionLength) {
      violations.push({
        rule: this.id,
        severity: 'error',
        message: `Description exceeds maximum length of ${config.maxDescriptionLength} characters`,
        actualValue: metadata.descriptionLength,
        expectedValue: config.maxDescriptionLength,
      });
    }
    
    return {
      allowed: violations.length === 0,
      violations: violations.length > 0 ? violations : undefined,
    };
  },
};

// Auto-register prompt listing rules
globalPolicyEvaluator.registerRule(promptSizeLimitRule);
globalPolicyEvaluator.registerRule(promptPricingRule);
globalPolicyEvaluator.registerRule(promptMetadataLengthRule);
