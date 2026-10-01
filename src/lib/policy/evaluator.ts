/**
 * Policy Evaluation Engine
 * 
 * Central service for evaluating business rules with typed inputs/outputs.
 * Provides a consistent interface for checking limits, eligibility, and restrictions.
 */

import type {
  PolicyContext,
  PolicyResult,
  PolicyRule,
  PolicyConfig,
  PolicyViolation,
} from './types';
import { DEFAULT_POLICY_CONFIG } from './types';

export class PolicyEvaluator {
  private config: PolicyConfig;
  private rules: Map<string, PolicyRule>;

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config };
    this.rules = new Map();
  }

  registerRule(rule: PolicyRule): void {
    this.rules.set(rule.id, rule);
  }

  unregisterRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  getConfig(): Readonly<PolicyConfig> {
    return { ...this.config };
  }

  updateConfig(updates: Partial<PolicyConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  async evaluate(context: PolicyContext): Promise<PolicyResult> {
    const violations: PolicyViolation[] = [];
    let allowed = true;

    for (const rule of this.rules.values()) {
      const result = await rule.evaluate(context);
      
      if (!result.allowed) {
        allowed = false;
        
        if (result.violations) {
          violations.push(...result.violations);
        } else if (result.reason) {
          violations.push({
            rule: rule.id,
            severity: 'error',
            message: result.reason,
          });
        }
      }
    }

    return {
      allowed,
      violations: violations.length > 0 ? violations : undefined,
      metadata: {
        rulesEvaluated: this.rules.size,
        timestamp: Date.now(),
      },
    };
  }

  async evaluateRule(ruleId: string, context: PolicyContext): Promise<PolicyResult> {
    const rule = this.rules.get(ruleId);
    
    if (!rule) {
      return {
        allowed: false,
        reason: `Rule '${ruleId}' not found`,
      };
    }

    return rule.evaluate(context);
  }

  listRules(): Array<{ id: string; name: string; description: string }> {
    return Array.from(this.rules.values()).map((rule) => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
    }));
  }
}

// Global policy evaluator instance
export const globalPolicyEvaluator = new PolicyEvaluator();
