# Payout Readiness API Reference

This document describes the payout readiness validation system that ensures creators can receive earnings before publishing paid prompts.

## Overview

The payout readiness system validates four key requirements:

1. **Wallet Connection** - Valid Stellar address connected
2. **Payout Destination** - Configured address where earnings will be sent
3. **Creator Profile** - Complete profile with required fields
4. **Settlement Readiness** - Sufficient XLM balance for transaction fees

## Core Functions

### `validatePayoutReadiness(data: CreatorReadinessData): PayoutReadinessResult`

Validates all payout readiness requirements for a creator.

**Parameters:**
- `data: CreatorReadinessData` - Creator's current data and configuration

**Returns:**
- `PayoutReadinessResult` - Validation result with status and actionable feedback

**Example:**
```typescript
import { validatePayoutReadiness } from '@/lib/validation/payoutReadiness';

const data = {
  address: 'GCTESTADDRESS...',
  profile: {
    displayName: 'Test Creator',
    bio: 'I create amazing prompts',
    // ... other profile fields
  },
  payoutPreferences: {
    payoutAddress: 'GDPAYOUTADDRESS...',
  },
  walletBalance: '5.0'
};

const result = validatePayoutReadiness(data);
console.log(result.isReady); // true/false
console.log(result.blockers); // Array of blocking issues
```

### `checkCreatorPayoutReadiness(address: string, profile?: CreatorProfile, walletBalance?: string): PayoutReadinessResult`

Convenience function that loads payout preferences and validates readiness.

**Parameters:**
- `address: string` - Creator's Stellar address
- `profile?: CreatorProfile` - Optional creator profile
- `walletBalance?: string` - Optional wallet balance in XLM

**Returns:**
- `PayoutReadinessResult` - Validation result

### `shouldBlockPaidPublication(readiness: PayoutReadinessResult): boolean`

Determines if paid prompt publication should be blocked.

**Parameters:**
- `readiness: PayoutReadinessResult` - Result from validation

**Returns:**
- `boolean` - True if publication should be blocked

## Data Types

### `CreatorReadinessData`

```typescript
interface CreatorReadinessData {
  address: string;
  profile?: CreatorProfile | null;
  payoutPreferences?: PayoutPreferences | null;
  hasActivePrompts?: boolean;
  walletBalance?: string;
}
```

### `PayoutReadinessResult`

```typescript
interface PayoutReadinessResult {
  isReady: boolean;
  checks: PayoutReadinessCheck[];
  blockers: string[];
  warnings: string[];
}
```

### `PayoutReadinessCheck`

```typescript
interface PayoutReadinessCheck {
  id: string;
  name: string;
  description: string;
  status: "pass" | "fail" | "warn";
  message: string;
  actionUrl?: string;
  actionText?: string;
}
```

### `PayoutPreferences`

```typescript
interface PayoutPreferences {
  payoutAddress: string;
  preferredCurrency?: "XLM";
  minimumPayout?: number;
}
```

## React Hooks

### `usePayoutReadiness()`

Hook for managing payout readiness state in React components.

**Returns:**
```typescript
{
  readiness: PayoutReadinessResult | null;
  isLoading: boolean;
  isReady: boolean;
  shouldBlock: boolean;
  blockingIssues: string[];
  refreshReadiness: () => void;
}
```

**Example:**
```typescript
import { usePayoutReadiness } from '@/hooks/usePayoutReadiness';

function CreatePromptForm() {
  const { isReady, shouldBlock, blockingIssues } = usePayoutReadiness();
  
  return (
    <form onSubmit={handleSubmit}>
      {shouldBlock && (
        <div className="error">
          Complete setup: {blockingIssues.join(', ')}
        </div>
      )}
      <button 
        type="submit" 
        disabled={shouldBlock}
      >
        {shouldBlock ? 'Complete Setup First' : 'Create Prompt'}
      </button>
    </form>
  );
}
```

### `usePayoutReadinessGate()`

Simplified hook for gate checking (blocking/allowing publication).

**Returns:**
```typescript
{
  shouldBlock: boolean;
  isLoading: boolean;
  blockingIssues: string[];
}
```

