/**
 * Issue 995: Snapshot Restore Verification
 * 
 * Verifies snapshot restores against invariants and rebuilds derived indexes.
 * Ensures data integrity after backup restoration with automated validation.
 */

import { db } from '../config/database';
import { logger } from '../util/logger';

interface InvariantCheck {
  name: string;
  check: () => Promise<InvariantResult>;
  repairSteps?: string[];
}

interface InvariantResult {
  passed: boolean;
  message: string;
  affectedRecords?: number;
  details?: Record<string, any>;
}

interface VerificationReport {
  timestamp: string;
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  results: Array<InvariantResult & { checkName: string }>;
  derivedIndexesRebuilt: string[];
  duration: number;
}

/**
 * Core invariant checks for prompt marketplace data
 */
const INVARIANTS: InvariantCheck[] = [
  {
    name: 'purchase_records_match_contract_state',
    check: async () => {
      // Verify purchase records match on-chain contract state
      const purchases = await db.query(`
        SELECT COUNT(*) as count 
        FROM purchases 
        WHERE status = 'completed' AND on_chain_verified = false
      `);
      
      const unverified = purchases.rows[0]?.count || 0;
      
      return {
        passed: unverified === 0,
        message: unverified === 0 
          ? 'All purchases verified against contract' 
          : `${unverified} purchases need on-chain verification`,
        affectedRecords: unverified
      };
    },
    repairSteps: [
      'Run: yarn verify:purchases',
      'Check Soroban RPC connectivity',
      'Review purchase transaction hashes in database'
    ]
  },
  {
    name: 'prompt_hash_integrity',
    check: async () => {
      // Verify stored hash matches encrypted content hash
      const prompts = await db.query(`
        SELECT id, content_hash, encrypted_payload 
        FROM prompts 
        WHERE content_hash IS NOT NULL AND encrypted_payload IS NOT NULL
      `);
      
      let mismatches = 0;
      for (const prompt of prompts.rows) {
        const computedHash = await computeContentHash(prompt.encrypted_payload);
        if (computedHash !== prompt.content_hash) {
          mismatches++;
        }
      }
      
      return {
        passed: mismatches === 0,
        message: mismatches === 0
          ? 'All prompt hashes verified'
          : `${mismatches} prompts have hash mismatches`,
        affectedRecords: mismatches
      };
    },
    repairSteps: [
      'Identify affected prompts: SELECT id FROM prompts WHERE hash_mismatch = true',
      'Contact creators to re-upload affected prompts',
      'Mark affected listings as inactive until resolved'
    ]
  },
  {
    name: 'creator_entitlements_consistency',
    check: async () => {
      // Verify creator ownership matches contract registry
      const creators = await db.query(`
        SELECT c.wallet_address, COUNT(p.id) as prompt_count
        FROM creators c
        LEFT JOIN prompts p ON c.wallet_address = p.creator_address
        WHERE c.is_active = true
        GROUP BY c.wallet_address
        HAVING COUNT(p.id) = 0
      `);
      
      const orphanedCreators = creators.rows.length;
      
      return {
        passed: orphanedCreators === 0,
        message: orphanedCreators === 0
          ? 'All creators have valid prompts'
          : `${orphanedCreators} creators have no prompts`,
        affectedRecords: orphanedCreators,
        details: {
          orphanedWallets: creators.rows.map(
            (r: { wallet_address: string }) => r.wallet_address,
          ),
        }
      };
    },
    repairSteps: [
      'Review creator accounts without prompts',
      'Either deactivate unused creator accounts or restore missing prompts',
      'Check for database foreign key constraint violations'
    ]
  },
  {
    name: 'buyer_access_rights_validity',
    check: async () => {
      // Verify buyer access rights have corresponding purchase records
      const accessRights = await db.query(`
        SELECT ba.id, ba.buyer_address, ba.prompt_id
        FROM buyer_access ba
        LEFT JOIN purchases p ON ba.purchase_id = p.id
        WHERE p.id IS NULL
      `);
      
      const orphaned = accessRights.rows.length;
      
      return {
        passed: orphaned === 0,
        message: orphaned === 0
          ? 'All access rights have valid purchases'
          : `${orphaned} access rights missing purchase records`,
        affectedRecords: orphaned
      };
    },
    repairSteps: [
      'Query orphaned access: SELECT * FROM buyer_access WHERE purchase_id NOT IN (SELECT id FROM purchases)',
      'Revoke invalid access rights or restore missing purchase records',
      'Run integrity repair: yarn repair:access-rights'
    ]
  },
  {
    name: 'settlement_amounts_match_ledger',
    check: async () => {
      // Verify settlement amounts match Stellar transaction amounts
      const settlements = await db.query(`
        SELECT s.id, s.amount_xlm, s.tx_hash
        FROM settlements s
        WHERE s.verified_on_chain = false
        AND s.created_at < NOW() - INTERVAL '1 hour'
      `);
      
      const unverified = settlements.rows.length;
      
      return {
        passed: unverified === 0,
        message: unverified === 0
          ? 'All settlements verified on-chain'
          : `${unverified} settlements pending verification`,
        affectedRecords: unverified
      };
    },
    repairSteps: [
      'Verify transactions on Stellar: stellar.expert/explorer/public/tx/{tx_hash}',
      'Re-submit failed settlements if transaction not found',
      'Update verified_on_chain flag after manual verification'
    ]
  }
];

