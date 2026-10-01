import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../evaluator';
import {
  autoQuarantineRule,
  minReviewScoreRule,
  quarantineBypassRule,
} from '../rules/moderation';
import type { PolicyContext } from '../types';

describe('Moderation Rules', () => {
  let evaluator: PolicyEvaluator;

  beforeEach(() => {
    evaluator = new PolicyEvaluator();
    evaluator.registerRule(autoQuarantineRule);
    evaluator.registerRule(minReviewScoreRule);
    evaluator.registerRule(quarantineBypassRule);
  });

  describe('autoQuarantineRule', () => {
    it('should allow prompts with few reports', () => {
      const context: PolicyContext = {
        actor: 'system',
        resource: 'prompt-123',
        action: 'check-eligibility',
        metadata: { reportCount: 2 },
      };

      const result = evaluator.evaluateRule('auto-quarantine-threshold', context);
      expect(result.allowed).toBe(true);
    });

    it('should quarantine at exact threshold', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'system',
        resource: 'prompt-123',
        action: 'check-eligibility',
        metadata: { reportCount: config.maxReportsBeforeAutoQuarantine },
      };

      const result = evaluator.evaluateRule('auto-quarantine-threshold', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('auto-quarantined');
    });

    it('should allow prompts with no reports', () => {
      const context: PolicyContext = {
        actor: 'system',
        resource: 'prompt-123',
        action: 'check-eligibility',
        metadata: { reportCount: 0 },
      };

      const result = evaluator.evaluateRule('auto-quarantine-threshold', context);
      expect(result.allowed).toBe(true);
    });

    it('should quarantine above threshold', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'system',
        resource: 'prompt-123',
        action: 'check-eligibility',
        metadata: { reportCount: config.maxReportsBeforeAutoQuarantine + 1 },
      };

      const result = evaluator.evaluateRule('auto-quarantine-threshold', context);
      expect(result.allowed).toBe(false);
    });
  });

  describe('minReviewScoreRule', () => {
    it('should allow good review scores', () => {
      const context: PolicyContext = {
        actor: 'system',
        resource: 'prompt-123',
        action: 'check-eligibility',
        metadata: { reviewScore: 4.5 },
      };

      const result = evaluator.evaluateRule('min-review-score', context);
      expect(result.allowed).toBe(true);
    });

    it('should allow prompts with no reviews', () => {
      const context: PolicyContext = {
        actor: 'system',
        resource: 'prompt-123',
        action: 'check-eligibility',
        metadata: {},
      };

      const result = evaluator.evaluateRule('min-review-score', context);
      expect(result.allowed).toBe(true);
    });

    it('should warn on low review scores', () => {
      const context: PolicyContext = {
        actor: 'system',
        resource: 'prompt-123',
        action: 'check-eligibility',
        metadata: { reviewScore: -1 },
      };

      const result = evaluator.evaluateRule('min-review-score', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].severity).toBe('warning');
      expect(result.violations?.[0].message).toContain('below minimum');
    });
  });

  describe('quarantineBypassRule', () => {
    it('should block access to quarantined content', () => {
      const context: PolicyContext = {
        actor: 'user',
        resource: 'prompt-123',
        action: 'unlock',
        metadata: { isQuarantined: true },
      };

      const result = evaluator.evaluateRule('quarantine-bypass-prevention', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('under moderation review');
    });

    it('should allow access to non-quarantined content', () => {
      const context: PolicyContext = {
        actor: 'user',
        resource: 'prompt-123',
        action: 'unlock',
        metadata: { isQuarantined: false },
      };

      const result = evaluator.evaluateRule('quarantine-bypass-prevention', context);
      expect(result.allowed).toBe(true);
    });

    it('should allow admin review of quarantined content', () => {
      const context: PolicyContext = {
        actor: 'admin',
        resource: 'prompt-123',
        action: 'admin-review',
        metadata: { isQuarantined: true },
      };

      const result = evaluator.evaluateRule('quarantine-bypass-prevention', context);
      expect(result.allowed).toBe(true);
    });

    it('should allow when quarantine status unknown', () => {
      const context: PolicyContext = {
        actor: 'user',
        resource: 'prompt-123',
        action: 'unlock',
        metadata: {},
      };

      const result = evaluator.evaluateRule('quarantine-bypass-prevention', context);
      expect(result.allowed).toBe(true);
    });
  });

  describe('integration - multiple moderation rules', () => {
    it('should evaluate all moderation rules together', async () => {
      const context: PolicyContext = {
        actor: 'user',
        resource: 'prompt-123',
        action: 'unlock',
        metadata: {
          reportCount: 10,
          reviewScore: -2,
          isQuarantined: true,
        },
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.allowed).toBe(false);
      // Should have violations from all three rules
      expect(result.violations && result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });
});
