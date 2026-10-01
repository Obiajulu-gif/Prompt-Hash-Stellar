import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../evaluator';
import {
  bundleSizeLimitRule,
  bundleDiscountRangeRule,
  bundlePricingConsistencyRule,
} from '../rules/bundles';
import type { PolicyContext } from '../types';

describe('Bundle Rules', () => {
  let evaluator: PolicyEvaluator;

  beforeEach(() => {
    evaluator = new PolicyEvaluator();
    evaluator.registerRule(bundleSizeLimitRule);
    evaluator.registerRule(bundleDiscountRangeRule);
    evaluator.registerRule(bundlePricingConsistencyRule);
  });

  describe('bundleSizeLimitRule', () => {
    it('should allow valid bundle size', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: { promptCount: 5 },
      };

      const result = evaluator.evaluateRule('bundle-size-limit', context);
      expect(result.allowed).toBe(true);
    });

    it('should reject bundle with too many prompts', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: { promptCount: config.maxPromptsPerBundle + 1 },
      };

      const result = evaluator.evaluateRule('bundle-size-limit', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('cannot contain more than');
    });

    it('should reject bundle with single prompt', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: { promptCount: 1 },
      };

      const result = evaluator.evaluateRule('bundle-size-limit', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('at least 2 prompts');
    });

    it('should allow minimum valid bundle size', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: { promptCount: 2 },
      };

      const result = evaluator.evaluateRule('bundle-size-limit', context);
      expect(result.allowed).toBe(true);
    });
  });

  describe('bundleDiscountRangeRule', () => {
    it('should allow valid discount percentage', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: { discountPercentage: 15 },
      };

      const result = evaluator.evaluateRule('bundle-discount-range', context);
      expect(result.allowed).toBe(true);
    });

    it('should reject discount below minimum', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: { discountPercentage: config.minBundleDiscount - 1 },
      };

      const result = evaluator.evaluateRule('bundle-discount-range', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('at least');
    });

    it('should reject discount above maximum', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: { discountPercentage: config.maxBundleDiscount + 1 },
      };

      const result = evaluator.evaluateRule('bundle-discount-range', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('cannot exceed');
    });

    it('should reject missing discount', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: {},
      };

      const result = evaluator.evaluateRule('bundle-discount-range', context);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('required');
    });
  });

  describe('bundlePricingConsistencyRule', () => {
    it('should allow correct bundle pricing', () => {
      const individualSum = BigInt(10_000_000); // 1 XLM total
      const discount = 10; // 10%
      const bundlePrice = BigInt(9_000_000); // 0.9 XLM

      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: {
          totalPrice: bundlePrice,
          individualPricesSum: individualSum,
          discountPercentage: discount,
        },
      };

      const result = evaluator.evaluateRule('bundle-pricing-consistency', context);
      expect(result.allowed).toBe(true);
    });

    it('should reject inconsistent bundle pricing', () => {
      const individualSum = BigInt(10_000_000); // 1 XLM total
      const discount = 10; // 10%
      const wrongPrice = BigInt(5_000_000); // Wrong price

      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: {
          totalPrice: wrongPrice,
          individualPricesSum: individualSum,
          discountPercentage: discount,
        },
      };

      const result = evaluator.evaluateRule('bundle-pricing-consistency', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('does not match');
    });

    it('should skip validation when data incomplete', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: { totalPrice: BigInt(5_000_000) },
      };

      const result = evaluator.evaluateRule('bundle-pricing-consistency', context);
      expect(result.allowed).toBe(true);
    });

    it('should handle rounding tolerance', () => {
      const individualSum = BigInt(10_000_003);
      const discount = 10;
      // Expected: 9,000,002.7 → rounds to 9,000,003
      const bundlePrice = BigInt(9_000_003);

      const context: PolicyContext = {
        actor: 'creator',
        resource: 'bundle-123',
        action: 'create',
        metadata: {
          totalPrice: bundlePrice,
          individualPricesSum: individualSum,
          discountPercentage: discount,
        },
      };

      const result = evaluator.evaluateRule('bundle-pricing-consistency', context);
      expect(result.allowed).toBe(true);
    });
  });
});