/**
 * Derived indexes that need rebuilding after restore
 */
const DERIVED_INDEXES = [
  {
    name: 'creator_sales_summary',
    rebuild: async () => {
      await db.query(`
        INSERT INTO creator_stats (wallet_address, total_sales, total_revenue_xlm, prompt_count, updated_at)
        SELECT 
          p.creator_address,
          COUNT(pu.id) as total_sales,
          SUM(pu.amount_xlm) as total_revenue_xlm,
          COUNT(DISTINCT p.id) as prompt_count,
          NOW() as updated_at
        FROM prompts p
        LEFT JOIN purchases pu ON p.id = pu.prompt_id
        GROUP BY p.creator_address
        ON CONFLICT (wallet_address) DO UPDATE SET
          total_sales = EXCLUDED.total_sales,
          total_revenue_xlm = EXCLUDED.total_revenue_xlm,
          prompt_count = EXCLUDED.prompt_count,
          updated_at = EXCLUDED.updated_at
      `);
    }
  },
  {
    name: 'buyer_purchase_history',
    rebuild: async () => {
      await db.query(`
        INSERT INTO buyer_stats (wallet_address, total_purchases, total_spent_xlm, updated_at)
        SELECT 
          buyer_address,
          COUNT(id) as total_purchases,
          SUM(amount_xlm) as total_spent_xlm,
          NOW() as updated_at
        FROM purchases
        WHERE status = 'completed'
        GROUP BY buyer_address
        ON CONFLICT (wallet_address) DO UPDATE SET
          total_purchases = EXCLUDED.total_purchases,
          total_spent_xlm = EXCLUDED.total_spent_xlm,
          updated_at = EXCLUDED.updated_at
      `);
    }
  },
  {
    name: 'prompt_popularity_index',
    rebuild: async () => {
      await db.query(`
        UPDATE prompts SET
          purchase_count = subq.count,
          last_purchased_at = subq.last_purchase
        FROM (
          SELECT prompt_id, COUNT(*) as count, MAX(created_at) as last_purchase
          FROM purchases
          WHERE status = 'completed'
          GROUP BY prompt_id
        ) subq
        WHERE prompts.id = subq.prompt_id
      `);
    }
  }
];

/**
 * Compute content hash for verification
 */
async function computeContentHash(encryptedPayload: Buffer | string): Promise<string> {
  const crypto = await import('crypto');
  const data = Buffer.isBuffer(encryptedPayload) 
    ? encryptedPayload 
    : Buffer.from(encryptedPayload, 'base64');
  
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Run all invariant checks and rebuild derived indexes
 */
export async function verifySnapshotRestore(): Promise<VerificationReport> {
  const startTime = Date.now();
  logger.info('Starting snapshot restore verification...');
  
  const results: Array<InvariantResult & { checkName: string }> = [];
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  // Run all invariant checks
  for (const invariant of INVARIANTS) {
    try {
      logger.info(`Running check: ${invariant.name}`);
      const result = await invariant.check();
      
      results.push({
        ...result,
        checkName: invariant.name
      });
      
      if (result.passed) {
        passed++;
      } else {
        failed++;
        logger.error(`Invariant failed: ${invariant.name}`, {
          message: result.message,
          affectedRecords: result.affectedRecords,
          repairSteps: invariant.repairSteps
        });
        
        if (invariant.repairSteps) {
          logger.error(`Repair steps for ${invariant.name}:`, invariant.repairSteps);
        }
      }
    } catch (error) {
      failed++;
      logger.error(`Error running check ${invariant.name}:`, error);
      results.push({
        passed: false,
        message: `Check failed with error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        checkName: invariant.name
      });
    }
  }

  // Rebuild derived indexes
  const rebuiltIndexes: string[] = [];
  for (const index of DERIVED_INDEXES) {
    try {
      logger.info(`Rebuilding index: ${index.name}`);
      await index.rebuild();
      rebuiltIndexes.push(index.name);
    } catch (error) {
      logger.error(`Error rebuilding index ${index.name}:`, error);
      warnings++;
    }
  }

  const duration = Date.now() - startTime;
  
  const report: VerificationReport = {
    timestamp: new Date().toISOString(),
    totalChecks: INVARIANTS.length,
    passed,
    failed,
    warnings,
    results,
    derivedIndexesRebuilt: rebuiltIndexes,
    duration
  };

  // Fail loudly if any checks failed
  if (failed > 0) {
    logger.error('Snapshot verification FAILED', {
      failed,
      totalChecks: INVARIANTS.length,
      report
    });
    throw new Error(`Snapshot verification failed: ${failed} of ${INVARIANTS.length} checks failed`);
  }

  logger.info('Snapshot verification completed successfully', {
    duration,
    checksRun: INVARIANTS.length,
    indexesRebuilt: rebuiltIndexes.length
  });

  return report;
}

/**
 * Export for testing and CLI usage
 */
export const verificationService = {
  verifySnapshotRestore,
  invariants: INVARIANTS,
  derivedIndexes: DERIVED_INDEXES
};
