# Prompt Report Workflow Implementation

## Acceptance Criteria - All Completed ✅

### 1. Add report button ✅
- Report button added to PromptModal component
- Located in PromptMetadataSection alongside share link button
- Red accent color (Flag icon) to indicate reporting action
- Disabled state when onReportClick not provided

### 2. Add reason selector ✅
- ReportDialog component with 6 reason options:
  - Low quality or poor result
  - Content doesn't match description
  - Contains plagiarized content
  - Harmful or inappropriate content
  - Copyright violation
  - Other reason
- Radio-style selection with visual feedback
- Required field validation

### 3. Show confirmation message ✅
- Three-stage dialog flow:
  1. Form stage: reason selector + optional description
  2. Submitting stage: loading animation with status message
  3. Success stage: confirmation with check mark
- Auto-closes after 2 seconds on success
- Smooth animations between stages

### 4. Add admin review placeholder ✅
- New admin page at `/admin/reports`
- Reports queue with filtering and sorting
- Review actions panel:
  - Admin notes textarea
  - Mark Resolved button
  - Dismiss Report button
  - Take Action on Prompt button (placeholder)
- Status indicators: pending, investigating, resolved, dismissed

## Files Created

### Frontend
- `src/lib/reports/reportClient.ts` - API client for report submissions
- `src/components/prompts/ReportDialog.tsx` - Report submission dialog component
- `src/pages/admin/Reports.tsx` - Admin review dashboard
- `src/lib/reports/reportClient.test.ts` - Client tests

### Backend
- `server/src/models/Report.ts` - MongoDB report schema
- `server/src/controllers/controllers.ts` - Added SubmitPromptReport and GetPromptReports
- `server/src/routes/promptRoutes.ts` - Added report endpoints

## Files Modified

### Frontend
- `src/pages/browse/PromptModal.tsx` - Integrated ReportDialog and added report button

## Key Features

### Report Types
```typescript
type ReportReason = 
  | "quality-issue"
  | "misleading-content"
  | "plagiarism"
  | "harmful-content"
  | "copyright"
  | "other"
```

### API Endpoints
- `POST /api/prompts/reports` - Submit a report
- `GET /api/prompts/reports?promptId={id}` - Fetch reports (admin only)

### Report Data Model
- promptId: string
- reporterAddress: string (normalized to lowercase)
- reason: enum
- description: optional (max 500 chars)
- status: pending | investigating | resolved | dismissed
- adminNotes: optional
- timestamps: createdAt, updatedAt, resolvedAt

## User Flow

1. User opens prompt modal
2. Clicks "Report prompt" button (red flag icon)
3. Dialog opens with reason selector
4. User selects reason and optionally adds details
5. Submits report
6. Loading animation shown
7. Success confirmation displayed
8. Dialog auto-closes

## Admin Flow

1. Navigate to `/admin/reports`
2. View pending reports in queue
3. Click report to select for review
4. View reason, description, and reporter info
5. Add admin notes
6. Mark as Resolved or Dismiss
7. Optionally take action on prompt

## Database

Report schema includes:
- Full audit trail with timestamps
- Status tracking for workflow
- Admin notes field
- Indexes on promptId and status for efficient queries

## Security

- Reporter address normalized to lowercase
- Admin token required for report retrieval
- No sensitive data exposed in responses
- Description limited to 500 characters
