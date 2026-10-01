# Contributor Logging Rules & High-Cardinality Protection

## Overview
To prevent log cost expansion, cardinality explosion, and unintentional privacy leakage, all log entries containing user-provided values must adhere to high-cardinality protection rules.

## Core Rules for Logging
1. **Never Log Raw User Identifiers**:
   - User IDs, wallet addresses, session tokens, and IP addresses must be hashed into safe correlation IDs (`corr_<hash>`) using `hashUserIdentifier()`.
2. **Truncate Unbounded User Inputs**:
   - Free-form text fields (e.g. `userInput`, `promptText`, `rawPayload`, `searchQuery`, `customMetadata`) must be truncated to a maximum of 64 characters using `truncateValue()`.
3. **Classify Metric Dimensions**:
   - Do not emit user strings as metric labels. Classify payload sizes into fixed low-cardinality buckets (e.g., `small_le_128b`, `medium_le_1kb`, `large_le_10kb`, `xlarge_gt_10kb`) using `classifyPayloadSize()`.
4. **Use Payload Protection Utility**:
   - Before passing raw request contexts to logger invocations, wrap them with `protectHighCardinalityPayload(context)`.

## Example Usage
```typescript
import { protectHighCardinalityPayload, hashUserIdentifier } from "@/lib/observability/highCardinalityProtection";

// Protect request payload before logging
logger.info("Processing user request", {
  correlationId: hashUserIdentifier(req.userId),
  payload: protectHighCardinalityPayload(req.body)
});
```
