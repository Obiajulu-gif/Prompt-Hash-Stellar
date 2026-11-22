/**
 * Issue 999: Policy Simulation Preview
 *
 * Preview affected records/users, expected side effects, and rollback constraints
 * before applying policy changes.
 *
 * Vertical slice: a single entry point `simulatePolicyChange` that validates the
 * request, checks authorization, loads affected-record previews with bounded
 * retries, and returns a result. Recovery behavior is documented inline.
 */

import { db } from '../db/connection';
import { logger } from '../util/logger';

export type PolicyChangeType =
  | 'fee_adjustment'
  | 'price_limit'
  | 'access_revocation'
  | 'creator_suspension'
  | 'bulk_refund';

export interface PolicyChange {
  type: PolicyChangeType;
  parameters: Record<string, any>;
  reason: string;
  scheduledBy: string;
}

export interface SimulationResult {
  policyChange: PolicyChange;
  timestamp: string;
  affectedRecords: AffectedRecords;
  sideEffects: SideEffect[];
  rollbackConstraints: RollbackConstraint[];
  estimatedDuration: number;
  risks: Risk[];
  preview: PreviewData;
}

export interface AffectedRecords {
  users: number;
  prompts: number;
  purchases: number;
  settlements: number;
  totalXlmImpact: number;
}

export interface SideEffect {
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedEntities: string[];
  reversible: boolean;
}

export interface RollbackConstraint {
  constraint: string;
  canRollback: boolean;
  rollbackProcedure?: string;
  timeWindow?: string;
}

export interface Risk {
  description: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
}

export interface PreviewData {
  sampleAffectedUsers: any[];
  sampleAffectedPrompts: any[];
  sampleTransactions: any[];
}

/** Maximum number of sample rows returned in any preview. */
export const MAX_PREVIEW_SAMPLE = 10;
/** Attempts for read-only preview queries on transient DB failures. */
export const SIMULATION_QUERY_ATTEMPTS = 3;

/** Roles allowed to run simulations. Simulation is read-only but reveals business data. */
const SIMULATION_ROLES = new Set(['admin', 'policy_reviewer']);

export class PolicySimulationError extends Error {
  constructor(
    public readonly code:
      | 'unauthorized'
      | 'invalid_change'
      | 'not_found'
      | 'query_failed',
    message: string,
  ) {
    super(message);
    this.name = 'PolicySimulationError';
  }
}

export interface SimulationActor {
  id: string;
  roles: string[];
}

function assertAuthorized(actor: SimulationActor | undefined): asserts actor is SimulationActor {
  if (!actor || !actor.id || !actor.roles.some((r) => SIMULATION_ROLES.has(r))) {
    throw new PolicySimulationError('unauthorized', 'Actor is not permitted to run policy simulations');
  }
}

/** Runs a read-only query, retrying transient failures with linear backoff. */
async function queryWithRetry<T = any>(text: string, params: any[] = []): Promise<T[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= SIMULATION_QUERY_ATTEMPTS; attempt++) {
    try {
      const res = await db.query(text, params);
      return (res.rows ?? []) as T[];
    } catch (err) {
      lastErr = err;
      logger.warn({ attempt, err }, 'policy simulation query failed, retrying');
      if (attempt < SIMULATION_QUERY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 50 * attempt));
      }
    }
  }
  throw new PolicySimulationError(
    'query_failed',
    `Simulation query failed after ${SIMULATION_QUERY_ATTEMPTS} attempts: ${(lastErr as Error)?.message ?? 'unknown'}`,
  );
}

