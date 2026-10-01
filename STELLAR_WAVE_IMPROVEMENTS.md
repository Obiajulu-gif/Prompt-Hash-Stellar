# Stellar Wave Platform Enhancements

This PR implements comprehensive improvements across four major platform dimensions: **Role-Based Access Control**, **Notification System**, **API Contract Documentation**, and **Accessibility**.

## Issues Addressed

- **#801** - Implement role-based access controls across API and UI boundaries
- **#810** - Implement notification system for critical lifecycle and recovery events
- **#809** - Create public API contract documentation and drift tests
- **#811** - Add accessibility remediation for primary workflow screens

## Changes Summary

### 1. Role-Based Access Control (RBAC) - Issue #801

**Files:**
- `server/src/middleware/rbac.ts` - RBAC middleware and decorators
- `server/src/services/rbacService.ts` - RBAC service for permission management
- `server/src/tests/rbac.test.ts` - Comprehensive RBAC tests

**Features:**
- Centralized role and permission definitions (admin, creator, buyer, moderator, support, system)
- Middleware for enforcing role-based and permission-based access control
- Permission checking at API boundaries (cannot be bypassed by UI)
- Dynamic permission grants/revokes
- Context-aware access control with resource ownership checks

**Roles Defined:**
- `admin` - Full platform access, user management, feature flags
- `creator` - Publish, manage prompts, access sales analytics
- `buyer` - Purchase, view purchases, access library
- `moderator` - Review content, flag violations, suggest actions
- `support` - View tickets, respond to support, process refunds
- `system` - Internal service access, webhook management

**Usage:**
```typescript
import { requireRole, requirePermission } from 'server/src/middleware/rbac';

router.post('/admin/users', requireRole(['admin']), adminUserController);
router.post('/prompts', requirePermission('publish_prompts'), createPromptController);
```

### 2. Notification System - Issue #810

**Files:**
- `server/src/models/Notification.ts` - Updated with new notification types
- `server/src/services/notificationService.ts` - Notification service with deduplication

**Features:**
- Deduplication using idempotencyKey to prevent duplicate notifications from retried events
- Read/unread state tracking with timestamps
- Notification type filtering and pagination
- Bulk notification sending
- Deep links for UI navigation to relevant workflows
- Never exposes sensitive data (wallet addresses, keys, amounts) in payloads
- 90-day TTL expiration policy

**New Notification Types:**
- `access_granted` - User gained access to prompt
- `access_revoked` - User lost access to prompt
- `recovery_event` - Recovery action completed
- `role_change` - User role was changed
- `permission_update` - User permissions updated

**Usage:**
```typescript
import { NotificationService } from 'server/src/services/notificationService';

await NotificationService.createNotification({
  recipientWallet: userWallet,
  type: 'purchase_confirmed',
  message: 'Your purchase has been confirmed',
  deepLink: '/purchases/123',
  idempotencyKey: 'purchase-event-456', // Prevents duplicates
});

// Mark as read
await NotificationService.markAsRead(notificationId);

// Get unread count
const count = await NotificationService.getUnreadCount(userWallet);
```

### 3. API Contract Documentation - Issue #809

**Files:**
- `docs/API_CONTRACTS.md` - Complete API contract documentation
- `server/src/tests/api-contracts.test.ts` - Drift detection tests

**Features:**
- Documented request/response schemas for all public endpoints
- Error code standardization (UNAUTHORIZED, FORBIDDEN, NOT_FOUND, etc.)
- Pagination contract definition
- Authentication methods documented
- Examples for complete user flows
- Backward compatibility guarantees
- Migration guide for API changes

**Contract Testing:**
Drift tests ensure:
- Response shapes remain consistent
- Required fields are always present
- Error codes are standardized
- Pagination follows contract
- Notification types are complete
- Deep links are relative paths (no sensitive data)

### 4. Accessibility Remediation - Issue #811

