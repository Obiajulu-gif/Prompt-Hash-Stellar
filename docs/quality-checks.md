# Prompt Quality Review Checklist

## Overview

Quality checks ensure prompts meet marketplace standards before paid publication. Creators receive actionable feedback, and maintainers can override checks for exceptional cases.

## Quality Rules

Each rule has a **name**, **description**, **severity**, and **validation logic**.

### Blocking Rules (must pass)

| Rule | Description | Validation |
|------|-------------|-----------|
| `has_title` | Clear, descriptive title | Minimum 5 characters |
| `has_category` | Valid category assignment | Not "Other" category |
| `valid_price` | Positive price for paid publication | Price > 0 |
| `content_quality` | Substantial prompt content | Minimum 50 characters |

### Warning Rules (recommended)

| Rule | Description | Validation |
|------|-------------|-----------|
| `has_description` | Detailed description | Minimum 20 characters |
| `has_tags` | Discovery tags | Minimum 2 tags |
| `examples_included` | Usage examples | Contains "example" or "usage" |

## Data Model

Quality checks are stored in `QualityCheckResult`:

```typescript
{
  promptId: string;              // Unique per prompt
  checks: [
    {
      name: string;
      description: string;
      severity: 'warning' | 'blocking';
      passed: boolean;
      message?: string;
    }
  ];
  overallStatus: 'passed' | 'failed';
  passedAt?: Date;
  blockedAt?: Date;
  overriddenAt?: Date;
  overriddenBy?: string;
  overrideReason?: string;
}
```

## API Endpoints

### Run Checks
**POST /api/quality-checks/:promptId/check**
```json
{
  "promptId": "prompt-123",
  "checks": [
    {
      "name": "has_title",
      "description": "Prompt must have a clear title",
      "severity": "blocking",
      "passed": true
    },
    ...
  ],
  "overallStatus": "passed"
}
```

### Get Check Results
**GET /api/quality-checks/:promptId** - Get latest results

**GET /api/quality-checks/:promptId/history** - Get check history

### Check Paid Publishability
**GET /api/quality-checks/:promptId/can-publish-paid**
```json
{
  "canPublish": true,
  "failures": []
}
```

### Override Checks (admin only)
**POST /api/quality-checks/:promptId/override**
```json
{
  "overriddenBy": "admin@example.com",
  "reason": "Approved by content team despite missing examples"
}
```

### Get Rules Documentation
**GET /api/quality-checks/rules/list** - All available rules

## Usage in Code

```typescript
import { qualityCheckService } from "../services/qualityCheckService";

// Run quality checks
const result = await qualityCheckService.runChecks(promptId);

// Check if can publish as paid
const { canPublish, failures } = await qualityCheckService.canPublishPaid(promptId);

if (!canPublish) {
  // Show failures to creator
  failures.forEach(failure => console.log(failure));
}

// Admin override
if (isAdmin) {
  await qualityCheckService.overrideChecks(
    promptId,
    adminWallet,
    "Content team approval"
  );
}
```

## Workflow

1. **Creator publishes** a new or updated prompt
2. **Quality checks run** automatically during publication
3. **If blocked** - Show failures to creator with guidance
4. **Creator fixes issues** - Update prompt and retry
5. **If passed** - Proceed with publication
6. **Admin override** - Available for exceptional cases with explanation

## Publishing Rules

- **Free prompts** - Quality checks run but warnings are non-blocking
- **Paid prompts** - Cannot publish with blocking failures unless overridden
- **Updates** - Re-run checks when prompt is updated

## Admin Overrides

Maintainers can override blocking checks when:

- Content team approves despite formatting issues
- Exceptional cases warrant exception
- Quality criteria change mid-publication

All overrides are logged with reason and timestamp.

## Metrics

The system tracks:

- Pass rate of new prompts
- Most common failures
- Override frequency and reasons
- Quality trends over time

## Best Practices

1. **Clear failures** - Messages guide creators to fixes
2. **Warn, don't block** - Warnings for nice-to-have features
3. **Consistent rules** - Same standards for all creators
4. **Log overrides** - Maintain audit trail for decisions
5. **Iterate rules** - Adjust based on community feedback
6. **Communicate changes** - Notify creators of new rules