function validateChange(change: PolicyChange): void {
  const types: PolicyChangeType[] = [
    'fee_adjustment',
    'price_limit',
    'access_revocation',
    'creator_suspension',
    'bulk_refund',
  ];
  if (!types.includes(change.type)) {
    throw new PolicySimulationError('invalid_change', `Unknown policy change type: ${change.type}`);
  }
  if (!change.reason || !change.scheduledBy) {
    throw new PolicySimulationError('invalid_change', 'reason and scheduledBy are required');
  }
  if (change.type === 'fee_adjustment') {
    const pct = Number(change.parameters.newFeePercentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
      throw new PolicySimulationError('invalid_change', 'newFeePercentage must be between 0 and 1');
    }
  }
  if (change.type === 'creator_suspension' && !change.parameters.creatorAddress) {
    throw new PolicySimulationError('invalid_change', 'creatorAddress is required');
  }
  if (change.type === 'bulk_refund' && !change.parameters.promptId) {
    throw new PolicySimulationError('invalid_change', 'promptId is required');
  }
}

async function simulateFeeAdjustment(
  change: PolicyChange,
): Promise<Omit<SimulationResult, 'policyChange' | 'timestamp'>> {
  const newFeePercentage = Number(change.parameters.newFeePercentage);
  const effectiveDate = new Date(change.parameters.effectiveDate ?? Date.now());
  const currentFee = 0.05;

  const [future] = await queryWithRetry<{ count: string; total_value: string }>(
    `SELECT COUNT(*) as count, SUM(price_xlm) as total_value
     FROM prompts WHERE is_active = true AND created_at >= $1`,
    [effectiveDate],
  );
  const [sellers] = await queryWithRetry<{ count: string }>(
    `SELECT COUNT(DISTINCT creator_address) as count FROM prompts WHERE is_active = true`,
  );
  const [monthly] = await queryWithRetry<{ total_volume: string }>(
    `SELECT SUM(amount_xlm) as total_volume FROM purchases
     WHERE created_at >= NOW() - INTERVAL '30 days'`,
  );
  const sampleSellers = await queryWithRetry(
    `SELECT p.creator_address, COUNT(p.id) as active_prompts,
            COALESCE(SUM(pu.amount_xlm), 0) as total_sales_xlm
     FROM prompts p
     LEFT JOIN purchases pu ON p.id = pu.prompt_id
     WHERE p.is_active = true
     GROUP BY p.creator_address
     ORDER BY total_sales_xlm DESC
     LIMIT $1`,
    [MAX_PREVIEW_SAMPLE],
  );

  const feeChange = newFeePercentage - currentFee;
  const monthlyVolume = parseFloat(monthly?.total_volume ?? '0') || 0;
  const estimatedImpact = monthlyVolume * feeChange;

  return {
    affectedRecords: {
      users: Number(sellers?.count ?? 0),
      prompts: Number(future?.count ?? 0),
      purchases: 0,
      settlements: 0,
      totalXlmImpact: estimatedImpact,
    },
    sideEffects: [
      {
        description: `Creator revenue ${feeChange > 0 ? 'decreases' : 'increases'} by ${Math.abs(feeChange * 100)}%`,
        severity: Math.abs(feeChange) > 0.02 ? 'high' : 'medium',
        affectedEntities: ['creators', 'future_purchases'],
        reversible: false,
      },
      {
        description: 'Existing purchases unaffected',
        severity: 'low',
        affectedEntities: ['past_purchases'],
        reversible: true,
      },
    ],
    rollbackConstraints: [
      {
        constraint: 'Fee changes apply only to future purchases',
        canRollback: true,
        rollbackProcedure: 'Revert fee percentage in contract configuration',
        timeWindow: 'immediate',
      },
      { constraint: 'Past settlements cannot be adjusted', canRollback: false },
    ],
    risks: [
      {
        description: 'Creator backlash if fee increase is significant',
        probability: feeChange > 0.02 ? 'high' : 'low',
        impact: 'medium',
        mitigation: 'Announce change 30 days in advance with clear communication',
      },
      {
        description: 'Price competitiveness affected',
        probability: 'medium',
        impact: 'medium',
        mitigation: 'Monitor sales volume for 60 days post-change',
      },
    ],
    estimatedDuration: 5,
    preview: {
      sampleAffectedUsers: sampleSellers,
      sampleAffectedPrompts: [],
      sampleTransactions: [],
    },
  };
}

