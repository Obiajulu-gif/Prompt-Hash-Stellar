#!/usr/bin/env node
/**
 * generate-fixtures.ts - ABI Conformance Test Fixture Generator
 * 
 * This script regenerates the canonical ABI fixtures from the Soroban contract
 * specification. It ensures deterministic output and validates against the
 * existing fixtures to detect unintended changes.
 * 
 * Usage: node tests/abi-conformance/scripts/generate-fixtures.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const CONTRACT_SPEC_PATH = path.join(__dirname, '../../../contracts/prompt-hash/spec-baseline.json');
const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const CONTRACT_SPEC_FIXTURE = path.join(FIXTURES_DIR, 'contract-spec.json');
const CARGO_TOML_PATH = path.join(__dirname, '../../../Cargo.toml');

interface ContractSpec {
  data_types: Record<string, string[]>;
  errors: Record<string, string>;
  events: Record<string, string[]>;
  functions: Record<string, string>;
}

interface FixtureMetadata {
  generated_at: string;
  contract_version: string;
  spec_source: string;
  generator: string;
}

interface ContractSpecFixture extends ContractSpec {
  _metadata: FixtureMetadata;
}

/**
 * Sort object keys recursively for deterministic JSON output
 */
function sortObjectKeys<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted = {} as T;
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key as keyof T] = sortObjectKeys(obj[key as keyof T]);
      });
    return sorted;
  }
  return obj;
}

/**
 * Extract version from Cargo.toml
 */
function extractCargoVersion(): string {
  if (!fs.existsSync(CARGO_TOML_PATH)) {
    throw new Error(`Cargo.toml not found at ${CARGO_TOML_PATH}`);
  }

  const cargoContent = fs.readFileSync(CARGO_TOML_PATH, 'utf-8');
  const versionMatch = cargoContent.match(/version\s*=\s*"([^"]+)"/);

  if (!versionMatch || !versionMatch[1]) {
    throw new Error('Could not extract version from Cargo.toml');
  }

  return versionMatch[1];
}

/**
 * Load the contract specification from the Soroban contract
 */
function loadContractSpec(): ContractSpec {
  if (!fs.existsSync(CONTRACT_SPEC_PATH)) {
    throw new Error(`Contract spec not found at ${CONTRACT_SPEC_PATH}`);
  }

  const specContent = fs.readFileSync(CONTRACT_SPEC_PATH, 'utf-8');
  const spec = JSON.parse(specContent) as ContractSpec;

  return sortObjectKeys(spec);
}

/**
 * Generate the fixture with metadata
 */
function generateFixture(spec: ContractSpec, contractVersion: string): ContractSpecFixture {
  const metadata: FixtureMetadata = {
    generated_at: new Date().toISOString(),
    contract_version: contractVersion,
    spec_source: 'contracts/prompt-hash/spec-baseline.json',
    generator: 'abi-conformance-test-suite'
  };

  return {
    _metadata: metadata,
    ...spec
  };
}

/**
 * Write the fixture to disk
 */
function writeFixture(fixture: ContractSpecFixture): void {
  const fixtureContent = JSON.stringify(fixture, null, 2);
  fs.writeFileSync(CONTRACT_SPEC_FIXTURE, fixtureContent, 'utf-8');
  console.log(`✓ Generated contract spec fixture: ${CONTRACT_SPEC_FIXTURE}`);
}

/**
 * Compare with existing fixture to detect changes
 */
function compareWithExisting(newFixture: ContractSpecFixture): boolean {
  if (!fs.existsSync(CONTRACT_SPEC_FIXTURE)) {
    console.log('⚠ No existing fixture found, creating new one');
    return false;
  }

  const existingContent = fs.readFileSync(CONTRACT_SPEC_FIXTURE, 'utf-8');
  const existingFixture = JSON.parse(existingContent) as ContractSpecFixture;
  
  // Remove metadata for comparison
  const { _metadata: _, ...newSpec } = newFixture;
  const { _metadata: __, ...existingSpec } = existingFixture;
  
  const newSpecStr = JSON.stringify(sortObjectKeys(newSpec));
  const existingSpecStr = JSON.stringify(sortObjectKeys(existingSpec));
  
  if (newSpecStr === existingSpecStr) {
    console.log('✓ Contract spec unchanged, no update needed');
    return true;
  }
  
  console.log('⚠ Contract spec has changed, fixture will be updated');
  return false;
}

/**
 * Main execution
 */
function main(): void {
  console.log('🔧 Generating ABI conformance fixtures...\n');

  try {
    // Extract contract version from Cargo.toml
    console.log('Extracting contract version from Cargo.toml...');
    const contractVersion = extractCargoVersion();
    console.log(`✓ Contract version: ${contractVersion}`);

    // Load contract spec
    console.log('\nLoading contract specification...');
    const spec = loadContractSpec();
    console.log(`✓ Loaded ${Object.keys(spec.functions).length} functions`);
    console.log(`✓ Loaded ${Object.keys(spec.data_types).length} data types`);
    console.log(`✓ Loaded ${Object.keys(spec.errors).length} error codes`);
    console.log(`✓ Loaded ${Object.keys(spec.events).length} events`);

    // Generate fixture
    console.log('\nGenerating fixture...');
    const fixture = generateFixture(spec, contractVersion);

    // Compare with existing
    const unchanged = compareWithExisting(fixture);

    if (!unchanged) {
      writeFixture(fixture);
      console.log('\n✨ Fixture updated successfully');
      console.log('⚠ Please review the changes and commit the updated fixture');
    } else {
      console.log('\n✨ Fixture is up to date');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error generating fixtures:', error);
    process.exit(1);
  }
}

main();
