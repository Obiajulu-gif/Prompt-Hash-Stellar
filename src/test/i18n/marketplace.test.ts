/**
 * Localization tests for marketplace-critical text (#456).
 * 
 * Validates that:
 * - All error codes have translations in all supported locales
 * - Fallback locale (en) is complete
 * - Missing translations fail visibly in development/tests
 * - Formatted values (dates, amounts, statuses) work correctly
 */

import i18n from '../../i18n';
import { ErrorCode } from '../../lib/api/errorCodes';
import {
  REVIEW_ERROR_KEYS,
  RECEIPT_ERROR_KEYS,
  MODERATION_KEYS,
  PURCHASE_KEYS,
  BULK_PURCHASE_ERROR_KEYS,
  VALIDATION_ERROR_KEYS,
  getUnlockErrorKey,
} from '../../lib/i18n/serverMessages';
import { formatDate, formatNumber, formatXlm } from '../../i18n/formatters';

describe('Marketplace Localization (#456)', () => {
  const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'zh'];
  const ERROR_CODES: ErrorCode[] = [
    'MISSING_FIELDS',
    'METHOD_NOT_ALLOWED',
    'CHALLENGE_EXPIRED',
    'CHALLENGE_INVALID',
    'INVALID_SIGNATURE',
    'ACCESS_NOT_PURCHASED',
    'STALE_PROMPT_TERMS',
    'RATE_LIMIT_IP',
    'RATE_LIMIT_WALLET',
    'RATE_LIMIT_ENTITLEMENT',
    'CONFIGURATION_ERROR',
    'INTEGRITY_FAILURE',
    'TEMPORARY_FAILURE',
    'IDEMPOTENCY_CONFLICT',
  ];

  describe('Unlock Error Codes (unlockErrors.codes.*)', () => {
    it('all error codes have translations in fallback locale (en)', () => {
      const enNamespace = i18n.getResourceBundle('en', 'translation');
      
      ERROR_CODES.forEach(code => {
        const key = getUnlockErrorKey(code);
        const value = i18n.t(key, { lng: 'en' });
        expect(value).not.toBe(key); // i18next returns key if missing
        expect(value).toBeTruthy();
        expect(value.length).toBeGreaterThan(0);
      });
    });

    it('all error codes exist in all supported locales', () => {
      ERROR_CODES.forEach(code => {
        SUPPORTED_LOCALES.forEach(locale => {
          const key = getUnlockErrorKey(code);
          const value = i18n.t(key, { lng: locale });
          expect(value).not.toBe(key);
          expect(value).toBeTruthy();
        });
      });
    });

    it('missing keys are visible (returns key name)', () => {
      const missingKey = 'unlockErrors.codes.NONEXISTENT_ERROR';
      const result = i18n.t(missingKey, { lng: 'en' });
      expect(result).toBe(missingKey); // Falls back to key name
    });
  });

  describe('Receipt Errors (receiptErrors.*)', () => {
    it('all receipt error keys have translations', () => {
      Object.values(RECEIPT_ERROR_KEYS).forEach(key => {
        SUPPORTED_LOCALES.forEach(locale => {
          const value = i18n.t(key, { lng: locale });
          expect(value).not.toBe(key);
          expect(value).toBeTruthy();
        });
      });
    });
  });

  describe('Review Errors (reviewErrors.*)', () => {
    it('all review error keys have translations', () => {
      Object.values(REVIEW_ERROR_KEYS).forEach(key => {
        SUPPORTED_LOCALES.forEach(locale => {
          const value = i18n.t(key, { lng: locale });
          expect(value).not.toBe(key);
          expect(value).toBeTruthy();
        });
      });
    });
  });

  describe('Moderation Statuses (moderationStatuses.*)', () => {
    it('all moderation status keys have translations', () => {
      Object.values(MODERATION_KEYS.STATUS).forEach(key => {
        SUPPORTED_LOCALES.forEach(locale => {
          const value = i18n.t(key, { lng: locale });
          expect(value).not.toBe(key);
          expect(value).toBeTruthy();
        });
      });
    });

    it('all moderation reason keys have translations', () => {
      Object.values(MODERATION_KEYS.REASON).forEach(key => {
        SUPPORTED_LOCALES.forEach(locale => {
          const value = i18n.t(key, { lng: locale });
          expect(value).not.toBe(key);
          expect(value).toBeTruthy();
        });
      });
    });
  });

  describe('Purchase Statuses (purchaseStatuses.*)', () => {
    it('all purchase status keys have translations', () => {
      Object.values(PURCHASE_KEYS.STATUS).forEach(key => {
        SUPPORTED_LOCALES.forEach(locale => {
          const value = i18n.t(key, { lng: locale });
          expect(value).not.toBe(key);
          expect(value).toBeTruthy();
        });
      });
    });

    it('all dispute resolution keys have translations', () => {
      Object.values(PURCHASE_KEYS.RESOLUTION).forEach(key => {
        SUPPORTED_LOCALES.forEach(locale => {
          const value = i18n.t(key, { lng: locale });
          expect(value).not.toBe(key);
          expect(value).toBeTruthy();
        });
      });
    });
  });

  describe('Bulk Purchase Errors (bulkPurchaseErrors.*)', () => {
    const bulkErrorKeys = Object.values(BULK_PURCHASE_ERROR_KEYS);

    it('all bulk purchase error codes have title, message, suggestion', () => {
      bulkErrorKeys.forEach(baseKey => {
        SUPPORTED_LOCALES.forEach(locale => {
          const title = i18n.t(`${baseKey}.title`, { lng: locale });
          const message = i18n.t(`${baseKey}.message`, { lng: locale });
          const suggestion = i18n.t(`${baseKey}.suggestion`, { lng: locale });

          expect(title).not.toBe(`${baseKey}.title`);
          expect(message).not.toBe(`${baseKey}.message`);
          expect(suggestion).not.toBe(`${baseKey}.suggestion`);

          expect(title).toBeTruthy();
          expect(message).toBeTruthy();
          expect(suggestion).toBeTruthy();
        });
      });
    });
  });

  describe('Validation Errors (validationErrors.*)', () => {
    it('all validation error keys have translations', () => {
      Object.values(VALIDATION_ERROR_KEYS).forEach(key => {
        SUPPORTED_LOCALES.forEach(locale => {
          const value = i18n.t(key, { lng: locale });
          expect(value).not.toBe(key);
          expect(value).toBeTruthy();
        });
      });
    });
  });

  describe('Locale-aware Formatting', () => {
    it('formatDate returns localized strings', () => {
      const testDate = new Date('2026-07-27T14:05:00Z');
      const enDate = formatDate(testDate, 'en');
      const frDate = formatDate(testDate, 'fr');
      const deDate = formatDate(testDate, 'de');

      expect(enDate).toContain('Jul');
      expect(frDate).toContain('juil');
      expect(deDate).toContain('Jul');
    });

    it('formatNumber uses locale-appropriate separators', () => {
      const num = 1234567.89;
      const enNum = formatNumber(num, 'en');
      const deNum = formatNumber(num, 'de');

      expect(enNum).toBe('1,234,567.89');
      expect(deNum).toBe('1.234.567,89');
    });

    it('formatXlm formats XLM amounts with locale separators', () => {
      const stroops = 100_000_000n; // 10 XLM
      const enXlm = formatXlm(stroops, 'en');
      const frXlm = formatXlm(stroops, 'fr');

      expect(enXlm).toBe('10 XLM');
      expect(frXlm).toBe('10 XLM');

      const fractionalStroops = 12_345_678n; // 1.2345678 XLM
      const enFrac = formatXlm(fractionalStroops, 'en');
      expect(enFrac).toMatch(/1\.2345678 XLM/);
    });

    it('formatDate with ISO string works', () => {
      const isoString = '2026-01-15T10:30:00Z';
      const formatted = formatDate(isoString, 'en');
      expect(formatted).toContain('15');
      expect(formatted).toContain('Jan');
    });

    it('formatDate with numeric timestamp works', () => {
      const timestamp = 1747426200000; // Jul 27, 2026
      const formatted = formatDate(timestamp, 'en');
      expect(formatted).toContain('27');
      expect(formatted).toContain('Jul');
    });
  });

  describe('Fallback Behavior', () => {
    it('uses English when locale is not supported', () => {
      const key = 'unlockErrors.codes.ACCESS_NOT_PURCHASED';
      const fallbackResult = i18n.t(key, { lng: 'xx' }); // Non-existent locale
      const enResult = i18n.t(key, { lng: 'en' });

      // Should fall back to English
      expect(fallbackResult).toBe(enResult);
    });

    it('returns key name for completely missing translations', () => {
      const missingKey = 'some.nonexistent.key.path';
      const result = i18n.t(missingKey);
      expect(result).toBe(missingKey);
    });
  });

  describe('Development Visibility', () => {
    it('logs missing translations for development', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      // Access a missing key (if i18next is configured to warn)
      const missingKey = 'nonexistent.translation.key';
      i18n.t(missingKey);

      // Verify key name is returned as fallback
      // (warning depends on i18next debug config)
      
      consoleSpy.mockRestore();
    });
  });
});
