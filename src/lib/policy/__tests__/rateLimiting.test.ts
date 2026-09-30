import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../evaluator';
import {
  unlockRateLimitRule,
  challengeRateLimitRule,
  webhookFailureThresholdRule,
} from '../rules/rateLimiting';
import type { PolicyContext } from '../types';

describe('Rate Limiting Rules', () => {
  let evaluator: PolicyEvaluator;

  beforeEach(() => {
    evaluator = new PolicyEvaluator();
    evaluator.registerRule(unlockRateLimitRule);
    evaluator.registerRule(challengeRateLimitRule);
    evaluator.registerRule(webhookFailureThresholdRule);
  });

  describe('unlockRateLimitRule', () => {
    it('should allow unlocks within rate limit', () => {
      const context: PolicyContext = {
        actor: 'buyer',
        resource: 'prompt-123',
        action: 'unlock',
        metadata: { unlockAttemptsInLastHour: 5 },
      };

      const result = evaluator.evaluateRule('unlock-rate-limit', context);
      expect(result.allowed).toBe(true);
    });

    it('should block unlocks at rate limit threshold', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'buyer',
        resource: 'prompt-123',
        action: 'unlock',
        metadata: { unlockAttemptsInLastHour: config.maxUnlockAttemptsPerHour },
      };

      const result = evaluator.evaluateRule('unlock-rate-limit', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('Too many unlock attempts');
    });

    it('should allow unlocks when no attempts recorded', () => {
      const context: PolicyContext = {
        actor: 'buyer',
        resource: 'prompt-123',
        action: 'unlock',
        metadata: {},
      };

      const result = evaluator.evaluateRule('unlock-rate-limit', context);
      expect(result.allowed).toBe(true);
    });
  });

  describe('challengeRateLimitRule', () => {
    it('should allow challenge requests within limit', () => {
      const context: PolicyContext = {
        actor: 'user',
        resource: 'challenge',
        action: 'request',
        metadata: { challengeRequestsInLastMinute: 3 },
      };

      const result = evaluator.evaluateRule('challenge-rate-limit', context);
      expect(result.allowed).toBe(true);
    });

    it('should block excessive challenge requests', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'user',
        resource: 'challenge',
        action: 'request',
        metadata: { challengeRequestsInLastMinute: config.maxChallengeRequestsPerMinute },
      };

      const result = evaluator.evaluateRule('challenge-rate-limit', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('Too many challenge requests');
    });
  });

  describe('webhookFailureThresholdRule', () => {
    it('should allow webhook with few failures', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'webhook-123',
        action: 'deliver',
        metadata: { webhookFailureCount: 3 },
      };

      const result = evaluator.evaluateRule('webhook-failure-threshold', context);
      expect(result.allowed).toBe(true);
    });

    it('should disable webhook at failure threshold', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'webhook-123',
        action: 'deliver',
        metadata: { webhookFailureCount: config.maxWebhookFailuresBeforeDisable },
      };

      const result = evaluator.evaluateRule('webhook-failure-threshold', context);
      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toContain('disabled due to');
    });

    it('should allow webhook with zero failures', () => {
      const context: PolicyContext = {
        actor: 'creator',
        resource: 'webhook-123',
        action: 'deliver',
        metadata: { webhookFailureCount: 0 },
      };

      const result = evaluator.evaluateRule('webhook-failure-threshold', context);
      expect(result.allowed).toBe(true);
    });
  });

  describe('boundary conditions', () => {
    it('should handle exactly at threshold minus one', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'user',
        resource: 'test',
        action: 'test',
        metadata: { unlockAttemptsInLastHour: config.maxUnlockAttemptsPerHour - 1 },
      };

      const result = evaluator.evaluateRule('unlock-rate-limit', context);
      expect(result.allowed).toBe(true);
    });

    it('should handle exactly at threshold', () => {
      const config = evaluator.getConfig();
      const context: PolicyContext = {
        actor: 'user',
        resource: 'test',
        action: 'test',
        metadata: { unlockAttemptsInLastHour: config.maxUnlockAttemptsPerHour },
      };

      const result = evaluator.evaluateRule('unlock-rate-limit', context);
      expect(result.allowed).toBe(false);
    });
  });
});
