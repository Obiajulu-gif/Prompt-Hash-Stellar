import { describe, it, expect, beforeEach } from 'vitest';
import { globalPolicyEvaluator } from '../index';
import type { PolicyContext } from '../types';

describe('Policy Layer Integration', () => {
  beforeEach(() => {
    // Reset to default config for each test
    globalPolicyEvaluator.updateConfig({
      maxPromptSize: 5 * 1024 * 1024,
      maxTitleLength: 200,
      maxDescriptionLength: 5000,
      minPrice: BigInt(1_000_000),
      maxPrice: BigInt(10_000_000_000_000),
    });
  });

  describe('Prompt Creation Flow', () => {
    it('should validate complete prompt creation', async () => {
      const context: PolicyContext = {
        actor: 'GCREATOR...',
        resource: 'new-prompt',
        action: 'create',
        metadata: {
          titleLength: 50,
          descriptionLength: 300,
          contentSize: 2_000_000, // 2MB
          price: BigInt(5_000_000), // 0.5 XLM
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(true);
      expect(result.violations).toBeUndefined();
      expect(result.metadata?.rulesEvaluated).toBeGreaterThan(0);
    });

    it('should catch multiple violations in single evaluation', async () => {
      const context: PolicyContext = {
        actor: 'GCREATOR...',
        resource: 'new-prompt',
        action: 'create',
        metadata: {
          titleLength: 500, // Too long
          descriptionLength: 10_000, // Too long
          contentSize: 10_000_000, // Too large
          price: BigInt(100), // Too low
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(false);
      expect(result.violations).toBeDefined();
      expect(result.violations!.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Purchase Flow', () => {
    it('should allow first-time purchase within limits', async () => {
      const context: PolicyContext = {
        actor: 'GBUYER...',
        resource: 'prompt-123',
        action: 'purchase',
        metadata: {
          buyerWallet: 'GBUYER...',
          promptId: 'prompt-123',
          existingPurchaseCount: 0,
          dailyPurchaseCount: 5,
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(true);
    });

    it('should prevent duplicate purchase', async () => {
      const context: PolicyContext = {
        actor: 'GBUYER...',
        resource: 'prompt-123',
        action: 'purchase',
        metadata: {
          buyerWallet: 'GBUYER...',
          promptId: 'prompt-123',
          existingPurchaseCount: 1,
          dailyPurchaseCount: 5,
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(false);
      expect(result.violations?.some(v => v.rule === 'duplicate-purchase-prevention')).toBe(true);
    });

    it('should prevent excessive daily purchases', async () => {
      const config = globalPolicyEvaluator.getConfig();
      const context: PolicyContext = {
        actor: 'GBUYER...',
        resource: 'prompt-456',
        action: 'purchase',
        metadata: {
          buyerWallet: 'GBUYER...',
          promptId: 'prompt-456',
          existingPurchaseCount: 0,
          dailyPurchaseCount: config.maxDailyPurchasesPerWallet,
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(false);
      expect(result.violations?.some(v => v.rule === 'daily-purchase-limit')).toBe(true);
    });
  });

  describe('Bundle Creation Flow', () => {
    it('should validate valid bundle', async () => {
      const context: PolicyContext = {
        actor: 'GCREATOR...',
        resource: 'bundle-789',
        action: 'create',
        metadata: {
          promptCount: 5,
          discountPercentage: 15,
          totalPrice: BigInt(42_500_000),
          individualPricesSum: BigInt(50_000_000),
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(true);
    });

    it('should reject invalid bundle configuration', async () => {
      const context: PolicyContext = {
        actor: 'GCREATOR...',
        resource: 'bundle-bad',
        action: 'create',
        metadata: {
          promptCount: 1, // Too few
          discountPercentage: 2, // Too low
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(false);
      expect(result.violations!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce unlock rate limits', async () => {
      const config = globalPolicyEvaluator.getConfig();
      const context: PolicyContext = {
        actor: 'GBUYER...',
        resource: 'prompt-123',
        action: 'unlock',
        metadata: {
          unlockAttemptsInLastHour: config.maxUnlockAttemptsPerHour,
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(false);
      expect(result.violations?.some(v => v.rule === 'unlock-rate-limit')).toBe(true);
    });
  });

  describe('Content Moderation', () => {
    it('should block access to quarantined prompts', async () => {
      const context: PolicyContext = {
        actor: 'GBUYER...',
        resource: 'prompt-bad',
        action: 'unlock',
        metadata: {
          isQuarantined: true,
          reportCount: 10,
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(false);
      expect(result.violations?.some(v => v.message.includes('moderation'))).toBe(true);
    });
  });

  describe('Configuration Management', () => {
    it('should respect configuration updates', async () => {
      // Tighten size limit
      globalPolicyEvaluator.updateConfig({
        maxPromptSize: 1_000_000, // 1MB
      });

      const context: PolicyContext = {
        actor: 'GCREATOR...',
        resource: 'prompt-large',
        action: 'create',
        metadata: {
          contentSize: 2_000_000, // 2MB - now too large
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(false);
      expect(result.violations?.some(v => v.rule === 'prompt-size-limit')).toBe(true);
    });
  });

  describe('Policy Rule Listing', () => {
    it('should list all registered rules', () => {
      const rules = globalPolicyEvaluator.listRules();

      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some(r => r.id === 'prompt-size-limit')).toBe(true);
      expect(rules.some(r => r.id === 'duplicate-purchase-prevention')).toBe(true);
      expect(rules.some(r => r.id === 'bundle-size-limit')).toBe(true);
      expect(rules.some(r => r.id === 'unlock-rate-limit')).toBe(true);
      expect(rules.some(r => r.id === 'auto-quarantine-threshold')).toBe(true);
    });
  });

  describe('Error Messages', () => {
    it('should provide user-safe error messages', async () => {
      const context: PolicyContext = {
        actor: 'GCREATOR...',
        resource: 'prompt-test',
        action: 'create',
        metadata: {
          price: BigInt(100), // Too low
        },
      };

      const result = await globalPolicyEvaluator.evaluate(context);

      expect(result.allowed).toBe(false);
      expect(result.violations?.[0].message).toBeDefined();
      expect(result.violations?.[0].message).not.toContain('undefined');
      expect(result.violations?.[0].message).not.toContain('null');
    });
  });
});
