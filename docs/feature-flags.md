# Feature Flag Framework

## Overview

The Feature Flag Framework enables safe, staged rollouts of marketplace changes with fine-grained control over behavior without redeployment.

## Features

- **Environment-specific configuration** - Enable flags per environment (development, staging, production)
- **Percentage-based rollout** - Experimental flags can target a percentage of users
- **Deterministic rollout** - Same user always gets consistent flag state
- **Admin management** - Full CRUD operations for flags via protected endpoints

## Data Model

Flags are stored in the `FeatureFlag` collection with the following fields:

```typescript
{
  name: string;              // Unique identifier (lowercase)
  description: string;       // Human-readable description
  status: 'enabled' | 'disabled' | 'experimental';
  environments: {
    development?: boolean;
    staging?: boolean;
    production?: boolean;
  };
  rolloutPercentage: 0-100;  // For experimental flags
  createdBy: string;         // Admin email
  createdAt: Date;
  updatedAt: Date;
}
```

## API Endpoints

### Admin Routes (require `flags:write` scope)

**POST /api/flags** - Create a new flag
```json
{
  "name": "new-payment-flow",
  "description": "New payment flow for risky changes",
  "status": "experimental",
  "environments": { "development": true, "staging": true },
  "rolloutPercentage": 25,
  "createdBy": "admin@example.com"
}
```

**GET /api/flags** - List all flags

**GET /api/flags/:name** - Get specific flag

**PATCH /api/flags/:name** - Update flag
```json
{
  "status": "enabled",
  "environments": { "production": true },
  "rolloutPercentage": 50
}
```

**DELETE /api/flags/:name** - Delete flag

### Public Routes

**POST /api/flags/check/:name** - Check if flag is enabled
```json
{
  "userId": "user-wallet-address"
}
```

## Usage in Code

```typescript
import { featureFlagService } from "../services/featureFlagService";

// Check if feature is enabled
const isEnabled = await featureFlagService.isEnabled(
  "new-payment-flow",
  "production",
  userWallet
);

if (isEnabled) {
  // Execute new flow
} else {
  // Execute stable flow
}
```

## Rollout Strategy

1. **Create flag** - Initially disabled on all environments
2. **Test in dev/staging** - Enable on development and staging
3. **Gradual rollout** - Set to experimental with 5-25% rollout
4. **Monitor** - Collect metrics and user feedback
5. **Full rollout** - Enable for 100% of users
6. **Cleanup** - Remove flag once stabilized

## Safety Guarantees

- Disabled flags always return `false` (safe default)
- Missing flags return `false` (fail-safe)
- Server-side checks only (client checks are advisory)
- Rollout is deterministic per user (no flickering)
- All flag changes are audited

## Best Practices

1. **Name flags clearly** - Use kebab-case with domain prefix
2. **Add descriptions** - Explain what the flag controls
3. **Test both states** - Test enabled and disabled code paths
4. **Set defaults safely** - Disabled is the default
5. **Monitor metrics** - Track impact of flag changes
6. **Plan cleanup** - Remove old flags after stabilization
