# PromptHash Stellar API Contracts

This document defines the public API contracts and expected behaviors for PromptHash Stellar. These contracts are tested with drift tests to ensure backward compatibility and detect unintended changes.

## Core Concepts

- **Contract**: The guaranteed request/response shape and behavior for an endpoint
- **Drift**: An incompatible change to a contract (breaking change)
- **Deduplication**: Idempotent operations use stable keys to prevent duplicate side effects
- **Deep Links**: Relative paths for navigating users to relevant workflows

## Authentication

All API endpoints (except `/health`) require one of:
1. **Bearer Token** in `Authorization: Bearer <token>`
2. **API Key** in `X-API-Key: <key>`
3. **Wallet Challenge** for user operations (signed message)

## Error Responses

All error responses follow this format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

Common error codes:
- `UNAUTHORIZED` - Missing or invalid credentials
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource doesn't exist
- `VALIDATION_ERROR` - Request validation failed
- `CONFLICT` - Resource conflict (e.g., duplicate purchase)
- `RATE_LIMITED` - Rate limit exceeded

## Pagination

List endpoints support pagination with:
- `limit` (default: 20, max: 100)
- `skip` (default: 0)
- Response includes: `total`, `hasMore`, `items`

## Notification Endpoints

### POST /api/notifications

Create a notification (deduplication by idempotencyKey).

**Request:**
```json
{
  "recipientWallet": "GXXXXX",
  "type": "purchase_confirmed",
  "message": "Your purchase has been confirmed",
  "deepLink": "/purchases/abc123",
  "promptId": "prompt123",
  "promptTitle": "Best Practices Guide",
  "idempotencyKey": "event-12345"
}
```

**Response (201):**
```json
{
  "id": "notif-123",
  "recipientWallet": "GXXXXX",
  "type": "purchase_confirmed",
  "message": "Your purchase has been confirmed",
  "deepLink": "/purchases/abc123",
  "read": false,
  "createdAt": "2026-09-26T12:00:00Z"
}
```

**Deduplication**: If `idempotencyKey` already exists for this wallet, returns existing notification (200).

### GET /api/notifications

Fetch notifications for authenticated user.

**Query Parameters:**
- `limit` (1-100, default: 20)
- `skip` (default: 0)
- `type` (filter by notification type, optional)
- `unreadOnly` (boolean, default: false)

**Response (200):**
```json
{
  "notifications": [
    {
      "id": "notif-123",
      "type": "purchase_confirmed",
      "message": "...",
      "read": false,
      "createdAt": "2026-09-26T12:00:00Z"
    }
  ],
  "total": 42,
  "hasMore": true
}
```

### GET /api/notifications/unread-count

Get count of unread notifications for authenticated user.

**Response (200):**
```json
{
  "unreadCount": 5
}
```

### PATCH /api/notifications/:id/read

Mark a single notification as read.

**Response (200):**
```json
{
  "id": "notif-123",
  "read": true,
  "readAt": "2026-09-26T12:10:00Z"
}
```

### PATCH /api/notifications/mark-all-read

Mark all notifications as read.

**Response (200):**
```json
{
  "updatedCount": 5
}
```

## Access Control Endpoints

### GET /api/roles

Get available roles and their permissions.

**Response (200):**
```json
{
  "roles": {
    "admin": {
      "permissions": [
        "manage_users",
        "manage_roles",
        "view_audit_logs"
      ]
    },
    "creator": {
      "permissions": [
        "publish_prompts",
        "edit_own_prompts"
      ]
    }
  }
}
```

### POST /api/users/:userId/roles

Change user role (admin only).

**Request:**
```json
{
  "role": "creator"
}
```

**Response (200):**
```json
{
  "userId": "user123",
  "role": "creator",
  "permissions": ["publish_prompts", "edit_own_prompts"]
}
```

### GET /api/users/me/permissions

Get current user's permissions.

**Response (200):**
```json
{
  "userId": "user123",
  "role": "buyer",
  "permissions": [
    "purchase_prompts",
    "view_purchases",
    "access_notifications"
  ]
}
```

## Accessibility

All UI endpoints must support:
- Keyboard navigation (no mouse-only actions)
- ARIA labels for form fields
- Focus management and visible focus indicators
- Error messages linked to form fields
- Semantic HTML structure

**Contract Testing:**
- Audit primary workflows for accessibility
- Form labels: all inputs have associated `<label>` or `aria-label`
- Focus states: visible outline or highlight
- Errors: linked to fields via `aria-describedby`
- Screen reader testing: primary flows are readable

## Testing Requirements

### Unit Tests
- Permission checks for each role
- Notification deduplication
- Access control enforcement

### Integration Tests
- Full notification flow (create → read → mark-as-read)
- Role changes and permission updates
- RBAC enforcement across APIs

### Contract Tests
- Response shapes match documented contracts
- Error responses include error codes
- Pagination works correctly
- Notification deduplication prevents duplicates
- Deep links are relative paths

### E2E/Accessibility Tests
- Primary workflows are keyboard navigable
- Forms have proper labels and error associations
- Focus management works correctly
- Screen reader announces critical content

## Migration Guide

### Adding a New Notification Type

1. Add type to `NotificationType` enum in `server/src/models/Notification.ts`
2. Create a contract test for the new notification
3. Update this document
4. Deploy

### Adding a New Role

1. Add role to `UserRole` type in `server/src/middleware/rbac.ts`
2. Define permissions in `ROLE_PERMISSIONS`
3. Create tests for the new role
4. Update this document
5. Deploy

### Backward Compatibility

All changes must maintain backward compatibility:
- Do not remove fields from responses
- Do not change error codes
- Add new fields as optional
- Deprecate before removing (1 version cycle minimum)

## Examples

### Complete Purchase Flow
1. User buys prompt: `POST /api/purchases` → `idempotencyKey: "purchase-12345"`
2. System sends notification: `POST /api/notifications` → `idempotencyKey: "purchase-12345"`
3. Notification is deduplicated (if retry occurs)
4. User can mark as read: `PATCH /api/notifications/:id/read`

### Creator Access Control
1. Creator publishes prompt: `POST /api/prompts` (requires `publish_prompts`)
2. Creator updates pricing: `PATCH /api/prompts/:id` (requires `edit_own_prompts`)
3. Creator gets sales: `GET /api/prompts/:id/sales` (requires creator ownership)
4. Admin views all: `GET /api/prompts` (no restrictions)

### Admin Role Change
1. Admin changes user role: `POST /api/users/:userId/roles` → `{ "role": "moderator" }`
2. Notification sent: `POST /api/notifications` → `type: "role_change"`
3. User permissions updated immediately
4. New role permissions apply to next request
