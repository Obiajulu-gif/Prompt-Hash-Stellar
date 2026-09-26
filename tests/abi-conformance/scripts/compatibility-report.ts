#!/usr/bin/env node
/**
 * compatibility-report.ts - Compatibility Report Generator
 * 
 * Generates a compatibility report showing which contract versions are compatible
 * with which client versions. This helps teams understand upgrade paths and
 * breaking changes.
 * 
 * Usage: node tests/abi-conformance/scripts/compatibility-report.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const CONTRACT_SPEC_PATH = path.join(__dirname, '../../../contracts/prompt-hash/spec-baseline.json');
const CLIENT_MAPPINGS_PATH = path.join(__dirname, '../fixtures/client-mappings.json');
const COMPATIBILITY_REPORT_PATH = path.join(__dirname, '../fixtures/compatibility-report.json');

interface ContractSpec {
  data_types: Record<string, string[]>;
  errors: Record<string, string>;
  events: Record<string, string[]>;
  functions: Record<string, string>;
}

interface ClientMappings {
  type_mappings: any;
  client_methods: any;
}

interface CompatibilityReport {
  _metadata: {
    generated_at: string;
    report_version: string;
    description: string;
  };
  contract_versions: Record<string, ContractVersionInfo>;
  versioning_policy: VersioningPolicy;
  known_issues: string[];
  upgrade_paths: Record<string, UpgradePath>;
}

interface ContractVersionInfo {
  status: string;
  released_at: string;
  breaking_changes: string[];
  additions: string[];
  deprecations: string[];
  sdk_minimum_version: string;
  frontend_minimum_version: string;
  api_minimum_version: string;
}

interface VersioningPolicy {
  major: string;
  minor: string;
  patch: string;
  compatibility_matrix: {
    contract: {
      major: string;
      minor: string;
      patch: string;
    };
    sdk: {
      major: string;
      minor: string;
      patch: string;
    };
  };
  migration_guide: {
    breaking_changes: string[];
    additions: string[];
  };
}

interface UpgradePath {
  breaking: boolean;
  required_actions: string[];
}

/**
 * Analyze contract spec for breaking changes
 */
function analyzeBreakingChanges(spec: ContractSpec): string[] {
  const breakingChanges: string[] = [];
  
  // Check for removed functions
  const functionCount = Object.keys(spec.functions).length;
  if (functionCount < 40) {
    breakingChanges.push(`Function count reduced to ${functionCount} (expected 40+)`);
  }
  
  // Check for removed error codes
  const errorCount = Object.keys(spec.errors).length;
  if (errorCount < 40) {
    breakingChanges.push(`Error code count reduced to ${errorCount} (expected 40+)`);
  }
  
  // Check for removed events
  const eventCount = Object.keys(spec.events).length;
  if (eventCount < 20) {
    breakingChanges.push(`Event count reduced to ${eventCount} (expected 20+)`);
  }
  
  return breakingChanges;
}

/**
 * Analyze contract spec for additions
 */
function analyzeAdditions(spec: ContractSpec): string[] {
  const additions: string[] = [];
  
  // Check for new functions beyond baseline
  const functionCount = Object.keys(spec.functions).length;
  if (functionCount > 45) {
    additions.push(`${functionCount - 45} new functions added`);
  }
  
  // Check for new error codes
  const errorCount = Object.keys(spec.errors).length;
  if (errorCount > 40) {
    additions.push(`${errorCount - 40} new error codes added`);
  }
  
  // Check for new events
  const eventCount = Object.keys(spec.events).length;
  if (eventCount > 20) {
    additions.push(`${eventCount - 20} new events added`);
  }
  
  return additions;
}

/**
 * Generate compatibility report
 */
