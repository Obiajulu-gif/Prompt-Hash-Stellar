import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../evaluator';
import {
  promptSizeLimitRule,
  promptPricingRule,
  promptMetadataLengthRule,
} from '../rules/promptListing';
import type { PolicyContext } from '../types';

describe('Prompt Listing Rules', () => {
  let evaluator: PolicyEvaluator;

  beforeEach(() => {
    evaluator = new PolicyEvaluator();
    evaluator.registerRule(promptSizeLimitRule);
    evaluator.registerRule(promptPricingRule);
    evaluator.registerRule(promptMetadataLengthRule);
  });

  describe('promptSizeLimitRule', () => {
    it('should allow content within size limit', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: { contentSize: 1024 * 1024 }, // 1MB
      };

      const result = evaluator.evaluateRule('prompt-size-limit', context);
      expect(result.allowed).toBe(true);
    });

    it('should reject content at exact limit boundary', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: { contentSize: config.maxPromptSize },
      };

      const result = evaluator.evaluateRule('prompt-size-limit', context);
      expect(result.allowed).toBe(true);
    });

    it('should reject content exceeding size limit', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: { contentSize: config.maxPromptSize + 1 },
      };

      const result = evaluator.evaluateRule('prompt-size-limit', context);
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations?.[0].message).toContain('exceeds maximum size');
    });
  });

  describe('promptPricingRule', () => {
    it('should allow price within valid range', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: { price: BigInt(5_000_000) }, // 0.5 XLM
      };

      const result = evaluator.evaluateRule('prompt-pricing', context);
      expect(result.allowed).toBe(true);
    });

    it('should reject price below minimum', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: { price: BigInt(100) }, // Too low
      };

      const result = evaluator.evaluateRule('prompt-pricing', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('below minimum');
    });

    it('should reject price above maximum', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: { price: config.maxPrice + BigInt(1) },
      };

      const result = evaluator.evaluateRule('prompt-pricing', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('exceeds maximum');
    });

    it('should reject missing price', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: {},
      };

      const result = evaluator.evaluateRule('prompt-pricing', context);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Price is required');
    });
  });

  describe('promptMetadataLengthRule', () => {
    it('should allow metadata within limits', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: {
          titleLength: 50,
          descriptionLength: 500,
        },
      };

      const result = evaluator.evaluateRule('prompt-metadata-length', context);
      expect(result.allowed).toBe(true);
    });

    it('should reject title exceeding limit', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: {
          titleLength: config.maxTitleLength + 1,
        },
      };

      const result = evaluator.evaluateRule('prompt-metadata-length', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('Title exceeds');
    });

    it('should reject description exceeding limit', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: {
          descriptionLength: config.maxDescriptionLength + 1,
        },
      };

      const result = evaluator.evaluateRule('prompt-metadata-length', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('Description exceeds');
    });

    it('should report multiple violations', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'prompt-123',
        action: 'create',
        metadata: {
          titleLength: config.maxTitleLength + 1,
          descriptionLength: config.maxDescriptionLength + 1,
        },
      };

      const result = evaluator.evaluateRule('prompt-metadata-length', context);
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(2);
    });
  });
});
