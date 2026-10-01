/**
 * type-mapping.test.ts - Type Mapping Validation Tests
 * 
 * Validates that TypeScript type mappings correctly correspond to Rust contract types.
 * Tests struct field mappings, enum variants, and complex type conversions.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load fixtures
const CONTRACT_SPEC_PATH = path.join(__dirname, '../fixtures/contract-spec.json');
const CLIENT_MAPPINGS_PATH = path.join(__dirname, '../fixtures/client-mappings.json');

const contractSpec = JSON.parse(fs.readFileSync(CONTRACT_SPEC_PATH, 'utf-8'));
const clientMappings = JSON.parse(fs.readFileSync(CLIENT_MAPPINGS_PATH, 'utf-8'));

describe('ABI Conformance: Type Mappings', () => {
  describe('Struct field validation', () => {
    it('should validate Prompt struct field mappings', () => {
      const contractPrompt = contractSpec.data_types.Prompt;
      const clientPrompt = clientMappings.type_mappings.contract_types.Prompt;
      
      // Contract has 16 fields
      expect(contractPrompt.length).toBe(16);
      
      // Client mapping should have corresponding fields
      expect(Object.keys(clientPrompt).length).toBe(16);
      
      // Validate specific field mappings
      expect(clientPrompt.id).toBe('bigint'); // u64 -> bigint
      expect(clientPrompt.creator).toBe('string'); // Address -> string
      expect(clientPrompt.price_stroops).toBe('bigint'); // i128 -> bigint
      expect(clientPrompt.active).toBe('boolean'); // bool -> boolean
      expect(clientPrompt.sales_count).toBe('number'); // u64 -> number
      expect(clientPrompt.revision).toBe('number'); // u32 -> number
    });

    it('should validate Bundle struct field mappings', () => {
      const contractBundle = contractSpec.data_types.Bundle;
      const clientBundle = clientMappings.type_mappings.contract_types.Bundle;
      
      // Contract has 10 fields
      expect(contractBundle.length).toBe(10);
      
      // Client mapping should have corresponding fields
      expect(Object.keys(clientBundle).length).toBe(10);
      
      // Validate Vec<T> mapping
      expect(clientBundle.prompt_ids).toBe('Array<bigint>'); // Vec<u128> -> Array<bigint>
    });

    it('should validate AccessPass struct field mappings', () => {
      const contractAccessPass = contractSpec.data_types.AccessPass;
      const clientAccessPass = clientMappings.type_mappings.contract_types.AccessPass;
      
      // Contract has 8 fields
      expect(contractAccessPass.length).toBe(8);
      
      // Client mapping should have corresponding fields
      expect(Object.keys(clientAccessPass).length).toBe(8);
      
      // Validate duration_secs mapping
      expect(clientAccessPass.duration_secs).toBe('number'); // u64 -> number
    });

    it('should validate Split struct field mappings', () => {
      const contractSplit = contractSpec.data_types.Split;
      const clientSplit = clientMappings.type_mappings.contract_types.Split;
      
      // Contract has 2 fields
      expect(contractSplit.length).toBe(2);
      
      // Client mapping should have corresponding fields
      expect(Object.keys(clientSplit).length).toBe(2);
      
      // Validate bps mapping
      expect(clientSplit.bps).toBe('number'); // u32 -> number
    });

    it('should validate ListingConfig struct field mappings', () => {
      const contractListingConfig = contractSpec.data_types.ListingConfig;
      const clientListingConfig = clientMappings.type_mappings.contract_types.ListingConfig;
      
      // Contract has 6 fields
      expect(contractListingConfig.length).toBe(6);
      
      // Client mapping should have corresponding fields
      expect(Object.keys(clientListingConfig).length).toBe(6);
      
      // Validate Vec<T> mappings
      expect(clientListingConfig.splits).toBe('Array<Split>'); // Vec<Split> -> Array<Split>
      expect(clientListingConfig.tags).toBe('Array<string>'); // Vec<String> -> Array<string>
    });
  });

  describe('Enum variant validation', () => {
    it('should validate DisputeReason enum variants', () => {
      const contractDisputeReason = contractSpec.data_types.DisputeReason;
      const clientDisputeReason = clientMappings.type_mappings.enum_types.DisputeReason;
      
      // Contract has 3 variants
      expect(contractDisputeReason.length).toBe(3);
      
      // Client mapping should have corresponding variants
      expect(Object.keys(clientDisputeReason).length).toBe(3);
      
      // Validate variant names match
      expect(clientDisputeReason.InvalidEncryptedPayload).toBe('InvalidEncryptedPayload');
      expect(clientDisputeReason.MissingMetadata).toBe('MissingMetadata');
      expect(clientDisputeReason.FailedIntegrityVerification).toBe('FailedIntegrityVerification');
    });

    it('should validate DisputeStatus enum variants', () => {
      const contractDisputeStatus = contractSpec.data_types.DisputeStatus;
      const clientDisputeStatus = clientMappings.type_mappings.enum_types.DisputeStatus;
      
      // Contract has 3 variants
      expect(contractDisputeStatus.length).toBe(3);
      
      // Client mapping should have corresponding variants
      expect(Object.keys(clientDisputeStatus).length).toBe(3);
      
      // Validate variant names match
      expect(clientDisputeStatus.Open).toBe('Open');
      expect(clientDisputeStatus.Refunded).toBe('Refunded');
      expect(clientDisputeStatus.Rejected).toBe('Rejected');
    });
  });

  describe('Complex type field validation', () => {
    it('should validate Purchase struct with complex fields', () => {
      const contractPurchase = contractSpec.data_types.Purchase;
      const clientPurchase = clientMappings.type_mappings.contract_types.Purchase;
      
      // Contract has 8 fields
      expect(contractPurchase.length).toBe(8);
      
      // Client mapping should have corresponding fields
      expect(Object.keys(clientPurchase).length).toBe(8);
      
      // Validate integer width mappings
      expect(clientPurchase.prompt_id).toBe('number'); // u64 -> number (not bigint in client)
      expect(clientPurchase.original_price).toBe('bigint'); // i128 -> bigint
      expect(clientPurchase.transfer_count).toBe('number'); // u32 -> number
    });

    it('should validate PurchaseDispute struct with enum fields', () => {
      const contractPurchaseDispute = contractSpec.data_types.PurchaseDispute;
      const clientPurchaseDispute = clientMappings.type_mappings.contract_types.PurchaseDispute;
      
      // Contract has 6 fields
      expect(contractPurchaseDispute.length).toBe(6);
      
      // Client mapping should have corresponding fields
      expect(Object.keys(clientPurchaseDispute).length).toBe(6);
      
      // Validate enum field mappings
      expect(clientPurchaseDispute.reason).toBe('DisputeReason');
      expect(clientPurchaseDispute.status).toBe('DisputeStatus');
    });
  });

  describe('Type consistency across structs', () => {
    it('should ensure Address type is consistently mapped to string', () => {
      const contractTypes = contractSpec.data_types;
      const clientTypes = clientMappings.type_mappings.contract_types;
      
      // Find all fields with Address type in contract
      const addressFields: string[] = [];
      Object.entries(contractTypes).forEach(([structName, fields]) => {
        if (Array.isArray(fields)) {
          fields.forEach((field: string) => {
            if (field.includes('Address')) {
              const fieldName = field.split(':')[0].replace('pub ', '').trim();
              addressFields.push(`${structName}.${fieldName}`);
            }
          });
        }
      });
      
      // Validate that all Address fields in client mappings are strings
      addressFields.forEach((fieldPath) => {
        const [structName, fieldName] = fieldPath.split('.');
        if (clientTypes[structName] && clientTypes[structName][fieldName]) {
          expect(clientTypes[structName][fieldName]).toBe('string');
        }
      });
    });

    it('should ensure bool type is consistently mapped to boolean', () => {
      const contractTypes = contractSpec.data_types;
      const clientTypes = clientMappings.type_mappings.contract_types;
      
      // Find all fields with bool type in contract
      const boolFields: string[] = [];
      Object.entries(contractTypes).forEach(([structName, fields]) => {
        if (Array.isArray(fields)) {
          fields.forEach((field: string) => {
            if (field.includes('bool')) {
              const fieldName = field.split(':')[0].replace('pub ', '').trim();
              boolFields.push(`${structName}.${fieldName}`);
            }
          });
        }
      });
      
      // Validate that all bool fields in client mappings are booleans
      boolFields.forEach((fieldPath) => {
        const [structName, fieldName] = fieldPath.split('.');
        if (clientTypes[structName] && clientTypes[structName][fieldName]) {
          expect(clientTypes[structName][fieldName]).toBe('boolean');
        }
      });
    });
  });

  describe('Optional field handling', () => {
    it('should identify fields that can be optional in client', () => {
      // Fields that might be optional in client even if required in contract
      const optionalClientFields = [
        'Prompt.description',
        'Prompt.tags',
        'Bundle.expires_at',
        'AccessPass.expires_at'
      ];
      
      const clientTypes = clientMappings.type_mappings.contract_types;
      
      optionalClientFields.forEach((fieldPath) => {
        const [structName, fieldName] = fieldPath.split('.');
        if (clientTypes[structName]) {
          // These fields should exist in client mapping
          expect(clientTypes[structName][fieldName]).toBeDefined();
        }
      });
    });
  });
});
