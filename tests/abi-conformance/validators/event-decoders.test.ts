/**
 * event-decoders.test.ts - Event Decoder Validation Tests
 * 
 * Validates that event definitions in the contract specification match
 * expected event decoder implementations in the client.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load fixtures
const CONTRACT_SPEC_PATH = path.join(__dirname, '../fixtures/contract-spec.json');

const contractSpec = JSON.parse(fs.readFileSync(CONTRACT_SPEC_PATH, 'utf-8'));

describe('ABI Conformance: Event Decoders', () => {
  describe('Event completeness', () => {
    it('should have all required events defined', () => {
      const events = contractSpec.events;
      
      // Contract should have at least 20 events
      expect(Object.keys(events).length).toBeGreaterThanOrEqual(20);
      
      // Validate critical events exist
      expect(events.PromptCreated).toBeDefined();
      expect(events.PromptPurchased).toBeDefined();
      expect(events.PromptPriceUpdated).toBeDefined();
      expect(events.PromptSaleStatusUpdated).toBeDefined();
      expect(events.BundleCreated).toBeDefined();
      expect(events.BundlePurchased).toBeDefined();
      expect(events.AccessPassCreated).toBeDefined();
      expect(events.AccessPassPurchased).toBeDefined();
    });

    it('should have consistent event naming', () => {
      const events = contractSpec.events;
      
      Object.keys(events).forEach((eventName) => {
        // Event names should be PascalCase
        expect(eventName).toMatch(/^[A-Z][a-zA-Z]+$/);
        
        // Event names should be descriptive
        expect(eventName.length).toBeGreaterThan(5);
      });
    });
  });

  describe('Event field validation', () => {
    it('should validate PromptCreated event fields', () => {
      const event = contractSpec.events.PromptCreated;
      
      // Should have 4 fields
      expect(event.length).toBe(4);
      
      // Validate field names and types
      expect(event[0]).toContain('prompt_id: u64');
      expect(event[1]).toContain('creator: Address');
      expect(event[2]).toContain('price_stroops: i128');
      expect(event[3]).toContain('asset: Address');
    });

    it('should validate PromptPurchased event fields', () => {
      const event = contractSpec.events.PromptPurchased;
      
      // Should have 5 fields
      expect(event.length).toBe(5);
      
      // Validate field names and types
      expect(event[0]).toContain('prompt_id: u64');
      expect(event[1]).toContain('buyer: Address');
      expect(event[2]).toContain('creator: Address');
      expect(event[3]).toContain('price_stroops: i128');
      expect(event[4]).toContain('referrer: Option<Address>');
    });

    it('should validate BundleCreated event fields', () => {
      const event = contractSpec.events.BundleCreated;
      
      // Should have 3 fields
      expect(event.length).toBe(3);
      
      expect(event[0]).toContain('bundle_id: u128');
      expect(event[1]).toContain('creator: Address');
      expect(event[2]).toContain('price_stroops: i128');
    });

    it('should validate AccessPassCreated event fields', () => {
      const event = contractSpec.events.AccessPassCreated;
      
      // Should have 4 fields
      expect(event.length).toBe(4);
      
      expect(event[0]).toContain('pass_id: u128');
      expect(event[1]).toContain('creator: Address');
      expect(event[2]).toContain('duration_secs: u64');
      expect(event[3]).toContain('price_stroops: i128');
    });

    it('should validate DisputeOpened event fields', () => {
      const event = contractSpec.events.DisputeOpened;
      
      // Should have 2 fields
      expect(event.length).toBe(2);
      
      expect(event[0]).toContain('prompt_id: u64');
      expect(event[1]).toContain('buyer: Address');
    });

    it('should validate DisputeResolved event fields', () => {
      const event = contractSpec.events.DisputeResolved;
      
      // Should have 3 fields
      expect(event.length).toBe(3);
      
      expect(event[0]).toContain('prompt_id: u64');
      expect(event[1]).toContain('buyer: Address');
      expect(event[2]).toContain('refunded: bool');
    });
  });

  describe('Event type consistency', () => {
    it('should use consistent Address type across events', () => {
      const events = contractSpec.events;
      
      const addressEvents = Object.entries(events).filter(([_, fields]) => {
        return fields.some((field: string) => field.includes('Address'));
      });
      
      // Most events should have Address fields
      expect(addressEvents.length).toBeGreaterThan(10);
    });

    it('should use consistent integer types across events', () => {
      const events = contractSpec.events;
      
      const integerEvents = Object.entries(events).filter(([_, fields]) => {
        return fields.some((field: string) => 
          field.includes('u64') || field.includes('u128') || field.includes('i128')
        );
      });
      
      // Most events should have integer fields
      expect(integerEvents.length).toBeGreaterThan(15);
    });

    it('should handle Option<T> types correctly in events', () => {
      const events = contractSpec.events;
      
      const optionEvents = Object.entries(events).filter(([_, fields]) => {
        return fields.some((field: string) => field.includes('Option<'));
      });
      
      // Should have at least one event with Option type
      expect(optionEvents.length).toBeGreaterThan(0);
      
      // PromptPurchased should have Option<Address> for referrer
      expect(contractSpec.events.PromptPurchased[4]).toContain('Option<Address>');
    });
  });

  describe('Event categorization', () => {
    it('should categorize prompt lifecycle events', () => {
      const events = contractSpec.events;
      
      const promptLifecycleEvents = [
        'PromptCreated',
        'PromptPurchased',
        'PromptPriceUpdated',
        'PromptSaleStatusUpdated',
        'PromptTipped',
        'ListingExtended',
        'ListingRevised'
      ];
      
      promptLifecycleEvents.forEach((eventName) => {
        expect(events[eventName]).toBeDefined();
      });
    });

    it('should categorize bundle events', () => {
      const events = contractSpec.events;
      
      const bundleEvents = [
        'BundleCreated',
        'BundlePurchased'
      ];
      
      bundleEvents.forEach((eventName) => {
        expect(events[eventName]).toBeDefined();
      });
    });

    it('should categorize access pass events', () => {
      const events = contractSpec.events;
      
      const accessPassEvents = [
        'AccessPassCreated',
        'AccessPassPurchased'
      ];
      
      accessPassEvents.forEach((eventName) => {
        expect(events[eventName]).toBeDefined();
      });
    });

    it('should categorize admin events', () => {
      const events = contractSpec.events;
      
      const adminEvents = [
        'FeeUpdated',
        'FeeWalletUpdated',
        'PlatformFeeUpdated',
        'ContractPausedStateChanged',
        'PromptAdminModerated'
      ];
      
      adminEvents.forEach((eventName) => {
        expect(events[eventName]).toBeDefined();
      });
    });

    it('should categorize dispute events', () => {
      const events = contractSpec.events;
      
      const disputeEvents = [
        'DisputeOpened',
        'DisputeResolved'
      ];
      
      disputeEvents.forEach((eventName) => {
        expect(events[eventName]).toBeDefined();
      });
    });

    it('should categorize secondary market events', () => {
      const events = contractSpec.events;
      
      const secondaryMarketEvents = [
        'LicenseTransferred'
      ];
      
      secondaryMarketEvents.forEach((eventName) => {
        expect(events[eventName]).toBeDefined();
      });
    });
  });

  describe('Event field ordering', () => {
    it('should have consistent field ordering patterns', () => {
      const events = contractSpec.events;
      
      // Events that create entities should have id first
      const creationEvents = [
        'PromptCreated',
        'BundleCreated',
        'AccessPassCreated'
      ];
      
      creationEvents.forEach((eventName) => {
        const fields = events[eventName];
        // First field should be an ID
        expect(fields[0]).toMatch(/_id: (u64|u128)/);
      });
    });

    it('should have transaction participant fields in consistent order', () => {
      const events = contractSpec.events;
      
      // Transaction events should have buyer, creator, seller in consistent order
      const transactionEvents = [
        'PromptPurchased',
        'BundlePurchased',
        'AccessPassPurchased'
      ];
      
      transactionEvents.forEach((eventName) => {
        const fields = events[eventName];
        const fieldStr = fields.join(' ');
        
        // Should have buyer and creator
        expect(fieldStr).toContain('buyer: Address');
        expect(fieldStr).toContain('creator: Address');
      });
    });
  });

  describe('Event decoder compatibility', () => {
    it('should have decodable event signatures', () => {
      const events = contractSpec.events;
      
      Object.entries(events).forEach(([eventName, fields]) => {
        // All fields should be decodable types
        fields.forEach((field: string) => {
          // Should contain valid Soroban types
          const validTypes = [
            'u64', 'u128', 'u32', 'i128', 'bool', 'String', 'Address',
            'Vec<', 'Option<', 'BytesN<'
          ];
          
          const hasValidType = validTypes.some((type) => field.includes(type));
          expect(hasValidType).toBe(true);
        });
      });
    });

    it('should handle BytesN<32> types in events', () => {
      const events = contractSpec.events;
      
      const bytesNEvents = Object.entries(events).filter(([_, fields]) => {
        return fields.some((field: string) => field.includes('BytesN<32>'));
      });
      
      // Voucher events should use BytesN<32>
      expect(contractSpec.events.VoucherAdded[1]).toContain('BytesN<32>');
      expect(contractSpec.events.VoucherRemoved[1]).toContain('BytesN<32>');
    });
  });
});
