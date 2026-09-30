# Policy Layer Guide

## Overview

The policy evaluation engine centralizes business rules for limits, eligibility, thresholds, and restrictions. Instead of scattering validation logic across handlers and UI components, all configurable rules flow through a typed policy layer with comprehensive test coverage.

## Architecture

### Core Components

1. **PolicyEvaluator** - Central evaluation engine
2. **PolicyRule** - Individual rule interface
3. **PolicyContext** - Typed input for evaluation
4. **PolicyResult** - Typed output with violations
5. **PolicyConfig** - Global configuration

### Design Principles

- **Single Source of Truth** - All business rules evaluated centrally
- **Type Safety** - Strongly typed inputs and outputs
- **Testability** - Rules are pure functions, easily tested
- **Configurability** - Limits adjustable without code changes
- **Actionable Errors** - Violations include user-safe messages

## Using the Policy Layer

### Basic Evaluation

```typescript
import { globalPolicyEvaluator } from '@/lib/policy/evaluator';

const result = await globalPolicyEvaluator.evaluate({
  actor: walletAddress,
  resource: promptId,
  action: 'create',
  metadata: {
    titleLength: 150,
    descriptionLength: 2000,
    contentSize: 2_500_000,
    price: BigInt(5_000_000),
  },
});

if (!result.allowed) {
  console.error('Policy violation:', result.violations);
  // Return user-facing error
}
```

### Checking Specific Rules

```typescript
const pricingResult = await globalPolicyEvaluator.evaluateRule(
  'prompt-pricing',
  {
    actor: wallet,
    resource: promptId,
    action: 'create',
    metadata: { price: BigInt(100) }, // Too low
  }
);

if (!pricingResult.allowed) {
  // Handle pricing violation specifically
}
```

## Built-In Rules

### Prompt Listing Rules

**Rule: `prompt-size-limit`**  
Enforces maximum prompt content size.

- **Config:** `maxPromptSize` (default: 5MB)
- **Violation:** Content exceeds size limit
- **User Message:** "Prompt content exceeds maximum size of X bytes"

**Rule: `prompt-pricing`**  
Enforces min/max price bounds.

- **Config:** `minPrice`, `maxPrice` (default: 0.1 XLM - 1M XLM)
- **Violation:** Price outside bounds
- **User Message:** "Price below minimum" or "Price exceeds maximum"

**Rule: `prompt-metadata-length`**  
Enforces title and description length limits.

- **Config:** `maxTitleLength`, `maxDescriptionLength`
- **Violation:** Text fields too long
- **User Message:** "Title exceeds maximum length of X characters"

### Purchase Rules

**Rule: `duplicate-purchase-prevention`**  
Prevents repeat purchases of same prompt.

- **Config:** `maxPurchasesPerPromptPerWallet` (default: 1)
- **Violation:** Already purchased
- **User Message:** "You have already purchased this prompt"

**Rule: `daily-purchase-limit`**  
Limits purchases per wallet per day.

- **Config:** `maxDailyPurchasesPerWallet` (default: 100)
- **Violation:** Daily limit reached
- **User Message:** "Daily purchase limit of X reached"

## Creating Custom Rules

### Define the Rule

```typescript
import type { PolicyRule, PolicyContext, PolicyResult } from '@/lib/policy/types';
import { globalPolicyEvaluator } from '@/lib/policy/evaluator';

export const customRule: PolicyRule = {
  id: 'my-custom-rule',
  name: 'My Custom Rule',
  description: 'Enforces custom business logic',
  
  evaluate(context: PolicyContext): PolicyResult {
    const config = globalPolicyEvaluator.getConfig();
    
    // Your validation logic
    if (someCondition) {
      return {
        allowed: false,
        violations: [{
          rule: this.id,
          severity: 'error',
          message: 'User-safe error message',
          actualValue: context.metadata.someValue,
          expectedValue: config.someLimit,
        }],
      };
    }
    
    return { allowed: true };
  },
};
```

### Register the Rule

```typescript
import { globalPolicyEvaluator } from '@/lib/policy/evaluator';
import { customRule } from './rules/custom';

// Auto-register on module load
globalPolicyEvaluator.registerRule(customRule);
```

### Test the Rule

```typescript
import { describe, it, expect } from 'vitest';
import { PolicyEvaluator } from '@/lib/policy/evaluator';
import { customRule } from './custom';

describe('Custom Rule', () => {
  it('should enforce custom logic', () => {
    const evaluator = new PolicyEvaluator();
    evaluator.registerRule(customRule);
    
    const result = evaluator.evaluateRule('my-custom-rule', {
      actor: 'test',
      resource: 'test',
      action: 'test',
      metadata: { /* test data */ },
    });
    
    expect(result.allowed).toBe(false);
    expect(result.violations?.[0].message).toBe('Expected message');
  });
});
```

## Configuration Management

### Reading Configuration

```typescript
const config = globalPolicyEvaluator.getConfig();
console.log('Max prompt size:', config.maxPromptSize);
```

### Updating Configuration

```typescript
// Runtime update (persists until restart)
globalPolicyEvaluator.updateConfig({
  maxPromptSize: 10 * 1024 * 1024, // 10MB
  minPrice: BigInt(5_000_000), // 0.5 XLM
});
```

