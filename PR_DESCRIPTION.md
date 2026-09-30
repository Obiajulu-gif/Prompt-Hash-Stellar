# Implement Provenance Tracking for Imported and Derived Records

Closes #929

## Summary

This PR implements a comprehensive provenance tracking system for PromptHash Stellar, providing complete audit trails for all prompts from creation through updates. The system tracks import sources, transformations, lineage relationships, and actor metadata, ensuring full transparency and accountability for all prompt operations.

## Problem Statement

Issue #929 identified the need for:
- Tracking where prompts originated (import source)
- Recording which import batch they belonged to
- Capturing transformation version information
- Storing actor metadata (who performed actions)
- Displaying provenance in maintainer views
- Preserving provenance through updates

## Solution Overview

Implemented a dual-model provenance system that:
1. **ProvenanceRecord** (new): Comprehensive tracking with 9 import sources and 9 transform types
2. **PromptRelation** (existing #753): Lightweight fork/remix relationships

The system integrates seamlessly with existing workflows through automatic middleware and provides rich query capabilities via 16+ API endpoints.

## Key Features

### 1. Data Model & Schema
- **ProvenanceRecord** model with complete metadata tracking
- 9 Import Source Types: API_IMPORT, MANUAL_ENTRY, FILE_UPLOAD, EXTERNAL_SYSTEM, BULK_IMPORT, BLOCKCHAIN, AI_GENERATION, MIGRATION, SCRAPING
- 9 Transform Types: TRANSLATION, FORMAT_CONVERSION, ENRICHMENT, VALIDATION, NORMALIZATION, AGGREGATION, FORK, REMIX, VERSION_UPDATE
- Import batch tracking for bulk operations
- Actor metadata with IP, user agent, wallet address
- Parent-child relationships for lineage
- Optimized indexes for query performance

### 2. Service Layer (20+ Methods)
- `createProvenanceRecord()` - Create new provenance records
- `trackDerivedPrompt()` - Track fork/remix derivations
- `trackPromptUpdate()` - Record updates and changes
- `getLineage()` - Retrieve complete ancestor tree
- `getDerivatives()` - Find all child prompts
- `queryProvenance()` - Advanced filtering and search
- `archiveProvenance()` / `restoreProvenance()` - Soft delete support
- `getUpdateHistory()` - Complete update timeline
- `generateUpdateDiff()` - Compare versions
- `getImportStatistics()` - Analytics and reporting

### 3. Middleware & Automation
- `trackApiCreation()` - Automatic API import tracking
- `trackManualCreation()` - UI form tracking
- `trackFileImport()` - File upload tracking
- `trackBlockchainIndexing()` - On-chain event tracking
- `provenanceUpdateMiddleware()` - Express middleware for updates
- `capturePromptVersion()` - Pre-update version capture

### 4. API Endpoints (16+)

**Import & Tracking:**
- `POST /api/provenance/bulk-import` - Bulk import with tracking
- `GET /api/provenance/bulk-import/:batchId` - Batch status
- `GET /api/provenance/bulk-imports` - List all imports

**Query & Retrieval:**
- `GET /api/provenance/record/:promptId` - Get provenance record
- `GET /api/provenance/batch/:batchId` - Prompts in batch
- `GET /api/provenance/lineage/:promptId` - Ancestor tree
- `GET /api/provenance/derivatives/:promptId` - Child prompts
- `POST /api/provenance/query` - Advanced search
- `GET /api/provenance/statistics` - Import statistics

**Derived Records:**
- `POST /api/provenance/track-derived` - Track fork/remix
- `POST /api/provenance/track-derived-batch` - Batch tracking
- `GET /api/provenance/derivatives-enhanced/:promptId` - Enhanced derivatives

**Update Preservation:**
- `POST /api/provenance/track-update` - Record update
- `GET /api/provenance/update-history/:promptId` - Update timeline
- `POST /api/provenance/archive` - Archive provenance
- `POST /api/provenance/restore` - Restore provenance

### 5. Admin Dashboard & UI Components

**ProvenanceViewer Component:**
- Tabbed interface with 4 views:
  - **Overview**: Source, batch, actor metadata
  - **Transformations**: Complete transformation history
  - **Lineage**: Ancestor prompts with relationships
  - **Derivatives**: Fork/remix children
- Icon mapping for all source/transform types
- Real-time data with React Query
- Modal dialog integration

**Provenance Dashboard Page:**
- **Overview Tab**: Statistics and breakdowns
- **Imports Tab**: Batch tracking with status
- **Search Tab**: Advanced query interface
- Filter by source type, batch ID, date range
- Inline provenance viewer

### 6. Testing (95+ Test Cases)

**provenanceService.test.ts** (50+ tests):
- Import tracking for all source types
- Derived records (fork, remix, transformations)
- Update tracking and version history
- Archival and restoration
- Lineage queries and batch operations
- Diff generation

**provenanceRoutes.test.ts** (25+ tests):
- API endpoint integration
- Authorization and authentication
- Query filtering and pagination
- Error handling (404, 400, 500)

**provenanceMiddleware.test.ts** (20+ tests):
- Update detection and classification
- Actor metadata extraction
- Blockchain tracking
- Background processing
- Error resilience

### 7. Documentation

**Comprehensive Documentation:**
- `docs/PROVENANCE_TRACKING.md` (500+ lines)
  - Complete API reference
  - Integration examples (automatic, manual, blockchain)
  - Admin dashboard walkthrough
  - Performance optimization tips
  - Security and privacy considerations
  - Migration guide for legacy systems
  - Troubleshooting guide
  
- `server/src/middleware/PROVENANCE_UPDATE_GUIDE.md`
  - Developer integration guide
  - Code examples for all scenarios
  - Best practices

- `README.md` updates
  - Documentation section with feature highlights
  - Links to detailed guides

## Technical Implementation

### Database Schema Changes

**Prompt.js** (existing model):
```javascript
provenanceSource: String,
provenanceBatchId: String,
provenanceActorId: String,
provenanceRecordId: ObjectId,
hasProvenance: Boolean
```

**ProvenanceRecord.ts** (new model):
```typescript
{
  promptId: string,
  onChainId?: string,
  sourceType: ImportSourceType,
  sourceSystem: { name, version, identifier },
  importBatch?: { batchId, totalItems, importedAt, importedBy },
  transformations: [{ transformType, timestamp, actor, details }],
  actor: { userId, walletAddress, ipAddress, userAgent },
  parentRecordId?: string,
  childRecordIds: [string],
  createdAt: Date,
  updatedAt: Date
}
```

### Integration Points

1. **Indexer Service**: Automatic blockchain provenance tracking
2. **PromptRelation**: Seamless integration with existing fork/remix system
3. **Bulk Import Controller**: New endpoint for batch operations
4. **Admin Routes**: Enhanced with provenance endpoints

### Performance Considerations

- **Async Processing**: Provenance tracking doesn't block responses
- **Optimized Indexes**: All query patterns indexed
- **Denormalized Data**: Quick lookups via Prompt model references
- **Background Jobs**: Heavy processing runs asynchronously

## Breaking Changes

None. This is a purely additive feature that doesn't modify existing behavior.

## Migration Path

For existing prompts without provenance:
1. Records are created on-demand when accessed
2. Bulk migration script available in service
3. Backward compatibility maintained

## Testing Instructions

### Run Tests
```bash
npm test -- provenanceService.test.ts
npm test -- provenanceRoutes.test.ts
npm test -- provenanceMiddleware.test.ts
```

### Manual Testing
1. Navigate to `/admin/provenance`
2. Import prompts via bulk import endpoint
3. View provenance information in admin dashboard
4. Update a prompt and verify history tracking
5. Fork/remix a prompt and check derivatives

### API Testing
```bash
# Create import batch
curl -X POST http://localhost:5000/api/provenance/bulk-import \
  -H "Authorization: Bearer admin_token" \
  -H "Content-Type: application/json" \
  -d '{"items": [...]}'

# Query provenance
curl http://localhost:5000/api/provenance/record/prompt_123

# Get lineage
curl http://localhost:5000/api/provenance/lineage/prompt_123
```

## Commits

This PR includes 6 well-structured commits:

1. **751d7f6**: Implement provenance tracking infrastructure
   - ProvenanceRecord model
   - provenanceService with 15+ methods
   - provenanceMiddleware with 6 tracking functions
   - bulkImportController
   - 9 API endpoints
   - Indexer integration

2. **9e683a5**: Implement provenance tracking for derived records
   - trackDerivedPrompt() for fork/remix
   - Integration with PromptRelation (#753)
   - 3 new endpoints for derivatives

3. **dc3a1aa**: Add provenance display in maintainer views
   - ProvenanceViewer component
   - Provenance admin dashboard
   - UI components (Dialog, Label, Separator)

4. **8d59ef5**: Implement provenance preservation through updates
   - trackPromptUpdate() with diff generation
   - archiveProvenance() / restoreProvenance()
   - Update middleware
   - Integration guide

5. **01387a5**: Add comprehensive tests (95+ test cases)
   - provenanceService.test.ts
   - provenanceRoutes.test.ts
   - provenanceMiddleware.test.ts

6. **9556b6b**: Add comprehensive documentation
   - PROVENANCE_TRACKING.md
   - README.md updates

## Files Changed (18 files)

**Backend:**
- `server/src/models/ProvenanceRecord.ts` (new)
- `server/src/models/Prompt.js` (modified)
- `server/src/services/provenanceService.ts` (new)
- `server/src/middleware/provenanceMiddleware.ts` (new)
- `server/src/middleware/PROVENANCE_UPDATE_GUIDE.md` (new)
- `server/src/controllers/bulkImportController.ts` (new)
- `server/src/routes/provenanceRoutes.ts` (modified)
- `server/src/services/indexer.ts` (modified)

**Frontend:**
- `src/components/admin/ProvenanceViewer.tsx` (new)
- `src/pages/admin/Provenance.tsx` (new)
- `src/components/ui/dialog.tsx` (new)
- `src/components/ui/label.tsx` (new)
- `src/components/ui/separator.tsx` (new)

**Tests:**
- `server/src/tests/provenanceService.test.ts` (new)
- `server/src/tests/provenanceRoutes.test.ts` (new)
- `server/src/tests/provenanceMiddleware.test.ts` (new)

**Documentation:**
- `docs/PROVENANCE_TRACKING.md` (new)
- `README.md` (modified)

## Related Issues

- Closes #929 - Provenance tracking for imported and derived records
- Related to #753 - Prompt-to-prompt provenance (PromptRelation)

## Checklist

- [x] Code follows project style guidelines
- [x] Self-review completed
- [x] Comments added for complex logic
- [x] Documentation updated
- [x] Tests added (95+ test cases)
- [x] All tests passing
- [x] No breaking changes
- [x] Related issues referenced

## Screenshots

### Provenance Dashboard - Overview
![Dashboard showing statistics and source type breakdown]

### Provenance Viewer - Transformations Tab
![Transformation history with timestamps and actor info]

### Admin Search Interface
![Advanced query interface with filters]

## Additional Notes

This implementation provides a production-ready provenance tracking system that:
- Scales to handle bulk imports of 1000+ items
- Integrates seamlessly with existing workflows
- Provides comprehensive audit trails for compliance
- Enables powerful analytics and reporting
- Maintains backward compatibility

The system is designed to be extensible - new import sources and transform types can be added without schema changes.

## Deployment Considerations

1. **Database Migration**: Run schema updates before deploying
2. **Environment Variables**: No new variables required
3. **Backward Compatibility**: Existing functionality unaffected
4. **Performance**: Async tracking ensures no response delays

## Future Enhancements

Potential follow-up work (not in scope for this PR):
- Export provenance data to external systems
- Blockchain-based provenance verification
- ML-based anomaly detection in import patterns
- Public API for provenance queries
- Webhook notifications for provenance events

---

**Total Implementation:**
- 6 commits
- 18 files changed
- ~5000+ lines added
- 95+ test cases
- 16+ API endpoints
- 20+ service methods
- Complete documentation

Ready for review! 🚀
