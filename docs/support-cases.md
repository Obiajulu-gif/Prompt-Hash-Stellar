# Support Case Workflow

## Overview

The Support Case system provides structured handoff records for buyer and creator disputes, enabling maintainers to review cases while respecting data privacy.

## Case Types

- **purchase_failure** - Transaction failed or payment didn't process
- **content_dispute** - Disagreement about prompt content/quality
- **access_denied** - Buyer cannot access purchased prompt
- **report** - Content violation report

## Case Lifecycle

```
open -> in_progress -> resolved/closed
```

### Status Meanings

- **open** - Case created, waiting for assignment
- **in_progress** - Assigned to staff member, under investigation
- **resolved** - Case decision made, resolution applied
- **closed** - Case complete and archived

## Resolutions

- **refunded** - Payment refunded to buyer
- **restored_access** - Access restored to buyer
- **dismissed** - Case found to be without merit
- **escalated** - Escalated to higher authority

## API Endpoints

### Create Case
**POST /api/support-cases**
```json
{
  "type": "purchase_failure",
  "promptId": "prompt-id",
  "buyerWallet": "GBUYER...",
  "creatorWallet": "GCREATOR...",
  "title": "Payment failed",
  "description": "Transaction declined after XLM transfer",
  "evidenceUrls": ["ipfs://..."]
}
```

### Get Cases
**GET /api/support-cases/buyer/:wallet** - Get all cases for buyer

**GET /api/support-cases/:caseId** - Get specific case

**GET /api/support-cases/status/:status** - Get cases by status (admin only)

### Update Case (admin only)
**PATCH /api/support-cases/:caseId**
```json
{
  "status": "in_progress",
  "assignedTo": "staff@example.com"
}
```

### Add Notes
**POST /api/support-cases/:caseId/notes**
```json
{
  "author": "admin@example.com",
  "text": "Investigating transaction on-chain",
  "isPrivate": true
}
```

### Get Public Notes
**GET /api/support-cases/:caseId/notes/public** - Public notes only

### Resolve Case
**POST /api/support-cases/:caseId/resolve** (admin only)
```json
{
  "resolution": "refunded",
  "resolutionNote": "XLM transferred back to buyer wallet"
}
```

## Privacy Model

### Public Information
- Case title and description
- Case type and status
- Public notes from staff

### Private Information
- Private notes (staff only)
- Internal investigation details
- Sensitive evidence

### Access Control

**Buyers** see:
- Their own cases
- Public notes
- Case resolution
- Their own private notes

**Admin/Staff** see:
- All cases
- All notes (public and private)
- Evidence and sensitive data

## Usage in Code

```typescript
import { supportCaseService } from "../services/supportCaseService";

// Create case from failed purchase
const supportCase = await supportCaseService.createFromFailedPurchase(
  purchaseId,
  "Transaction failed due to insufficient funds"
);

// Add investigation note
await supportCaseService.addNote(caseId, {
  author: "admin@example.com",
  text: "Verified on-chain: transaction reverted",
  isPrivate: true
});

// Resolve case
await supportCaseService.resolveCase(
  caseId,
  "refunded",
  "XLM refunded to GBUYER..."
);
```

## Audit Trail

- All case creation/updates logged to AuditLog
- Private notes flagged for compliance review
- Resolution decisions create permanent records
- No case data is deleted (soft archive via status=closed)

## Best Practices

1. **Document thoroughly** - Use notes to explain decisions
2. **Separate concerns** - Use private notes for sensitive data
3. **Be consistent** - Apply similar resolutions to similar cases
4. **Audit trail** - All actions are logged
5. **Data minimization** - Only link necessary evidence
6. **Timely resolution** - Set SLAs for case closure
