# Marketplace Localization Framework (#456)

## Overview

This framework ensures all buyer and creator-facing text in marketplace critical flows is localized:
- Purchase errors and unlock states
- Receipts and purchase status
- Moderation states and reasons
- Review validation messages
- Bulk purchase error guidance

**Technical logs remain in English for debugging.**

## Supported Locales

- `en` - English
- `es` - Español (Spanish)
- `fr` - Français (French)
- `zh` - 中文 (Chinese)

## Architecture

### Translation Keys

All user-facing strings are stored as i18n keys in locale JSON files:

```
src/i18n/locales/
├── en.json    # English translations (fallback)
├── es.json    # Spanish
├── fr.json    # French
└── zh.json    # Chinese
```

### Backend Message Mapping

Backend APIs return i18n **keys** (not strings) for frontend localization:

**src/lib/i18n/serverMessages.ts** exports:
- Error code key constants
- Helper functions to map error codes → i18n keys
- Moderation action/reason mappings

### Frontend Integration

The frontend fetches keys from API responses and localizes via `i18next.t()`:

```typescript
// API response includes key
const response = await fetch('/api/prompts/receipt?...');
const data = await response.json();

// data.purchaseStatusKey = 'purchaseStatuses.purchased'
// data.disputeResolutionKey = 'disputeResolutions.refunded'

// Frontend localizes
const statusLabel = i18n.t(data.purchaseStatusKey);
const resolutionLabel = i18n.t(data.disputeResolutionKey);
```

## Error Categories

### 1. Unlock Errors (14 codes)

**i18n path:** `unlockErrors.codes.*`

Examples:
- `ACCESS_NOT_PURCHASED` → "You have not purchased access to this prompt. Complete a purchase first."
- `RATE_LIMIT_WALLET` → "Too many unlock attempts for this wallet. Please wait a minute and try again."
- `CHALLENGE_EXPIRED` → "Your session has expired. Click Decrypt Content to try again."

All codes have translations in all 4 locales.

### 2. Receipt Errors

**i18n path:** `receiptErrors.*`

- `notFound`: Purchase transaction not found
- `configMissing`: Configuration error
- `buildFailed`: Failed to build receipt

### 3. Review Validation Errors

**i18n path:** `reviewErrors.*`

- `missingFields`
- `signatureRequired`
- `invalidRating`
- `textTooShort`
- `textTooLong`
- `invalidSignature`
- `accessDenied`
- `methodNotAllowed`

### 4. Moderation States

**i18n path:** `moderationStatuses.*` and `moderationReasons.*`

**Statuses:**
- `restricted` → "Restricted" (or locale equivalent)
- `active` → "Active"
- `retired` → "Retired"

**Reasons:**
- `copyright` → "Copyright violation"
- `abuse` → "Abusive content"
- `malware` → "Malware or security risk"
- `policy_violation` → "Policy violation"
- `other` → "Other"

### 5. Purchase Status & Dispute Resolution

**i18n path:** `purchaseStatuses.*` and `disputeResolutions.*`

**Purchase Statuses:**
- `purchased` → "Purchased"
- `disputed` → "Disputed"
- `resolved` → "Resolved"

**Dispute Resolutions:**
- `refunded` → "Refunded"
- `rejected` → "Rejected"

### 6. Bulk Purchase Errors

**i18n path:** `bulkPurchaseErrors.<ErrorCode>.*`

11 error codes, each with nested `title`, `message`, `suggestion`:

```json
{
  "bulkPurchaseErrors": {
    "PromptNotFound": {
      "title": "Batch Contains Invalid Items",
      "message": "One or more prompts in the batch do not exist...",
      "suggestion": "Use the validation tool..."
    },
    ...
  }
}
```

### 7. Validation Errors

**i18n path:** `validationErrors.*`

- `promptNotFound`
- `alreadyPurchased`
- `insufficientBalance`
- `promptInactive`
- `insufficientPayment`

## Adding a New Locale

### 1. Create Translation File

Add `src/i18n/locales/<locale>.json` with structure matching `en.json`:

```json
{
  "unlockErrors": {
    "codes": {
      "ACCESS_NOT_PURCHASED": "Your translated message",
      ...
    }
  },
  "receiptErrors": { ... },
  "reviewErrors": { ... },
  "moderationStatuses": { ... },
  ...
}
```

### 2. Register in i18n Config

