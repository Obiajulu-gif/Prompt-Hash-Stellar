/**
 * error-codes.test.ts - Error Code Validation Tests
 * 
 * Validates that error codes in the contract specification are correctly
 * mapped and that no error codes have been changed or removed.
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

describe('ABI Conformance: Error Codes', () => {
  describe('Error code completeness', () => {
    it('should have all required error codes defined', () => {
      const errors = contractSpec.errors;
      
      // Contract should have 40 error codes
      expect(Object.keys(errors).length).toBeGreaterThanOrEqual(40);
      
      // Validate critical error codes exist
      expect(errors.Unauthorized).toBeDefined();
      expect(errors.PromptNotFound).toBeDefined();
      expect(errors.CreatorCannotBuy).toBeDefined();
      expect(errors.AlreadyPurchased).toBeDefined();
      expect(errors.PromptInactive).toBeDefined();
    });

    it('should have unique error code numbers', () => {
      const errors = contractSpec.errors;
      const errorCodes = Object.values(errors).map(Number);
      const uniqueCodes = new Set(errorCodes);
      
      expect(uniqueCodes.size).toBe(errorCodes.length);
    });

    it('should have sequential error code numbers starting from 1', () => {
      const errors = contractSpec.errors;
      const errorCodes = Object.values(errors).map(Number).sort((a, b) => a - b);
      
      // First error code should be 1
      expect(errorCodes[0]).toBe(1);
      
      // Error codes should be sequential (no gaps)
      for (let i = 1; i < errorCodes.length; i++) {
        expect(errorCodes[i]).toBe(errorCodes[i - 1] + 1);
      }
    });
  });

  describe('Error code stability', () => {
    it('should not change error code numbers (breaking change)', () => {
      const errors = contractSpec.errors;
      
      // Critical error codes that must never change
      const criticalErrorCodes = {
        Unauthorized: '1',
        PromptNotFound: '2',
        CreatorCannotBuy: '3',
        AlreadyPurchased: '5',
        PromptInactive: '4',
        InvalidPrice: '6',
        InvalidTitleLength: '8',
        InvalidPreviewLength: '10',
        InvalidEncryptedPromptLength: '11',
        InvalidWrappedKeyLength: '12',
        InvalidIvLength: '14',
        InvalidImageUrlLength: '13',
        FeeWalletNotSet: '15',
        XlmAddressNotSet: '16',
        InvalidFeePercentage: '7',
        ContractIsPaused: '19',
        ReentrancyGuard: '18'
      };
      
      Object.entries(criticalErrorCodes).forEach(([errorName, expectedCode]) => {
        expect(errors[errorName]).toBe(expectedCode);
      });
    });

    it('should have descriptive error names', () => {
      const errors = contractSpec.errors;
      
      Object.keys(errors).forEach((errorName) => {
        // Error names should be PascalCase
        expect(errorName).toMatch(/^[A-Z][a-zA-Z]+$/);
        
        // Error names should not be too short
        expect(errorName.length).toBeGreaterThan(2);
      });
    });
  });

  describe('Error code categorization', () => {
    it('should categorize authorization errors', () => {
      const errors = contractSpec.errors;
      
      const authErrors = [
        'Unauthorized',
        'CreatorCannotBuy',
        'ReferrerCannotBeBuyerOrCreator'
      ];
      
      authErrors.forEach((errorName) => {
        expect(errors[errorName]).toBeDefined();
      });
    });

    it('should categorize validation errors', () => {
      const errors = contractSpec.errors;
      
      const validationErrors = [
        'InvalidPrice',
        'InvalidTitleLength',
        'InvalidPreviewLength',
        'InvalidEncryptedPromptLength',
        'InvalidWrappedKeyLength',
        'InvalidIvLength',
        'InvalidImageUrlLength',
        'InvalidCategoryLength',
        'InvalidFeePercentage',
        'InvalidAsset',
        'InvalidSplits',
        'InvalidPaymentAmount',
        'InvalidVoucher',
        'InvalidBundle',
        'InvalidAccessDuration',
        'InvalidLicenseTransfer',
        'InvalidDiscountPercentage',
        'InvalidReferralPercentage'
      ];
      
      validationErrors.forEach((errorName) => {
        expect(errors[errorName]).toBeDefined();
      });
    });

    it('should categorize business logic errors', () => {
      const errors = contractSpec.errors;
      
      const businessLogicErrors = [
        'PromptNotFound',
        'AlreadyPurchased',
        'PromptInactive',
        'LicenseNotFound',
        'ListingExpired',
        'MaxSupplyReached',
        'BundleNotFound',
        'AccessPassNotFound',
        'DisputeNotFound',
        'DisputeAlreadyOpen',
        'DisputeResolved'
      ];
      
      businessLogicErrors.forEach((errorName) => {
        expect(errors[errorName]).toBeDefined();
      });
    });

    it('should categorize system errors', () => {
      const errors = contractSpec.errors;
      
      const systemErrors = [
        'ArithmeticOverflow',
        'ContractIsPaused',
        'ReentrancyGuard',
        'FeeWalletNotSet',
        'XlmAddressNotSet',
        'FeeExceedsMaximum'
      ];
      
      systemErrors.forEach((errorName) => {
        expect(errors[errorName]).toBeDefined();
      });
    });
  });

  describe('Error code ranges', () => {
    it('should have error codes in expected ranges', () => {
      const errors = contractSpec.errors;
      const errorCodes = Object.values(errors).map(Number);
      
      // Error codes should be positive
      errorCodes.forEach((code) => {
        expect(code).toBeGreaterThan(0);
      });
      
      // Error codes should be reasonable (not too large)
      errorCodes.forEach((code) => {
        expect(code).toBeLessThan(1000);
      });
    });

    it('should reserve error code ranges for future use', () => {
      const errors = contractSpec.errors;
      const errorCodes = Object.values(errors).map(Number);
      
      // Current error codes should be in a reasonable range
      const maxErrorCode = Math.max(...errorCodes);
      expect(maxErrorCode).toBeLessThan(100);
    });
  });

  describe('Error naming conventions', () => {
    it('should use consistent naming for validation errors', () => {
      const errors = contractSpec.errors;
      
      const validationErrors = Object.keys(errors).filter((name) =>
        name.startsWith('Invalid')
      );
      
      // All validation errors should start with 'Invalid'
      expect(validationErrors.length).toBeGreaterThan(10);
    });

    it('should use consistent naming for not found errors', () => {
      const errors = contractSpec.errors;
      
      const notFoundErrors = Object.keys(errors).filter((name) =>
        name.includes('NotFound')
      );
      
      expect(notFoundErrors.length).toBeGreaterThan(2);
    });
  });
});