**Files:**
- `src/lib/accessibility.ts` - AccessibilityAuditor utility class
- `src/test/a11y/accessibility-auditor.test.ts` - Accessibility tests
- `src/test/a11y/publishing-flow.a11y.test.tsx` - Enhanced flow tests

**Features:**
- Keyboard navigation audit (all interactive elements tab-accessible)
- Form label validation (all inputs have associated labels)
- Error association checking (errors linked via aria-describedby)
- Heading hierarchy validation (no skipped levels)
- Image alt text validation
- Color contrast auditing (manual check recommended)
- Comprehensive audit reporting

**WCAG Compliance:**
- Level A - All form fields keyboard accessible
- Level A - All form fields have labels
- Level A - Error messages associated with fields
- Level A - Heading hierarchy without skips
- Level A - Color contrast 4.5:1 for text
- Level AA - Focus visible (browser default or custom styles)

**Usage:**
```typescript
import { AccessibilityAuditor } from 'src/lib/accessibility';

const result = AccessibilityAuditor.runFullAudit(container);
console.log(AccessibilityAuditor.generateReport(result));

// Specific audits
const violations = AccessibilityAuditor.auditKeyboardNavigation(container);
const errors = AccessibilityAuditor.auditFormLabels(container);
```

## Integration Points

### RBAC + Notifications
- `role_change` notifications sent when role changes
- `permission_update` notifications reflect permission changes
- Permissions control which notification types user sees

### RBAC + API Contracts
- API contracts document which roles can access each endpoint
- Permission checking enforced server-side before any response
- Error responses include permission details for diagnostics

### Notifications + Accessibility
- Notification center should support keyboard navigation
- Unread indicator should be announced by screen readers
- Deep links should direct to accessible workflows

### API Contracts + Accessibility
- Documentation includes accessibility requirements per endpoint
- Error messages should be accessible (see accessibility audit)
- Pagination controls must be keyboard accessible

## Testing

### Run Tests
```bash
# RBAC tests
npm test -- server/src/tests/rbac.test.ts

# API contract drift tests
npm test -- server/src/tests/api-contracts.test.ts

# Accessibility auditor tests
npm test -- src/test/a11y/accessibility-auditor.test.ts

# All a11y tests
npm run test -- src/test/a11y

# Run everything
npm test
```

### Manual Testing

**RBAC:**
- Log in as different roles (admin, creator, buyer)
- Verify UI actions are only available for allowed roles
- Attempt to bypass permissions via API (should fail)

**Notifications:**
- Create purchase (sends notification)
- Retry purchase API call (notification should NOT duplicate)
- Mark as read/unread
- Filter by type
- Check deep link directs to correct workflow

**API Contracts:**
- Review all responses match documented shapes
- Check error responses have error codes
- Verify pagination hasMore logic
- Run contract tests in CI

**Accessibility:**
- Tab through primary flows without using mouse
- All form errors should be announced
- Verify heading structure (F6 in browser)
- Check color contrast with WAVE tool

## Deployment Notes

1. **Database Migrations**: No schema changes (new fields are optional/backward compatible)
2. **Feature Flags**: RBAC can be gradually rolled out via feature flag
3. **Notifications**: Idempotency key prevents issues with retries
4. **API Changes**: All changes are additive (no breaking changes)
5. **Accessibility**: No dependency changes, no performance impact

## Future Work

- Implement fine-grained RBAC (resource-level permissions)
- Add webhook notifications to supplement in-app
- Expand API contract coverage to internal APIs
- Add automated contrast checking to accessibility auditor
- Create custom focus management component library
- Implement notification preferences per type

## Checklist

- [x] RBAC middleware and service implemented
- [x] Notification system with deduplication
- [x] API contract documentation created
- [x] Contract drift tests written
- [x] Accessibility auditor utility created
- [x] Form accessibility tests enhanced
- [x] Error handling consistent across changes
- [x] No breaking API changes
- [x] Database backward compatible
- [x] Documentation comprehensive