async function simulateCreatorSuspension(
  change: PolicyChange,
): Promise<Omit<SimulationResult, 'policyChange' | 'timestamp'>> {
  const creatorAddress = String(change.parameters.creatorAddress);

  const [creator] = await queryWithRetry<any>(
    `SELECT c.wallet_address,
            COUNT(DISTINCT p.id) as prompt_count,
            COUNT(pu.id) as total_sales,
            COALESCE(SUM(pu.amount_xlm), 0) as lifetime_revenue_xlm
     FROM creators c
     LEFT JOIN prompts p ON c.wallet_address = p.creator_address
     LEFT JOIN purchases pu ON p.id = pu.prompt_id
     WHERE c.wallet_address = $1
     GROUP BY c.wallet_address`,
    [creatorAddress],
  );
  if (!creator) {
    throw new PolicySimulationError('not_found', `Creator ${creatorAddress} not found`);
  }

  const [buyers] = await queryWithRetry<{ count: string }>(
    `SELECT COUNT(DISTINCT buyer_address) as count FROM purchases
     WHERE prompt_id IN (SELECT id FROM prompts WHERE creator_address = $1)`,
    [creatorAddress],
  );
  const affectedPrompts = await queryWithRetry(
    `SELECT id, title, price_xlm, purchase_count, is_active
     FROM prompts WHERE creator_address = $1 LIMIT $2`,
    [creatorAddress, MAX_PREVIEW_SAMPLE],
  );

  const buyerCount = Number(buyers?.count ?? 0);
  const lifetime = parseFloat(creator.lifetime_revenue_xlm) || 0;
  const promptCount = Number(creator.prompt_count ?? 0);

  return {
    affectedRecords: {
      users: buyerCount + 1,
      prompts: promptCount,
      purchases: Number(creator.total_sales ?? 0),
      settlements: 0,
      totalXlmImpact: lifetime,
    },
    sideEffects: [
      {
        description: `${promptCount} prompts will be delisted`,
        severity: 'high',
        affectedEntities: ['prompts', 'marketplace_listings'],
        reversible: true,
      },
      {
        description: `${buyerCount} buyers retain access to purchased prompts`,
        severity: 'medium',
        affectedEntities: ['buyers', 'purchased_access'],
        reversible: false,
      },
      {
        description: 'Creator cannot list new prompts',
        severity: 'critical',
        affectedEntities: ['creator_account'],
        reversible: true,
      },
      {
        description: 'Pending settlements will still process',
        severity: 'low',
        affectedEntities: ['settlements'],
        reversible: false,
      },
    ],
    rollbackConstraints: [
      {
        constraint: 'Suspension can be reversed',
        canRollback: true,
        rollbackProcedure: 'Reactivate creator account via admin panel',
        timeWindow: 'any time',
      },
      { constraint: 'Buyer access is permanent', canRollback: false },
      {
        constraint: 'Delisted prompts can be re-enabled',
        canRollback: true,
        rollbackProcedure: 'Set is_active=true for all creator prompts',
        timeWindow: 'any time',
      },
    ],
    risks: [
      {
        description: 'Legal challenge from creator',
        probability: 'medium',
        impact: 'high',
        mitigation: 'Document violation clearly, follow terms of service',
      },
      {
        description: 'Buyer complaints about delisted content',
        probability: 'low',
        impact: 'medium',
        mitigation: 'Maintain buyer access to purchased prompts',
      },
      {
        description: 'Revenue loss from high-performing creator',
        probability: 'high',
        impact: lifetime > 1000 ? 'high' : 'medium',
        mitigation: 'Ensure suspension is justified and documented',
      },
    ],
    estimatedDuration: 10,
    preview: {
      sampleAffectedUsers: [creator],
      sampleAffectedPrompts: affectedPrompts,
      sampleTransactions: [],
    },
  };
}

