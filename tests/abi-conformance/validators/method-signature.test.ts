/**
 * method-signature.test.ts - Method Signature Validation Tests
 * 
 * Validates that client method signatures match the contract specification.
 * Tests parameter types, return types, and method names.
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

describe('ABI Conformance: Method Signatures', () => {
  describe('Client method coverage', () => {
    it('should have all required contract methods mapped in client', () => {
      const contractMethods = Object.keys(contractSpec.functions).filter(
        (name) => !name.startsWith('__') // Skip constructor
      );
      
      const clientMethods = Object.keys(clientMappings.client_methods.PromptHashClient);
      
      const missingMethods = contractMethods.filter((method) => {
        const contractMethod = contractSpec.functions[method];
        // Check if there's a corresponding client method
        return !clientMethods.some((clientMethod) => {
          const mapping = clientMappings.client_methods.PromptHashClient[clientMethod];
          return mapping.contract_method === method;
        });
      });
      
      expect(missingMethods).toEqual([]);
    });

    it('should not have extra client methods without contract backing', () => {
      const clientMethods = Object.keys(clientMappings.client_methods.PromptHashClient);
      
      const extraMethods = clientMethods.filter((clientMethod) => {
        const mapping = clientMappings.client_methods.PromptHashClient[clientMethod];
        const contractMethod = mapping.contract_method;
        return !contractSpec.functions[contractMethod];
      });
      
      expect(extraMethods).toEqual([]);
    });
  });

  describe('Parameter type validation', () => {
    it('should validate parameter types for getPrompt', () => {
      const mapping = clientMappings.client_methods.PromptHashClient.getPrompt;
      const contractSig = contractSpec.functions.get_prompt;
      
      // Parse contract signature: "fn get_prompt(env: Env, prompt_id: u64) -> Result<Prompt, Error>"
      const paramsMatch = contractSig.match(/\(([^)]+)\)/);
      expect(paramsMatch).toBeTruthy();
      
      const params = paramsMatch![1].split(',').map((p: string) => p.trim());
      
      // Should have 2 parameters
      expect(params.length).toBe(2);
      expect(params[0]).toContain('env: Env');
      expect(params[1]).toContain('prompt_id: u64');
      
      // Client mapping should match
      expect(mapping.parameters).toHaveLength(2);
      expect(mapping.parameters[0].type).toBe('Env');
      expect(mapping.parameters[1].type).toBe('u64');
    });

    it('should validate parameter types for createPrompt', () => {
      const mapping = clientMappings.client_methods.PromptHashClient.createPrompt;
      const contractSig = contractSpec.functions.create_prompt;
      
      const paramsMatch = contractSig.match(/\(([^)]+)\)/);
      expect(paramsMatch).toBeTruthy();
      
      const params = paramsMatch![1].split(',').map((p: string) => p.trim());
      
      // Should have 11 parameters (env + 10 fields)
      expect(params.length).toBe(11);
      
      // Client mapping should match
      expect(mapping.parameters).toHaveLength(11);
      expect(mapping.parameters[0].type).toBe('Env');
      expect(mapping.parameters[1].type).toBe('Address');
      expect(mapping.parameters[10].type).toBe('ListingConfig');
    });

    it('should validate parameter types for purchasePrompt', () => {
      const mapping = clientMappings.client_methods.PromptHashClient.purchasePrompt;
      const contractSig = contractSpec.functions.buy_prompt;
      
      const paramsMatch = contractSig.match(/\(([^)]+)\)/);
      expect(paramsMatch).toBeTruthy();
      
      const params = paramsMatch![1].split(',').map((p: string) => p.trim());
      
      // Should have 6 parameters
      expect(params.length).toBe(6);
      
      // Check for Option types
      expect(params.some((p: string) => p.includes('Option<Address>'))).toBe(true);
      expect(params.some((p: string) => p.includes('Option<Bytes>'))).toBe(true);
      
      // Client mapping should handle Option types
      expect(mapping.parameters.some((p) => p.mapped.includes('null'))).toBe(true);
    });
  });

  describe('Return type validation', () => {
    it('should validate return types for getPrompt', () => {
      const mapping = clientMappings.client_methods.PromptHashClient.getPrompt;
      const contractSig = contractSpec.functions.get_prompt;
      
      // Parse return type: "Result<Prompt, Error>"
      const returnMatch = contractSig.match(/->\s*(.+)/);
      expect(returnMatch).toBeTruthy();
      
      const returnType = returnMatch![1].trim();
      expect(returnType).toBe('Result<Prompt, Error>');
      
      // Client should map to Promise<PromptRecord>
      expect(mapping.mapped_return).toBe('Promise<PromptRecord>');
    });

    it('should validate return types for createPrompt', () => {
      const mapping = clientMappings.client_methods.PromptHashClient.createPrompt;
      const contractSig = contractSpec.functions.create_prompt;
      
      const returnMatch = contractSig.match(/->\s*(.+)/);
      expect(returnMatch).toBeTruthy();
      
      const returnType = returnMatch![1].trim();
      expect(returnType).toBe('Result<u64, Error>');
      
      // Client should map to Promise with success object
      expect(mapping.mapped_return).toContain('Promise');
      expect(mapping.mapped_return).toContain('success');
    });

    it('should validate return types for void methods', () => {
      const mapping = clientMappings.client_methods.PromptHashClient.setPromptSaleStatus;
      const contractSig = contractSpec.functions.set_prompt_sale_status;
      
      const returnMatch = contractSig.match(/->\s*(.+)/);
      expect(returnMatch).toBeTruthy();
      
      const returnType = returnMatch![1].trim();
      expect(returnType).toBe('Result<(), Error>');
      
      // Client should map to Promise with success boolean
      expect(mapping.mapped_return).toBe('Promise<{ success: boolean }>');
    });
  });

  describe('Integer width validation', () => {
    it('should correctly map u64 to bigint', () => {
      const typeMappings = clientMappings.type_mappings.primitive_types;
      expect(typeMappings.u64).toBe('bigint');
    });

    it('should correctly map u128 to bigint', () => {
      const typeMappings = clientMappings.type_mappings.primitive_types;
      expect(typeMappings.u128).toBe('bigint');
    });

    it('should correctly map i128 to bigint', () => {
      const typeMappings = clientMappings.type_mappings.primitive_types;
      expect(typeMappings.i128).toBe('bigint');
    });

    it('should correctly map u32 to number', () => {
      const typeMappings = clientMappings.type_mappings.primitive_types;
      expect(typeMappings.u32).toBe('number');
    });

    it('should correctly map i32 to number', () => {
      const typeMappings = clientMappings.type_mappings.primitive_types;
      expect(typeMappings.i32).toBe('number');
    });
  });

  describe('Complex type validation', () => {
    it('should correctly map Vec<T> to Array<T>', () => {
      const typeMappings = clientMappings.type_mappings.complex_types;
      expect(typeMappings['Vec<T>']).toBe('Array<T>');
    });

    it('should correctly map Option<T> to T | null', () => {
      const typeMappings = clientMappings.type_mappings.complex_types;
      expect(typeMappings['Option<T>']).toBe('T | null');
    });

    it('should correctly map Result<T, E> to Promise<T>', () => {
      const typeMappings = clientMappings.type_mappings.complex_types;
      expect(typeMappings['Result<T, E>']).toBe('Promise<T>');
    });
  });

  describe('Address type validation', () => {
    it('should map Address to string', () => {
      const typeMappings = clientMappings.type_mappings.primitive_types;
      expect(typeMappings.Address).toBe('string');
    });

    it('should map BytesN<32> to string', () => {
      const typeMappings = clientMappings.type_mappings.primitive_types;
      expect(typeMappings['BytesN<32>']).toBe('string');
    });
  });
});