## Validation Rules

### Wallet Connection

- **Pass:** Valid Stellar Ed25519 public key (56 chars, starts with 'G') with correct checksum
- **Fail:** No address, invalid checksum, secret key (`S...`), or non-Stellar format
- **Action:** Connect wallet in profile settings

### Payout Destination

- **Pass:** Valid Stellar public key (`G...`) or Muxed Account (`M...` SEP-0023) configured for payouts
- **Warn:** Using same address as wallet (allowed but not recommended)
- **Fail:** 
  - Missing payout address
  - Invalid format/checksum
  - Secret key (`S...`) or Contract ID (`C...`)
  - Custodial exchange destination requiring a memo (SEP-0029) without a Muxed Account address
  - Unfunded destination account on the target Stellar network
- **Action:** Configure in Profile → Payout Settings (provide a personal wallet or an exchange Muxed Account starting with 'M')

### Creator Profile

- **Pass:** Complete profile with display name and bio
- **Warn:** Missing optional fields (avatar, website, social links)
- **Fail:** Missing required fields (display name or bio)
- **Action:** Complete in Profile → Settings

### Settlement Readiness

- **Pass:** ≥2.0 XLM balance
- **Warn:** 1.0-2.0 XLM balance (sufficient but low)
- **Fail:** <1.0 XLM balance (insufficient for fees)
- **Action:** Add XLM to wallet

## Components

### `<PayoutReadinessBanner>`

Compact status banner for payout readiness.

**Props:**
- `className?: string` - Additional CSS classes
- `showWhenReady?: boolean` - Show banner even when ready (default: false)

### `<PayoutReadinessChecklist>`

Detailed interactive checklist for payout setup.

**Props:**
- `showTitle?: boolean` - Show checklist title (default: true)
- `className?: string` - Additional CSS classes  
- `onRefresh?: () => void` - Called when refresh is triggered

### `<PayoutReadinessPage>`

Full-page component for payout readiness management.

## Error Handling

All validation functions handle errors gracefully:

- **Network errors:** Return warning status with user-friendly messages
- **Data corruption:** Fall back to requiring manual verification
- **Missing dependencies:** Show loading states until data is available
- **Validation failures:** Provide specific, actionable error messages

## Storage

Payout preferences are stored in localStorage:

- **Key pattern:** `prompt-hash:payout:${address}`
- **Data format:** JSON-serialized `PayoutPreferences`
- **Fallbacks:** Graceful handling of missing or corrupted data

## Integration Points

### CreatePromptForm

- Validates readiness before form submission
- Blocks publication when setup is incomplete
- Shows actionable error messages and fix links
- Preserves draft content during setup completion

### PayoutSettingsPage

- Real-time validation of payout addresses
- Integration with readiness status display
- Automatic refresh after configuration changes
- Direct links to detailed readiness checklist

## Best Practices

1. **Always check readiness** before allowing paid prompt submission
2. **Show clear feedback** about what needs to be completed
3. **Provide direct action links** to fix blocking issues
4. **Preserve user work** (drafts) while they complete setup
5. **Handle errors gracefully** with fallback states
6. **Update in real-time** when configuration changes
7. **Test all scenarios** including edge cases and errors

## Migration Guide

For existing implementations:

1. **Import the validation system:**
   ```typescript
   import { usePayoutReadiness } from '@/hooks/usePayoutReadiness';
   ```

2. **Add validation to submission flows:**
   ```typescript
   const { shouldBlock, blockingIssues } = usePayoutReadiness();
   
   const handleSubmit = () => {
     if (shouldBlock) {
       setError(`Complete setup: ${blockingIssues.join(', ')}`);
       return;
     }
     // Continue with submission
   };
   ```

3. **Update UI to show readiness status:**
   ```typescript
   <PayoutReadinessBanner className="mb-4" />
   ```

4. **Add readiness checking to profile pages:**
   ```typescript
   <PayoutReadinessChecklist showTitle={false} />
   ```

This ensures smooth integration while maintaining backward compatibility with existing creator workflows.