function generateCompatibilityReport(
  spec: ContractSpec,
  mappings: ClientMappings
): CompatibilityReport {
  const breakingChanges = analyzeBreakingChanges(spec);
  const additions = analyzeAdditions(spec);
  
  const report: CompatibilityReport = {
    _metadata: {
      generated_at: new Date().toISOString(),
      report_version: '1.0.0',
      description: 'Contract version compatibility matrix for clients'
    },
    contract_versions: {
      '0.0.1': {
        status: breakingChanges.length > 0 ? 'deprecated' : 'current',
        released_at: '2024-01-01T00:00:00Z',
        breaking_changes: breakingChanges,
        additions: additions.length > 0 ? additions : [
          'Initial contract deployment',
          'Core prompt marketplace functionality',
          'Bundle and access pass features',
          'Dispute resolution system'
        ],
        deprecations: [],
        sdk_minimum_version: '0.0.1',
        frontend_minimum_version: '0.0.1',
        api_minimum_version: '0.0.1'
      }
    },
    versioning_policy: {
      major: 'Breaking changes that require client updates',
      minor: 'Backward-compatible additions',
      patch: 'Bug fixes and internal improvements',
      compatibility_matrix: {
        contract: {
          major: 'Requires SDK major bump, API version bump, breaking frontend changes',
          minor: 'SDK minor bump, optional API features, frontend feature detection',
          patch: 'No client changes required'
        },
        sdk: {
          major: 'Breaking API changes, may require frontend updates',
          minor: 'New features with backward compatibility',
          patch: 'Bug fixes only'
        }
      },
      migration_guide: {
        breaking_changes: [
          'Update SDK to latest major version',
          'Review API compatibility layer',
          'Test frontend with new contract',
          'Update type definitions',
          'Migrate deprecated methods'
        ],
        additions: [
          'Optional: Update SDK for new features',
          'Optional: Add feature detection in frontend',
          'Optional: Update API to support new fields'
        ]
      }
    },
    known_issues: [],
    upgrade_paths: {
      'from_0_0_0_to_0_0_1': {
        breaking: false,
        required_actions: [
          'Deploy new contract',
          'Update SDK to 0.0.1',
          'Test integration'
        ]
      }
    }
  };
  
  return report;
}

/**
 * Write compatibility report to disk
 */
function writeCompatibilityReport(report: CompatibilityReport): void {
  const reportContent = JSON.stringify(report, null, 2);
  fs.writeFileSync(COMPATIBILITY_REPORT_PATH, reportContent, 'utf-8');
  console.log(`✓ Generated compatibility report: ${COMPATIBILITY_REPORT_PATH}`);
}

/**
 * Main execution
 */
function main(): void {
  console.log('🔧 Generating ABI compatibility report...\n');
  
  try {
    // Load contract spec
    console.log('Loading contract specification...');
    const specContent = fs.readFileSync(CONTRACT_SPEC_PATH, 'utf-8');
    const spec = JSON.parse(specContent) as ContractSpec;
    console.log(`✓ Loaded ${Object.keys(spec.functions).length} functions`);
    console.log(`✓ Loaded ${Object.keys(spec.data_types).length} data types`);
    console.log(`✓ Loaded ${Object.keys(spec.errors).length} error codes`);
    console.log(`✓ Loaded ${Object.keys(spec.events).length} events`);
    
    // Load client mappings
    console.log('\nLoading client mappings...');
    const mappingsContent = fs.readFileSync(CLIENT_MAPPINGS_PATH, 'utf-8');
    const mappings = JSON.parse(mappingsContent) as ClientMappings;
    console.log(`✓ Loaded client method mappings`);
    
    // Generate report
    console.log('\nGenerating compatibility report...');
    const report = generateCompatibilityReport(spec, mappings);
    
    // Write report
    writeCompatibilityReport(report);
    
    // Display summary
    console.log('\n✨ Compatibility report generated successfully');
    console.log(`\nContract versions: ${Object.keys(report.contract_versions).length}`);
    console.log(`Breaking changes detected: ${report.contract_versions['0.0.1'].breaking_changes.length}`);
    console.log(`New additions: ${report.contract_versions['0.0.1'].additions.length}`);
    
    if (report.contract_versions['0.0.1'].breaking_changes.length > 0) {
      console.log('\n⚠ Breaking changes detected:');
      report.contract_versions['0.0.1'].breaking_changes.forEach((change) => {
        console.log(`  - ${change}`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error generating compatibility report:', error);
    process.exit(1);
  }
}

main();
