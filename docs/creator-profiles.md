# Creator Profiles and Verification

This document describes the creator profile system, verification process, and security controls for the Prompt Hash marketplace.

## Table of Contents

1. [Overview](#overview)
2. [Profile Fields](#profile-fields)
3. [Verification System](#verification-system)
4. [URL Validation and SSRF Protection](#url-validation-and-ssrf-protection)
5. [API Endpoints](#api-endpoints)
6. [Frontend Integration](#frontend-integration)
7. [Security Best Practices](#security-best-practices)

## Overview

Creator profiles allow marketplace sellers to establish identity, build reputation, and provide social proof to potential buyers. Profiles include display information, external links, and optional verification badges granted by platform administrators.

The profile shown on a listing always corresponds to the wallet that currently owns the indexed listing. Because the Soroban `Prompt.creator` is immutable, an approved off-chain ownership transfer (see `docs/architecture.md`) re-points the listing to the recipient wallet's `User` record, so the recipient's profile and payout attribution apply from that point forward.

### Key Features

- **Identity Display**: Custom display name, bio, avatar
- **Social Links**: Website, Twitter/X handle, GitHub (via website)
- **Verification Badges**: Admin-granted trust signals
- **IPFS Storage**: Decentralized profile metadata
- **SSRF Protection**: URL validation prevents internal network access

## Profile Fields

### Required Fields

| Field | Type | Limit | Description |
|-------|------|-------|-------------|
| `displayName` | string | 50 chars | Public display name shown on marketplace |
| `address` | string | - | Stellar wallet address (immutable) |

### Optional Fields

| Field | Type | Limit | Description |
|-------|------|-------|-------------|
| `bio` | string | 280 chars | Short creator biography |
| `websiteUrl` | string | - | External website URL (validated) |
| `avatarUrl` | string | - | Avatar image URL (validated) |
| `twitterHandle` | string | 15 chars | X/Twitter handle (@username) |

### System Fields

| Field | Type | Description |
|-------|------|-------------|
| `verified` | boolean | Verification badge status |
| `verifiedAt` | string (ISO 8601) | Verification grant timestamp |
| `verifiedBy` | string | Admin wallet address who granted verification |
| `metadataUri` | string | IPFS URI for profile metadata |
| `updatedAt` | string (ISO 8601) | Last profile update timestamp |

## Verification System

### Purpose

Verification badges provide trust signals to buyers by indicating that:

1. The creator's identity has been reviewed by platform administrators
2. The creator has demonstrated legitimacy through off-chain verification
3. The profile links and information have been validated

### Verification Criteria

Administrators should verify:

- ✅ Real identity confirmation (KYC if required by jurisdiction)
- ✅ Ownership of linked social accounts
- ✅ Legitimacy of external websites
- ✅ No history of policy violations or fraud
- ✅ Active participation in community

### Granting Verification

**API Endpoint**: `POST /api/profiles/verify`

**Request**:
```json
{
  "profileAddress": "GCREATOR_WALLET_ADDRESS",
  "action": "grant",
  "adminWallet": "GADMIN_WALLET_ADDRESS",
  "reason": "Verified via KYC and social account ownership"
}
```

**Response**:
```json
{
  "success": true,
  "profileAddress": "GCREATOR...",
  "verified": true,
  "message": "Profile verified successfully."
}
```

### Revoking Verification

**Request**:
```json
{
  "profileAddress": "GCREATOR_WALLET_ADDRESS",
  "action": "revoke",
  "adminWallet": "GADMIN_WALLET_ADDRESS",
  "reason": "Policy violation detected"
}
```

### Authorization

Only wallets listed in `ADMIN_WALLETS` environment variable can grant or revoke verification:

```bash
ADMIN_WALLETS=GADMIN1ABC,GADMIN2XYZ,GADMIN3QRS
```

### Audit Trail

All verification actions are logged via `recordAuditEvent`:

```typescript
{
  action: "profile_grant_verification",
  result: "success",
  walletAddress: "GADMIN...",
  metadata: {
    profileAddress: "GCREATOR...",
    action: "grant",
    verified: true,
    timestamp: "2024-01-15T10:30:00Z"
  }
}
```

## URL Validation and SSRF Protection

### Threat Model

Server-Side Request Forgery (SSRF) attacks occur when user-supplied URLs cause the server to make requests to internal networks or cloud metadata endpoints. Profile URLs are validated client-side and should be re-validated server-side.

### Protected Against

1. **Localhost Access**: `http://localhost`, `127.0.0.1`, `::1`
2. **Private Networks**: `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`
3. **Cloud Metadata**: `metadata.google.internal`, `169.254.169.254`, `metadata.aws`, `metadata.azure`
4. **IPv6 Private**: `fe80::`, `fc00::`, `fd00::`
5. **URL Credentials**: `http://user:pass@host`
6. **Non-Standard Ports**: Anything except 80, 443, 8080, 8443
7. **Dangerous Protocols**: `file://`, `ftp://`, `javascript:`, `data:`

### Validation Function

```typescript
import { validateUrlSafety } from "@/lib/profiles/creatorProfile";

const error = validateUrlSafety("https://example.com");
if (error) {
  console.error("URL blocked:", error);
  // "Internal/private IP addresses are not allowed"
}
```

### Allowed URLs

✅ Public domains: `https://example.com`  
✅ Subdomains: `https://subdomain.example.com`  
✅ Paths and queries: `https://example.com/path?query=value`  
✅ GitHub: `https://github.com/username`  
✅ Twitter: `https://twitter.com/username`  
✅ LinkedIn: `https://linkedin.com/in/username`  
✅ Standard ports: `:80`, `:443`, `:8080`, `:8443`

### Blocked URLs

❌ Localhost: `http://localhost/admin`  
❌ Private IPs: `http://192.168.1.1`  
❌ Cloud metadata: `http://169.254.169.254/latest/meta-data`  
❌ Credentials: `http://user:pass@example.com`  
❌ Non-standard ports: `http://example.com:3306`  
❌ Dangerous protocols: `file:///etc/passwd`

### Implementation

```typescript
export function validateUrlSafety(url: string): string | null {
  if (!url || !url.trim()) {
    return null;
  }

  const trimmed = url.trim();

  // Protocol check
  if (!/^https?:\/\/.+/.test(trimmed)) {
    return "URL must start with http:// or https://";
  }

  const parsed = new URL(trimmed);
  const hostname = parsed.hostname.toLowerCase();

  // Localhost check
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "Localhost URLs are not allowed";
  }

  // Private IP pattern check
  if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(hostname)) {
    return "Internal/private IP addresses are not allowed";
  }

  // Cloud metadata endpoint check
  const blocked = ["metadata.google.internal", "metadata.aws", "metadata.azure"];
  if (blocked.includes(hostname)) {
    return "This domain is not allowed";
  }

  // Credentials check
  if (parsed.username || parsed.password) {
    return "URLs with credentials are not allowed";
  }

  // Port check
  if (parsed.port && ![80, 443, 8080, 8443].includes(parseInt(parsed.port))) {
    return "Only standard web ports are allowed";
  }

  return null; // Valid
}
```

## API Endpoints

### Save Profile

**Endpoint**: Client-side localStorage + IPFS

```typescript
import { saveCreatorProfile } from "@/lib/profiles/creatorProfile";

const profile = await saveCreatorProfile(
  "GCREATOR_ADDRESS",
  {
    displayName: "Alice Creator",
    bio: "AI prompt specialist",
    websiteUrl: "https://alice.example.com",
    avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
    twitterHandle: "@alice_creates",
  }
);
```

### Get Profile

```typescript
import { getCreatorProfile } from "@/lib/profiles/creatorProfile";

const profile = await getCreatorProfile("GCREATOR_ADDRESS");
```

### Verify Profile (Admin Only)

```bash
POST /api/profiles/verify
Authorization: Admin wallet signature

{
  "profileAddress": "GCREATOR_ADDRESS",
  "action": "grant",
  "adminWallet": "GADMIN_ADDRESS",
  "reason": "KYC verified"
}
```

## Frontend Integration

### Display Verified Badge

```typescript
import { VerifiedBadge } from "@/components/VerifiedBadge";

<VerifiedBadge
  verified={profile.verified}
  verifiedAt={profile.verifiedAt}
  size="md"
  showLabel={true}
/>
```

### Inline Verified Icon

```typescript
import { VerifiedIcon } from "@/components/VerifiedBadge";

<div className="flex items-center gap-2">
  <span>{profile.displayName}</span>
  {profile.verified && <VerifiedIcon size="sm" />}
</div>
```

### Profile Display

```typescript
import { getCreatorDisplayName, getCreatorInitials } from "@/lib/profiles/creatorProfile";

const displayName = getCreatorDisplayName(address, profile);
const initials = getCreatorInitials(address, profile?.displayName);
```

## Security Best Practices

### For Developers

1. **Always Validate URLs**
   - Use `validateUrlSafety()` for all user-submitted URLs
   - Re-validate on server-side if URLs are fetched server-side
   - Never trust client-side validation alone

2. **Sanitize Display Content**
   - Escape HTML in display names and bios
   - Use React's built-in XSS protection
   - Validate string lengths before database insertion

3. **Rate Limit Profile Updates**
   - Limit profile updates to prevent spam
   - Consider cooldown periods between updates
   - Monitor for abuse patterns

4. **Audit Verification Actions**
   - Log all verification grants and revocations
   - Include admin wallet address and reason
   - Retain logs for compliance

### For Administrators

1. **Verification Standards**
   - Establish clear verification criteria
   - Document verification process
   - Require multiple verification factors
   - Review verification requests regularly

2. **Monitoring**
   - Watch for impersonation attempts
   - Monitor verified profile behavior
   - Revoke verification for policy violations
   - Review audit logs periodically

3. **URL Safety**
   - Manually review submitted URLs when granting verification
   - Check for phishing or malicious links
   - Verify ownership of linked social accounts
   - Test external websites before verification

### For Users

1. **Profile Links**
   - Only add legitimate, owned websites
   - Use HTTPS when possible
   - Keep profile information current
   - Don't share private information in bio

2. **Verification**
   - Understand verification requirements
   - Provide requested documentation
   - Maintain verified status through good behavior
   - Report impersonation of verified accounts

## Testing

### SSRF Protection Tests

Run the comprehensive SSRF test suite:

```bash
npm test server/src/tests/ssrfGuard.test.ts
```

Test coverage:
- ✅ Localhost blocking (localhost, 127.x)
- ✅ Private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x)
- ✅ Cloud metadata endpoints
- ✅ IPv6 private ranges
- ✅ URL credentials blocking
- ✅ Port restrictions
- ✅ Protocol restrictions
- ✅ Valid public URLs

### Manual Testing

```typescript
// Test various URLs
const testUrls = [
  "https://example.com",           // ✅ Valid
  "http://localhost/admin",        // ❌ Blocked
  "http://192.168.1.1",           // ❌ Blocked
  "http://169.254.169.254",       // ❌ Blocked
  "https://github.com/user",       // ✅ Valid
];

testUrls.forEach(url => {
  const error = validateUrlSafety(url);
  console.log(url, error ? `❌ ${error}` : "✅ Valid");
});
```

## Troubleshooting

### Profile Not Saving

1. Check localStorage availability
2. Verify IPFS gateway accessibility
3. Check PINATA_JWT configuration
4. Review browser console for errors

### URLs Being Blocked

1. Ensure URL uses http:// or https://
2. Check if domain is in blocked list
3. Verify port is standard (80, 443, 8080, 8443)
4. Remove credentials from URL
5. Test with `validateUrlSafety()` directly

### Verification Not Granted

1. Verify admin wallet is in ADMIN_WALLETS
2. Check audit logs for error messages
3. Ensure proper API request format
4. Review admin authorization flow

## Dashboard & Seller Analytics

Creators get operational insight into how buyers discover, purchase, refund,
and unlock their prompts via a privacy-safe analytics surface (`#711`).

### Metrics

| Metric | Derivation | Privacy note |
|--------|-----------|--------------|
| **Conversion rate** | purchases / views | Aggregated only |
| **Refund rate** | refunded purchases / purchases | Aggregated only |
| **Unlock success rate** | 1 − unlock failures / purchases | Aggregated only |
| **Satisfaction** | positive reviews / reviews | Aggregated only |
| **Active buyers** | unique buyer cohorts (suppressed below minimum cohort) | Identity redacted |

### API

`GET /api/prompts/creator/:walletAddress/analytics/support-metrics`

Returns the `SellerAnalytics` shape in `src/lib/analytics/sellerAnalytics.ts`:

```json
{
  "success": true,
  "analytics": {
    "windowDays": 30,
    "cohort": { "activeBuyers": 12, "buyerIdentitiesRedacted": true },
    "totals": { "views": 420, "purchases": 38, "refunds": 2, "unlockFailures": 4, "reviews": 11 },
    "metrics": {
      "conversionRate": 0.0904,
      "refundRate": 0.0526,
      "unlockSuccessRate": 0.8947,
      "satisfactionRate": 0.8181,
      "averageRating": 4.3
    },
    "unlockFailuresByReason": { "integrity_failure": 3, "no_access": 1 }
  }
}
```

Buyer wallet addresses never appear in this payload — identities are consumed
only at the aggregation boundary and suppressed below the minimum cohort size.

### UI

- `src/pages/sell/page.tsx` — **Analytics** view renders `SellerAnalyticsWidget`.
- `src/pages/profile/page.tsx` — My Inventory tab renders `SellerAnalyticsWidget`
  beneath `CreatorDashboard`.

## Related Documentation

- [Moderation and Policy](./operations/incident-response.md)
- [Security Policy](../SECURITY.md)
- [API Documentation](../API.md)

## Contact

For profile verification inquiries: [verification@prompthash.example](mailto:verification@prompthash.example)
For security issues: [security@prompthash.example](mailto:security@prompthash.example)