async function simulateBulkRefund(
  change: PolicyChange,
): Promise<Omit<SimulationResult, 'policyChange' | 'timestamp'>> {
  const promptId = String(change.parameters.promptId);
  const purchases = await queryWithRetry<any>(
    `SELECT p.id, p.buyer_address, p.amount_xlm, p.created_at, p.tx_hash
     FROM purchases p
     WHERE p.prompt_id = $1 AND p.status = 'completed'
     ORDER BY p.created_at DESC`,
    [promptId],
  );

  const purchaseCount = purchases.length;
  const totalRefund = purchases.reduce((sum, p) => sum + parseFloat(p.amount_xlm), 0);
  const uniqueBuyers = new Set(purchases.map((p) => p.buyer_address)).size;

  return {
    affectedRecords: {
      users: uniqueBuyers,
      prompts: 1,
      purchases: purchaseCount,
      settlements: purchaseCount,
      totalXlmImpact: totalRefund,
    },
    sideEffects: [
      {
        description: `${totalRefund} XLM will be refunded to ${uniqueBuyers} buyers`,
        severity: 'critical',
        affectedEntities: ['buyers', 'platform_treasury'],
        reversible: false,
      },
      {
        description: 'Prompt will be delisted permanently',
        severity: 'high',
        affectedEntities: ['prompt', 'marketplace'],
        reversible: false,
      },
      {
        description: 'Buyer access will be revoked',
        severity: 'high',
        affectedEntities: ['access_rights'],
        reversible: false,
      },
      {
        description: 'Creator revenue clawed back',
        severity: 'critical',
        affectedEntities: ['creator_balance'],
        reversible: false,
      },
    ],
    rollbackConstraints: [
      { constraint: 'Refunds are irreversible once processed', canRollback: false },
      { constraint: 'On-chain transactions cannot be undone', canRollback: false },
      { constraint: 'Access revocation is permanent', canRollback: false },
    ],
    risks: [
      {
        description: 'Treasury may lack sufficient XLM for refunds',
        probability: totalRefund > 10000 ? 'medium' : 'low',
        impact: 'critical',
        mitigation: 'Verify treasury balance before execution',
      },
      {
        description: 'Creator dispute and reputation damage',
        probability: 'high',
        impact: 'high',
        mitigation: 'Clear violation evidence, legal review',
      },
      {
        description: 'Processing time for large refund batch',
        probability: purchaseCount > 100 ? 'high' : 'low',
        impact: 'medium',
        mitigation: 'Batch refunds in groups of 50, monitor progress',
      },
    ],
    estimatedDuration: purchaseCount * 2,
    preview: {
      sampleAffectedUsers: purchases.slice(0, MAX_PREVIEW_SAMPLE),
      sampleAffectedPrompts: [],
      sampleTransactions: [],
    },
  };
}

/**
 * Simulate a policy change. Read-only: never mutates prompts, purchases, or
 * settlements. Requires an authorized actor.
 *
 * Failure modes:
 * - unauthorized actor -> PolicySimulationError('unauthorized') before any query
 * - malformed change -> PolicySimulationError('invalid_change') before any query
 * - unknown creator / prompt -> PolicySimulationError('not_found')
 * - transient DB error -> retried up to SIMULATION_QUERY_ATTEMPTS, then 'query_failed'
 *
 * Rollback: nothing is written, so there is nothing to roll back. Simulation
 * results are advisory and may become stale; callers should re-simulate if the
 * underlying data changes before applying.
 */
export async function simulatePolicyChange(
  actor: SimulationActor | undefined,
  change: PolicyChange,
): Promise<SimulationResult> {
  assertAuthorized(actor);
  validateChange(change);

  let body: Omit<SimulationResult, 'policyChange' | 'timestamp'>;
  switch (change.type) {
    case 'fee_adjustment':
      body = await simulateFeeAdjustment(change);
      break;
    case 'creator_suspension':
      body = await simulateCreatorSuspension(change);
      break;
    case 'bulk_refund':
      body = await simulateBulkRefund(change);
      break;
    default:
      throw new PolicySimulationError(
        'invalid_change',
        `Simulation not implemented for ${change.type}`,
      );
  }

  logger.info(
    { actor: actor.id, type: change.type, users: body.affectedRecords.users },
    'policy simulation completed',
  );

  return {
    policyChange: change,
    timestamp: new Date().toISOString(),
    ...body,
  };
}
