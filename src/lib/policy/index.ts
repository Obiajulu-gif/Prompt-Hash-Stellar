/**
 * Policy Layer - Central Business Rules Engine
 * 
 * Exports the main policy evaluator and all rule sets.
 * Import this module to access the global policy system.
 */

export { PolicyEvaluator, globalPolicyEvaluator } from './evaluator';
export type {
  PolicyContext,
  PolicyResult,
  PolicyRule,
  PolicyConfig,
  PolicyViolation,
} from './types';
export { DEFAULT_POLICY_CONFIG } from './types';

// Import all rule modules to trigger auto-registration
import './rules/promptListing';
import './rules/purchase';
import './rules/rateLimiting';
import './rules/bundles';
import './rules/moderation';
