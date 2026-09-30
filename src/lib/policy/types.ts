/**
 * Policy Layer Type Definitions
 * 
 * Centralized type system for business rule evaluation across the platform.
 * Supports configurable limits, eligibility checks, and threshold enforcement.
 */

export interface PolicyContext {
  actor: string;
  resource: string;
  action: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  violations?: PolicyViolation[];
  metadata?: Record<string, unknown>;
}

export interface PolicyViolation {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  actualValue?: unknown;
  expectedValue?: unknown;
}

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  evaluate(context: PolicyContext): Promise<PolicyResult> | PolicyResult;
}

export interface PolicyConfig {
  // Prompt listing limits
  maxPromptSize: number; // bytes
  maxTitleLength: number;
  maxDescriptionLength: number;
  minPrice: bigint; // stroops
  maxPrice: bigint; // stroops
  
  // Purchase limits
  maxDailyPurchasesPerWallet: number;
  maxPurchasesPerPromptPerWallet: number;
  
  // Creator eligibility
  minWalletAge: number; // milliseconds
  requireVerifiedEmail: boolean;
  
  // Content moderation
  maxReportsBeforeAutoQuarantine: number;
  minReviewScoreForListing: number;
  
  // Rate limits
  maxUnlockAttemptsPerHour: number;
  maxChallengeRequestsPerMinute: number;
  
  // Webhook policies
  maxWebhookFailuresBeforeDisable: number;
  webhookTimeoutMs: number;
  
  // Bundle policies
  maxPromptsPerBundle: number;
  minBundleDiscount: number; // percentage
  maxBundleDiscount: number; // percentage
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  maxPromptSize: 5 * 1024 * 1024, // 5MB
  maxTitleLength: 200,
  maxDescriptionLength: 5000,
  minPrice: BigInt(1_000_000), // 0.1 XLM
  maxPrice: BigInt(10_000_000_000_000), // 1M XLM
  
  maxDailyPurchasesPerWallet: 100,
  maxPurchasesPerPromptPerWallet: 1,
  
  minWalletAge: 24 * 60 * 60 * 1000, // 24 hours
  requireVerifiedEmail: false,
  
  maxReportsBeforeAutoQuarantine: 5,
  minReviewScoreForListing: 0,
  
  maxUnlockAttemptsPerHour: 20,
  maxChallengeRequestsPerMinute: 10,
  
  maxWebhookFailuresBeforeDisable: 10,
  webhookTimeoutMs: 30_000,
  
  maxPromptsPerBundle: 50,
  minBundleDiscount: 5,
  maxBundleDiscount: 50,
};
