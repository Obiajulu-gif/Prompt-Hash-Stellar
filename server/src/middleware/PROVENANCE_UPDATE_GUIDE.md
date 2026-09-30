# Provenance Preservation Through Updates - Integration Guide

This guide explains how to integrate provenance tracking into prompt update workflows to ensure complete history preservation.

## Overview

The provenance system automatically tracks all changes to prompts, maintaining a complete audit trail of:
- What changed (fields modified)
- When it changed (timestamp)
- Who changed it (actor information)
- Why it changed (update type and details)

## Integration Methods

### Method 1: Automatic Middleware (Recommended)

Use the `provenanceUpdateMiddleware` for automatic tracking:

```typescript
import { provenanceUpdateMiddleware, capturePromptVersion } from "../middleware/provenanceMiddleware";

// In your update route
router.put("/prompts/:id", async (req, res) => {
  // 1. Capture the current version before updating
  await capturePromptVersion(req, req.params.id);
  
  // 2. Apply middleware
  provenanceUpdateMiddleware(req, res, () => {});
  
  // 3. Perform the update
  const updatedPrompt = await Prompt.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );
  
  // 4. Return response (provenance tracking happens automatically)
  res.json({ prompt: updatedPrompt });
});
```

### Method 2: Manual Tracking

For more control, use `trackPromptUpdate` directly:

```typescript
import { trackPromptUpdate } from "../services/provenanceService";

router.put("/prompts/:id", async (req, res) => {
  const previousVersion = await Prompt.findById(req.params.id).lean();
  
  const updatedPrompt = await Prompt.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );
  
  // Track the update
  await trackPromptUpdate({
    promptId: req.params.id,
    onChainId: updatedPrompt.onChainId,
    updateType: "CONTENT_ENHANCEMENT",
    updateDetails: "Content updated by user",
    actor: {
      userId: req.user.id,
      walletAddress: req.user.walletAddress,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      timestamp: new Date(),
    },
    changedFields: ["content", "title"],
    previousVersion,
  });
  
  res.json({ prompt: updatedPrompt });
});
```

### Method 3: Indexer Integration (For Blockchain Updates)

The indexer automatically tracks on-chain updates:

```typescript
// In indexer.ts - PromptUpdated event handler
case "PromptUpdated": {
  const { prompt_id, version } = data;
  
  // Update database
  await Prompt.findOneAndUpdate(
    { onChainId: prompt_id.toString() },
    { $set: { currentVersionIndex: Number(version) } }
  );
  
  // Track provenance (already integrated)
  await trackBlockchainIndexing(
    promptId,
    { transactionHash: txHash, ledgerNumber: ledger },
    creator
  );
  
  break;
}
```

## Update Types

The system classifies updates into these transform types:

- **VERSION_UPDATE**: Version number changes
- **CONTENT_ENHANCEMENT**: Content/payload modifications
- **ENRICHMENT**: Metadata updates (title, description, tags)
- **NORMALIZATION**: Price or status changes
- **FORMAT_CONVERSION**: Format or encoding changes
- **VALIDATION**: Verification or validation operations

## Archival and Restoration

### Archive a Prompt

```typescript
import { archiveProvenance } from "../services/provenanceService";

await archiveProvenance({
  promptId: "prompt_123",
  onChainId: "456",
  actor: {
    walletAddress: adminWallet,
    timestamp: new Date(),
  },
  reason: "Policy violation",
});
```

### Restore a Prompt

```typescript
import { restoreProvenance } from "../services/provenanceService";

await restoreProvenance({
  promptId: "prompt_123",
  onChainId: "456",
  actor: {
    walletAddress: adminWallet,
    timestamp: new Date(),
  },
});
```

## Querying Update History

```typescript
import { getUpdateHistory } from "../services/provenanceService";

const history = await getUpdateHistory("prompt_123");

console.log(`Total updates: ${history.totalUpdates}`);
history.updates.forEach(update => {
  console.log(`${update.timestamp}: ${update.details}`);
});
```

## API Endpoints

### Track Update
```
POST /api/provenance/track-update
Body: {
  promptId: string,
  updateType: string,
  updateDetails: string,
  actor: { ... },
  changedFields?: string[]
}
```

### Get Update History
```
GET /api/provenance/update-history/:promptId
Response: {
  promptId: string,
  totalUpdates: number,
  updates: [...]
}
```

### Archive Provenance
```
POST /api/provenance/archive
Body: {
  promptId: string,
  actor: { ... },
  reason?: string
}
```

### Restore Provenance
```
POST /api/provenance/restore
Body: {
  promptId: string,
  actor: { ... }
}
```

## Best Practices

1. **Always capture the previous version** before making changes
2. **Use descriptive update details** to maintain clear audit trails
3. **Include changed fields** for detailed tracking
4. **Don't block on provenance failures** - log errors but allow updates to succeed
5. **Use background processing** for provenance tracking to avoid blocking responses
6. **Query provenance before major operations** to understand the prompt's history

## Testing

Example test for provenance preservation:

```typescript
describe("Provenance preservation", () => {
  it("tracks updates correctly", async () => {
    const prompt = await createPrompt({ title: "Original" });
    
    await updatePrompt(prompt._id, { title: "Updated" });
    
    const history = await getUpdateHistory(prompt._id);
    expect(history.totalUpdates).toBe(1);
    expect(history.updates[0].details).toContain("title");
  });
});
```

## Troubleshooting

### Issue: Provenance not being tracked

**Solution**: Ensure middleware is properly integrated and `capturePromptVersion` is called before updates.

### Issue: Missing actor information

**Solution**: Verify authentication middleware is running before provenance middleware.

### Issue: Performance impact

**Solution**: Provenance tracking runs asynchronously. If still impacted, consider queuing updates for batch processing.

## Related

- Issue #929: Provenance tracking for imported and derived records
- Issue #753: Prompt-to-prompt provenance (PromptRelation)
- `server/src/services/provenanceService.ts`: Core provenance functions
- `server/src/middleware/provenanceMiddleware.ts`: Middleware implementations
