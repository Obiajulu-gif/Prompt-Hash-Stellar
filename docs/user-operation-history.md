# User Operation History Specification & Visibility Rules

## Overview
The User Operation History framework provides users with a transparent audit log of their marketplace operations while strictly protecting maintainer diagnostic data and internal system details.

## Visibility & Access Control
- Users can view **only** operation events associated with their authenticated user/wallet identity (`userId === callingUserId`).
- Accessing another user's operation history is blocked with an `Unauthorized` error.

## Filtered Internal Events
Internal-only events are filtered out from user views:
- `MAINTAINER_FLAG`
- `SYSTEM_HEALTH_CHECK`
- `ADMIN_OVERRIDE`
- `INTERNAL_AUDIT`

## Metadata Redaction Rules
Internal metadata keys are automatically stripped from payload metadata before returning data to the client:
- `internalFlagReason`
- `maintainerNote`
- `internalNodeIp`
- `encryptionIv`
- `masterSeed`
- `adminToken`
- `databaseId`
- `rawQuery`
- `stackTrace`

## Deleted Records
Operations marked as deleted (`isDeleted: true`) are safely filtered out and excluded from query results.
