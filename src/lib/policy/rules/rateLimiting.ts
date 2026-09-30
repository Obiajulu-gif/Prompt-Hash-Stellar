/**
 * Rate Limiting Policy Rules
 * 
 * Enforces request rate limits for unlocks, challenges, and API operations.
 */

import type { PolicyContext, PolicyResult, PolicyRule } from '../types';
import { globalPolicyEvaluator } from '../evaluator';

interface RateLimitContext extends PolicyContext {
  metadata: {
    unlockAttemptsInLastHour?: number;
    challengeRequestsInLastMinute?: number;
    webhookFailureCount?: number;
  };
}

export const unlockRateLimitRule: PolicyRule = {
  id: 'unlock-rate-limit',
  name: 'Unlock Rate Limit',
  description: 'Limits unlock attempts per wallet per hour',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as RateLimitContext;
    const config = globalPolicyEvaluator.getConfig();
    
    const attempts = metadata.unlockAttemptsInLastHour ?? 0;
    
    if (attempts >= config.maxUnlockAttemptsPerHour) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: `Too many unlock attempts. Limit: ${config.maxUnlockAttemptsPerHour} per hour`,
          actualValue: attempts,
          expectedValue: config.maxUnlockAttemptsPerHour,
        }],
      };
    }
    
    return { allowed: true };
  },
};

export const challengeRateLimitRule: PolicyRule = {
  id: 'challenge-rate-limit',
  name: 'Challenge Request Rate Limit',
  description: 'Limits challenge token requests per minute',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as RateLimitContext;
    const config = globalPolicyEvaluator.getConfig();
    
    const requests = metadata.challengeRequestsInLastMinute ?? 0;
    
    if (requests >= config.maxChallengeRequestsPerMinute) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: `Too many challenge requests. Limit: ${config.maxChallengeRequestsPerMinute} per minute`,
          actualValue: requests,
          expectedValue: config.maxChallengeRequestsPerMinute,
        }],
      };
    }
    
    return { allowed: true };
  },
};

export const webhookFailureThresholdRule: PolicyRule = {
  id: 'webhook-failure-threshold',
  name: 'Webhook Failure Threshold',
  description: 'Disables webhooks after excessive failures',
  
  evaluate(context: PolicyContext): PolicyResult {
    const { metadata } = context as RateLimitContext;
    const config = globalPolicyEvaluator.getConfig();
    
    const failures = metadata.webhookFailureCount ?? 0;
    
    if (failures >= config.maxWebhookFailuresBeforeDisable) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: `Webhook disabled due to ${failures} consecutive failures (threshold: ${config.maxWebhookFailuresBeforeDisable})`,
          actualValue: failures,
          expectedValue: config.maxWebhookFailuresBeforeDisable,
        }],
      };
    }
    
    return { allowed: true };
  },
};

// Auto-register rate limiting rules
globalPolicyEvaluator.registerRule(unlockRateLimitRule);
globalPolicyEvaluator.registerRule(challengeRateLimitRule);
globalPolicyEvaluator.registerRule(webhookFailureThresholdRule);
