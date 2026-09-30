import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../evaluator';
import type { PolicyContext, PolicyRule } from '../types';

describe('PolicyEvaluator', () => {
  let evaluator: PolicyEvaluator;

  beforeEach(() => {
    evaluator = new PolicyEvaluator();
  });

  it('should register and list rules', () => {
    const rule: PolicyRule = {
      id: 'test-rule',
      name: 'Test Rule',
      description: 'Test rule description',
      evaluate: () => ({ allowed: true }),
    };

    evaluator.registerRule(rule);
    const rules = evaluator.listRules();

    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('test-rule');
  });

  it('should evaluate all registered rules', async () => {
    const rule1: PolicyRule = {
      id: 'rule-1',
      name: 'Rule 1',
      description: 'First rule',
      evaluate: () => ({ allowed: true }),
    };

    const rule2: PolicyRule = {
      id: 'rule-2',
      name: 'Rule 2',
      description: 'Second rule',
      evaluate: () => ({
        allowed: false,
        violations: [{
          rule: 'rule-2',
          severity: 'error',
          message: 'Rule 2 failed',
        }],
      }),
    };

    evaluator.registerRule(rule1);
    evaluator.registerRule(rule2);

    const context: PolicyContext = {
      actor: 'test-wallet',
      resource: 'prompt-123',
      action: 'create',
    };

    const result = await evaluator.evaluate(context);

    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations?.[0].message).toBe('Rule 2 failed');
  });

  it('should allow when all rules pass', async () => {
    const rule: PolicyRule = {
      id: 'passing-rule',
      name: 'Passing Rule',
      description: 'Always passes',
      evaluate: () => ({ allowed: true }),
    };

    evaluator.registerRule(rule);

    const context: PolicyContext = {
      actor: 'test-wallet',
      resource: 'prompt-123',
      action: 'create',
    };

    const result = await evaluator.evaluate(context);

    expect(result.allowed).toBe(true);
    expect(result.violations).toBeUndefined();
  });

  it('should evaluate specific rule by ID', async () => {
    const rule: PolicyRule = {
      id: 'specific-rule',
      name: 'Specific Rule',
      description: 'Test specific evaluation',
      evaluate: () => ({ allowed: false, reason: 'Failed' }),
    };

    evaluator.registerRule(rule);

    const context: PolicyContext = {
      actor: 'test-wallet',
      resource: 'prompt-123',
      action: 'create',
    };

    const result = await evaluator.evaluateRule('specific-rule', context);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Failed');
  });

  it('should return error for non-existent rule', async () => {
    const context: PolicyContext = {
      actor: 'test-wallet',
      resource: 'prompt-123',
      action: 'create',
    };

    const result = await evaluator.evaluateRule('non-existent', context);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('should support config updates', () => {
    const initialConfig = evaluator.getConfig();
    expect(initialConfig.maxPromptSize).toBe(5 * 1024 * 1024);

    evaluator.updateConfig({ maxPromptSize: 10 * 1024 * 1024 });

    const updatedConfig = evaluator.getConfig();
    expect(updatedConfig.maxPromptSize).toBe(10 * 1024 * 1024);
  });

  it('should unregister rules', () => {
    const rule: PolicyRule = {
      id: 'temp-rule',
      name: 'Temp Rule',
      description: 'Temporary rule',
      evaluate: () => ({ allowed: true }),
    };

    evaluator.registerRule(rule);
    expect(evaluator.listRules()).toHaveLength(1);

    evaluator.unregisterRule('temp-rule');
    expect(evaluator.listRules()).toHaveLength(0);
  });
});