Edit `src/i18n/index.ts`:

```typescript
import it from './locales/it.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'zh', label: '中文' },
  { code: 'it', label: 'Italiano' },  // Add here
] as const;

i18n.init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    zh: { translation: zh },
    it: { translation: it },  // Add here
  },
  ...
});
```

### 3. Update Tests

Run the test suite to verify all keys are translated:

```bash
npm test -- src/test/i18n/marketplace.test.ts
```

## Validation & Testing

### Development

Missing translations are visible:
- Incomplete locale files show key names in UI
- i18next logs missing keys in development mode
- Tests fail if translations are incomplete

### Tests

**File:** `src/test/i18n/marketplace.test.ts`

Coverage:
- ✅ All error codes have translations in all locales
- ✅ Fallback locale (en) is complete
- ✅ Missing keys return key name (visible in dev)
- ✅ Formatted values (dates, amounts, statuses)
- ✅ Locale-aware formatting for numbers, dates, XLM

**Run tests:**
```bash
npm test -- --testPathPattern="marketplace.test"
```

## API Endpoint Changes

### Receipt Endpoint

**Before:**
```json
{
  "purchaseStatus": "purchased",
  "disputeResolution": null
}
```

**After:**
```json
{
  "purchaseStatus": "purchased",
  "purchaseStatusKey": "purchaseStatuses.purchased",
  "disputeResolution": null,
  "disputeResolutionKey": null
}
```

### Review Endpoint

Validation errors now include i18n keys:

```json
{
  "error": "reviewErrors.invalidRating",
  "code": "INVALID_RATING"
}
```

### Moderation Endpoint

Status and reason mappings included:

```json
{
  "success": true,
  "newStatus": "Restricted",
  "newStatusKey": "moderationStatuses.restricted",
  "reasonKey": "moderationReasons.policy_violation"
}
```

## Best Practices

### Backend

1. **Return keys, not strings** in API responses
2. **Keep technical logs in English** (`req.logger.error()`)
3. **Never localize enum values** (restricted, purchased, etc.)
4. **Use helper functions** from `serverMessages.ts`

Example:

```typescript
// ✅ Good
import { getUnlockErrorKey } from '../i18n/serverMessages';

res.status(401).json({
  error: getUnlockErrorKey('ACCESS_NOT_PURCHASED'),
  code: 'ACCESS_NOT_PURCHASED',
});

// ❌ Bad
res.status(401).json({
  error: "You have not purchased access...",  // Hard-coded string
  code: 'ACCESS_NOT_PURCHASED',
});
```

### Frontend

1. **Use `i18n.t()` for user-facing text**
2. **Localize API error responses**
3. **Use formatters for dates/amounts**

Example:

```typescript
import { useTranslation } from 'react-i18next';
import { formatXlm, formatDate } from '../i18n/formatters';

export function Receipt({ receipt }) {
  const { t } = useTranslation();

  return (
    <div>
      <p>{t(receipt.purchaseStatusKey)}</p>
      <p>{t('receipt.amount_label')}: {formatXlm(receipt.amount)}</p>
      <p>{t('receipt.date_label')}: {formatDate(receipt.createdAt)}</p>
    </div>
  );
}
```

## Migration Checklist

- ✅ Translation catalogs created (en, es, fr, zh)
- ✅ Backend message mapping utilities (`serverMessages.ts`)
- ✅ API endpoints updated to return keys
- ✅ Receipt, review, and moderation endpoints refactored
- ✅ Bulk purchase errors mapped to i18n
- ✅ Test coverage for all locales and fallback behavior
- ✅ Documentation added (this file)

## Troubleshooting

### Missing Translation Key

**Symptom:** Key name appears in UI (e.g., "unlockErrors.codes.ACCESS_NOT_PURCHASED")

**Cause:** Translation missing in locale JSON

**Fix:** Add key to all locale files and run tests

### Wrong Language Displayed

**Symptom:** English appears for all users

**Cause:** Language detection not working or locale not set

**Check:**
```typescript
import i18n from 'i18next';
console.log(i18n.language);  // Should be detected locale
```

### Tests Fail

**Symptom:** "Key not found" or "undefined" in test output

**Cause:** Translation key structure mismatch

**Fix:** Verify JSON structure in locale file matches test expectations

---

**Last Updated:** September 2026  
**Maintainer:** Prompt Hash Team