### Environment-Based Configuration

```typescript
// Load from environment or database
const envConfig = {
  maxPromptSize: parseInt(process.env.MAX_PROMPT_SIZE ?? '5242880'),
  minPrice: BigInt(process.env.MIN_PROMPT_PRICE ?? '1000000'),
};

globalPolicyEvaluator.updateConfig(envConfig);
```

## Integration Points

### API Route Handlers

```typescript
// api/prompts/create.ts
import { globalPolicyEvaluator } from '@/lib/policy/evaluator';

export async function createPrompt(req, res) {
  const policy = await globalPolicyEvaluator.evaluate({
    actor: req.body.creator,
    resource: 'new-prompt',
    action: 'create',
    metadata: {
      titleLength: req.body.title.length,
      descriptionLength: req.body.description.length,
      contentSize: req.body.content.length,
      price: req.body.price,
    },
  });

  if (!policy.allowed) {
    return res.status(400).json({
      error: 'Policy violation',
      violations: policy.violations,
    });
  }

  // Proceed with creation
}
```

### Frontend Validation

```typescript
// src/components/CreatePromptForm.tsx
import { globalPolicyEvaluator } from '@/lib/policy/evaluator';

async function validateForm(data) {
  const result = await globalPolicyEvaluator.evaluate({
    actor: walletAddress,
    resource: 'new-prompt',
    action: 'create',
    metadata: {
      titleLength: data.title.length,
      descriptionLength: data.description.length,
      price: BigInt(data.price),
    },
  });

  if (!result.allowed) {
    // Show violations in UI
    setErrors(result.violations?.map(v => v.message) ?? []);
    return false;
  }

  return true;
}
```

### Smart Contract Pre-Flight

```typescript
// Before submitting to Soroban
const policy = await globalPolicyEvaluator.evaluate({
  actor: creator,
  resource: promptId,
  action: 'update_price',
  metadata: { price: newPrice },
});

if (!policy.allowed) {
  throw new Error(
    policy.violations?.[0].message ?? 'Price update not allowed'
  );
}

await contract.updatePromptPrice(promptId, newPrice);
```

## Error Handling

### Policy Violations

Violations include:
- `rule` - Which rule failed
- `severity` - `error` or `warning`
- `message` - User-safe description
- `actualValue` - What was provided
- `expectedValue` - What was expected

### User-Facing Errors

```typescript
function formatPolicyError(result: PolicyResult): string {
  if (!result.violations || result.violations.length === 0) {
    return 'Operation not allowed';
  }

  return result.violations
    .filter(v => v.severity === 'error')
    .map(v => v.message)
    .join('. ');
}
```

### Logging Violations

```typescript
if (!result.allowed) {
  logger.warn('Policy violation', {
    actor: context.actor,
    resource: context.resource,
    action: context.action,
    violations: result.violations,
  });
}
```

## Testing

### Unit Tests

```bash
npm run test src/lib/policy/__tests__/evaluator.test.ts
```

### Integration Tests

```typescript
describe('Policy Integration', () => {
  it('should prevent oversized prompt creation', async () => {
    const response = await request(app)
      .post('/api/prompts/create')
      .send({
        title: 'Test',
        content: 'x'.repeat(10_000_000), // 10MB
        price: '1000000',
      });

    expect(response.status).toBe(400);
    expect(response.body.violations).toContainEqual(
      expect.objectContaining({
        rule: 'prompt-size-limit',
        severity: 'error',
      })
    );
  });
});
```

### Boundary Testing

```typescript
it('should accept prompt at exact size limit', () => {
  const config = globalPolicyEvaluator.getConfig();
  
  const result = evaluator.evaluateRule('prompt-size-limit', {
    metadata: { contentSize: config.maxPromptSize },
  });

  expect(result.allowed).toBe(true);
});

it('should reject prompt 1 byte over limit', () => {
  const config = globalPolicyEvaluator.getConfig();
  
  const result = evaluator.evaluateRule('prompt-size-limit', {
    metadata: { contentSize: config.maxPromptSize + 1 },
  });

  expect(result.allowed).toBe(false);
});
```

## Migration Guide

### Moving Existing Rules

**Before:**
```typescript
// Scattered in handler
if (title.length > 200) {
  throw new Error('Title too long');
}
```

**After:**
```typescript
const result = await globalPolicyEvaluator.evaluate({
  metadata: { titleLength: title.length },
});

if (!result.allowed) {
  throw new Error(result.violations[0].message);
}
```

### Deprecation Plan

1. Identify hard-coded limits in codebase
2. Create policy rules for each
3. Update handlers to use policy layer
4. Add tests for all rules
5. Remove old validation code

## Performance

- Rule evaluation is synchronous (< 1ms per rule)
- Rules run in parallel (no dependencies)
- Config reads are O(1)
- No database queries required

## References

- [Policy Types](../../src/lib/policy/types.ts)
- [Policy Evaluator](../../src/lib/policy/evaluator.ts)
- [Built-in Rules](../../src/lib/policy/rules/)
- [Test Suite](../../src/lib/policy/__tests__/)
