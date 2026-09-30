# Event Versioning and Consumer Safety

This document describes the event versioning system for Stellar contract events, consumer upgrade procedures, and handling of breaking changes.

## Table of Contents

1. [Overview](#overview)
2. [Event Version Format](#event-version-format)
3. [Supported Versions](#supported-versions)
4. [Consumer Implementation](#consumer-implementation)
5. [Upgrade Procedures](#upgrade-procedures)
6. [Breaking Change Policy](#breaking-change-policy)
7. [Quarantine and Dead Letter Handling](#quarantine-and-dead-letter-handling)

## Overview

The Prompt Hash marketplace emits events from Stellar smart contracts that are consumed by the indexer service. As the contract evolves, event structures may change. The event versioning system ensures consumers can safely handle events from multiple contract versions without data loss or corruption.

### Design Principles

1. **Fail-Safe**: Unsupported event versions enter quarantine rather than causing indexer crashes
2. **Explicit Versions**: Every event includes a version field
3. **Forward Compatible**: Consumers can skip unknown fields in newer versions
4. **Backward Compatible**: New contract versions emit events readable by older consumers (when possible)
5. **Auditable**: All quarantined events are logged and reviewable

## Event Version Format

### Current Format (Version 1)

Events are currently emitted without explicit version fields. The indexer infers version 1 for all existing events based on structure and topic names.

```rust
// contracts/prompt-hash/src/events.rs
#[contractevent]
struct PromptCreated {
    #[topic]
    pub prompt_id: u64,
    pub creator: Address,
    pub price_stroops: i128,
    pub asset: Address,
}
```

### Future Format (Version 2+)

Starting with Version 2, events will include an explicit version field:

```rust
#[contractevent]
struct VersionedEvent {
    pub version: u32,
    pub payload: PromptCreatedV2,
}

#[contractevent]
struct PromptCreatedV2 {
    #[topic]
    pub prompt_id: u64,
    pub creator: Address,
    pub price_stroops: i128,
    pub asset: Address,
    pub new_field: Option<String>, // Added in V2
}
```

## Supported Versions

### Version Matrix

| Event Type | V1 Support | V2 Support | Current |
|------------|-----------|-----------|---------|
| PromptCreated | ✅ Yes | 🚧 Planned | V1 |
| PromptPurchased | ✅ Yes | 🚧 Planned | V1 |
| PromptAdminModerated | ✅ Yes | ✅ Yes | V2 |
| DisputeOpened | ✅ Yes | 🚧 Planned | V1 |
| DisputeResolved | ✅ Yes | 🚧 Planned | V1 |

### Version 1 Events

**Characteristics**:
- No explicit version field
- Topic-based routing
- Fixed structure
- All current production events

**Support**: Indefinite (baseline)

### Version 2 Events (Planned)

**Characteristics**:
- Explicit `version` field
- Optional fields using `Option<T>`
- Backward-compatible additions only
- New moderation fields

**Support**: TBD (when deployed)

### Version 3+ Events (Future)

**Breaking Changes**:
- Field removal
- Type changes
- Semantic meaning changes

**Support**: Requires consumer upgrade before contract deployment

## Consumer Implementation

### Version Registry

The indexer maintains a registry of supported event versions:

```typescript
// server/src/services/eventVersions.ts
export const SUPPORTED_VERSIONS: Record<string, number[]> = {
  "PromptCreated": [1],
  "PromptPurchased": [1],
  "PromptAdminModerated": [1, 2],
  "DisputeOpened": [1],
  "DisputeResolved": [1],
};

export function isSupportedVersion(eventType: string, version: number): boolean {
  const supported = SUPPORTED_VERSIONS[eventType];
  return supported ? supported.includes(version) : false;
}
```

### Version Detection

```typescript
export function detectEventVersion(topic: string, data: any): number {
  // Explicit version field (V2+)
  if (data.version !== undefined) {
    return Number(data.version);
  }

  // Implicit V1 for all current events
  return 1;
}
```

### Version-Specific Decoding

```typescript
export function decodeEvent(topic: string, data: any) {
  const version = detectEventVersion(topic, data);

  if (!isSupportedVersion(topic, version)) {
    return {
      recognized: false,
      reason: `unsupported_version_${version}`,
    };
  }

  switch (topic) {
    case "PromptCreated":
      if (version === 1) {
        return decodePromptCreatedV1(data);
      }
      break;

    case "PromptAdminModerated":
      if (version === 1) {
        return decodePromptAdminModeratedV1(data);
      }
      if (version === 2) {
        return decodePromptAdminModeratedV2(data);
      }
      break;

    // ... other events
  }

  return {
    recognized: false,
    reason: "unsupported_event_type",
  };
}
```

### Decoder Example

```typescript
function decodePromptCreatedV1(data: any) {
  return {
    recognized: true,
    type: "PromptCreated",
    version: 1,
    data: {
      prompt_id: data.prompt_id,
      creator: data.creator,
      price_stroops: data.price_stroops,
      asset: data.asset,
    },
  };
}

function decodePromptAdminModeratedV2(data: any) {
  return {
    recognized: true,
    type: "PromptAdminModerated",
    version: 2,
    data: {
      prompt_id: data.prompt_id,
      admin: data.admin,
      status: data.status,
      reason: data.reason,              // New in V2
      policy_reference: data.policy_reference, // New in V2
    },
  };
}
```

## Upgrade Procedures

### Consumer Upgrade (Safe)

When a new contract version adds fields but maintains backward compatibility:

**Timeline**: Before or after contract deployment

1. **Add New Version Support**
   ```typescript
   SUPPORTED_VERSIONS["PromptCreated"] = [1, 2];
   ```

2. **Implement New Decoder**
   ```typescript
   function decodePromptCreatedV2(data: any) {
     // Handle new optional fields
   }
   ```

3. **Deploy Consumer**
   - Test against V1 events (existing)
   - Test against V2 events (simulated)
   - Deploy to production

4. **Monitor Quarantine**
   - Watch for V2 events entering quarantine
   - Replay quarantined events after upgrade

5. **Deploy Contract**
   - Contract now emits V2 events
   - Consumer handles both V1 and V2

### Contract Upgrade (Breaking)

When a new contract version removes fields or changes semantics:

**Timeline**: Consumer MUST upgrade first

1. **Announce Breaking Change**
   - Document removed/changed fields
   - Provide migration timeline (minimum 30 days)
   - Notify all consumers

2. **Consumer Prepares**
   ```typescript
   // Add V3 support while V2 is active
   SUPPORTED_VERSIONS["PromptCreated"] = [1, 2, 3];
   ```

3. **Test Migration**
   - Generate V3 events in test environment
   - Verify consumer handles migration
   - Test with mixed V2/V3 events

4. **Deploy Consumer**
   - Deploy consumer supporting V2 and V3
   - Monitor for errors

5. **Grace Period**
   - Wait minimum 7 days after consumer deployment
   - Verify consumer stability
   - Check quarantine is empty

6. **Deploy Contract**
   - Contract now emits V3 events
   - V2 events stop appearing

7. **Deprecation**
   - After 30 days, remove V2 decoder support
   - Keep V3 as minimum supported version

### Emergency Rollback

If a breaking change causes issues:

1. **Pause Contract**
   - Use admin pause function
   - Stop new event emissions

2. **Assess Impact**
   - Review quarantined events
   - Check data integrity
   - Identify root cause

3. **Rollback Options**
   - **Consumer Rollback**: Revert to previous consumer version
   - **Contract Rollback**: Revert to previous contract version (if possible)
   - **Patch Forward**: Fix consumer and redeploy

4. **Replay Quarantined Events**
   - After fix, replay events from quarantine
   - Verify data consistency

## Breaking Change Policy

### Definition

A breaking change is any modification that causes existing consumers to:
- Fail to decode events
- Misinterpret event semantics
- Lose data
- Enter incorrect states

### Examples of Breaking Changes

❌ **Field Removal**
```rust
// V1
struct PromptCreated {
    pub prompt_id: u64,
    pub creator: Address,
    pub price_stroops: i128, // Removed in V2
}

// V2 - BREAKING
struct PromptCreated {
    pub prompt_id: u64,
    pub creator: Address,
    // price_stroops removed
}
```

❌ **Type Change**
```rust
// V1
pub price_stroops: i128

// V2 - BREAKING
pub price_stroops: u128 // Changed from i128 to u128
```

❌ **Field Reordering**
```rust
// V1
struct PromptCreated {
    pub prompt_id: u64,
    pub creator: Address,
}

// V2 - BREAKING (if position matters)
struct PromptCreated {
    pub creator: Address,  // Reordered
    pub prompt_id: u64,
}
```

❌ **Semantic Change**
```rust
// V1: price_stroops is the listing price
pub price_stroops: i128

// V2: price_stroops is now the discounted price - BREAKING
pub price_stroops: i128
```

### Examples of Non-Breaking Changes

✅ **Adding Optional Fields**
```rust
// V1
struct PromptCreated {
    pub prompt_id: u64,
    pub creator: Address,
}

// V2 - OK
struct PromptCreated {
    pub prompt_id: u64,
    pub creator: Address,
    pub tags: Option<Vec<String>>, // New optional field
}
```

✅ **New Event Types**
```rust
// V2 - OK
#[contractevent]
struct NewFeatureEvent {
    pub feature_id: u64,
}
```

✅ **Extending Enums**
```rust
// V1
pub enum ModerationReason {
    Copyright,
    Abuse,
}

// V2 - OK (if consumer has default handling)
pub enum ModerationReason {
    Copyright,
    Abuse,
    Malware, // New variant
}
```

### Approval Process

Breaking changes require:

1. **Technical Review**
   - Impact assessment
   - Migration plan
   - Rollback plan

2. **Stakeholder Notification**
   - Minimum 30 days notice
   - Migration documentation
   - Support channel

3. **Testing**
   - End-to-end tests with new version
   - Backward compatibility tests
   - Performance benchmarks

4. **Staged Rollout**
   - Deploy to testnet
   - Run for minimum 7 days
   - Deploy to mainnet

## Quarantine and Dead Letter Handling

### Quarantine Flow

```
Event Received
     ↓
Decode Attempt
     ↓
   Fails
     ↓
Quarantine Event ← Store in MongoDB
     ↓
Log Warning ← Alert operators
     ↓
Continue Processing ← Don't block indexer
```

### Quarantine Record

```typescript
interface QuarantinedEvent {
  eventId: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topic: string;
  rawTopic: any;
  rawValue: any;
  reason: string; // "unsupported_version_2", "decoder_error", etc.
  status: "quarantined" | "replayed" | "discarded";
  errorDetails?: string;
  quarantinedAt: Date;
  retryCount: number;
}
```

### Replay Procedure

After consumer upgrade, replay quarantined events:

```typescript
// Manual replay trigger (admin endpoint)
POST /api/admin/replay-quarantined

{
  "reason": "unsupported_version_2",
  "ledgerRange": {
    "start": 1000000,
    "end": 1001000
  }
}
```

**Replay Process**:
1. Fetch quarantined events matching criteria
2. Re-decode with updated consumer
3. Process successfully decoded events
4. Update status to "replayed"
5. Keep failures in quarantine for review

### Monitoring

**Key Metrics**:
- Quarantined events per hour
- Quarantine reasons distribution
- Replay success rate
- Processing lag

**Alerts**:
- Spike in quarantine rate (>10 events/minute)
- New quarantine reason appears
- Quarantine storage exceeds threshold

## Conformance Tests

### Test Suite

```typescript
// server/src/tests/versioning.test.ts
describe("Event Version Conformance", () => {
  it("should decode V1 PromptCreated events", () => {
    const v1Event = { /* V1 structure */ };
    const result = decodeEvent("PromptCreated", v1Event);
    expect(result.recognized).toBe(true);
    expect(result.version).toBe(1);
  });

  it("should reject unsupported event versions", () => {
    const v99Event = { version: 99, /* data */ };
    const result = decodeEvent("PromptCreated", v99Event);
    expect(result.recognized).toBe(false);
    expect(result.reason).toContain("unsupported_version");
  });

  it("should quarantine V2 events before consumer upgrade", () => {
    const v2Event = { version: 2, /* data */ };
    // Consumer only supports V1
    const result = decodeEvent("PromptCreated", v2Event);
    expect(result.recognized).toBe(false);
  });
});
```

### Snapshot Tests

```typescript
it("should maintain consistent V1 PromptCreated structure", () => {
  const v1Event = {
    prompt_id: 123,
    creator: "GCREATOR",
    price_stroops: 100000000,
    asset: "NATIVE",
  };

  const decoded = decodeEvent("PromptCreated", v1Event);
  expect(decoded).toMatchSnapshot();
});
```

## Related Documentation

- [Indexer Architecture](./indexer-architecture.md)
- [Contract Events Reference](./contract-events.md)
- [Incident Response](./operations/incident-response.md)

## Contact

For event versioning questions: [engineering@prompthash.example](mailto:engineering@prompthash.example)
For breaking change proposals: [architecture@prompthash.example](mailto:architecture@prompthash.example)
