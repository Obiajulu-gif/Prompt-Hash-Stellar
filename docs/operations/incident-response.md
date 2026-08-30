# Incident Response and Content Moderation

This document outlines the procedures for responding to content policy violations, copyright claims, and security incidents on the Prompt Hash marketplace.

## Table of Contents

1. [Overview](#overview)
2. [Moderation Actions](#moderation-actions)
3. [Policy Violation Types](#policy-violation-types)
4. [Response Procedures](#response-procedures)
5. [Buyer Access Preservation](#buyer-access-preservation)
6. [Audit Trail and Compliance](#audit-trail-and-compliance)
7. [Reinstatement Process](#reinstatement-process)
8. [Escalation Paths](#escalation-paths)

## Overview

The Prompt Hash marketplace implements a content moderation system that allows authorized administrators to restrict, reinstate, or retire prompts that violate platform policies while preserving the integrity of existing purchase records and buyer access.

### Key Principles

- **Non-Destructive**: Moderation actions never delete purchase history or on-chain records
- **Auditable**: All moderation actions are logged with reason, policy reference, and moderator identity
- **Buyer-Preserving**: Existing buyers retain documented access to restricted content
- **Reversible**: Restrictions can be lifted through a documented appeal process

## Moderation Actions

### Available Actions

| Action | Description | Marketplace Visibility | Buyer Access | Reversible |
|--------|-------------|----------------------|--------------|------------|
| **Restrict** | Hide from public marketplace | Hidden | Preserved | Yes |
| **Reinstate** | Restore to active marketplace | Visible | Preserved | N/A |
| **Retire** | Permanent removal from marketplace | Hidden | Preserved | No |

### Action Mapping

```typescript
// Contract Status Mapping
restrict   → PromptSaleStatus::Restricted
reinstate  → PromptSaleStatus::Active
retire     → PromptSaleStatus::Retired
```

## Policy Violation Types

### Copyright Infringement

**Reason Code**: `copyright`

**Examples**:
- DMCA takedown notices
- Plagiarized content
- Unauthorized use of copyrighted material

**Required Documentation**:
- DMCA notice reference
- Copyright holder information
- Specific content claimed

**Policy Reference Format**: `DMCA-YYYY-NNN`

### Abuse and Harassment

**Reason Code**: `abuse`

**Examples**:
- Harmful content targeting individuals or groups
- Harassment or doxxing content
- Hate speech or discriminatory content

**Required Documentation**:
- Report reference number
- Description of violation
- Evidence of harm

**Policy Reference Format**: `ABUSE-YYYY-NNN`

### Malware and Security Threats

**Reason Code**: `malware`

**Examples**:
- Malicious code or instructions
- Phishing attempts
- Social engineering content

**Required Documentation**:
- Security assessment report
- Threat classification
- Affected systems/users

**Policy Reference Format**: `SEC-YYYY-NNN`

### General Policy Violations

**Reason Code**: `policy_violation`

**Examples**:
- Terms of service violations
- Community guidelines breaches
- Misrepresentation or fraud

**Required Documentation**:
- Policy section violated
- Evidence of violation
- User complaint reference (if applicable)

**Policy Reference Format**: `POL-YYYY-NNN`

### Other

**Reason Code**: `other`

Used for edge cases not covered by standard categories. Requires detailed notes.

## Response Procedures

### 1. Initial Assessment

**Timeline**: Within 24 hours of report

1. **Receive Report**
   - Via support ticket, DMCA form, or security report
   - Document reporter information and evidence
   - Assign unique tracking number

2. **Verify Claim**
   - Review prompt content
   - Check purchase history and sales count
   - Assess severity and urgency

3. **Classify Violation**
   - Select appropriate reason code
   - Determine required action (restrict/retire)
   - Identify applicable policy reference

### 2. Execute Moderation Action

**Authorization Required**: Admin wallet signature

#### API Request

```bash
POST /api/prompts/moderate
Content-Type: application/json

{
  "promptId": "12345",
  "action": "restrict",
  "reason": "copyright",
  "policyReference": "DMCA-2024-001",
  "adminWallet": "GADMIN_WALLET_ADDRESS",
  "notes": "DMCA takedown for copyrighted content. Notice received 2024-01-15."
}
```

#### Contract Call

```rust
// On-chain moderation requires admin signature
admin_set_prompt_sale_status(
    env,
    admin: Address,
    prompt_id: 12345,
    status: PromptSaleStatus::Restricted,
    reason: ModerationReason::Copyright,
    policy_reference: String::from_str(&env, "DMCA-2024-001"),
)
```

### 3. Notification

**Timeline**: Within 48 hours of action

1. **Notify Creator**
   - Email to registered address
   - Include policy reference
   - Explain appeal process
   - Provide response deadline

2. **Notify Reporters** (if applicable)
   - Confirm action taken
   - Provide reference number
   - Do not disclose sensitive details

3. **Document Notifications**
   - Log all communications
   - Record delivery timestamps
   - Save correspondence

### 4. Monitoring

1. **Track Appeal Status**
   - Monitor for creator response
   - Set reminder for deadline
   - Escalate if needed

2. **Review Impact**
   - Check for related prompts
   - Monitor for circumvention attempts
   - Update internal documentation

## Buyer Access Preservation

### Design Principle

Restricted prompts remain hidden from public marketplace discovery but preserve existing buyer access records. This prevents new purchases while honoring commitments to existing customers.

### Implementation

#### Public Marketplace Query
```typescript
// Filters out restricted prompts
const query = {
  listingStatus: "published",
  isActive: true,
  moderationStatus: { $ne: "restricted" },  // Key filter
};
```

#### Buyer Access Query
```typescript
// Returns ALL purchased prompts, including restricted
// Uses on-chain buyer index - no status filtering
const purchasedPrompts = await getPromptsByBuyer(config, buyerAddress);
```

#### Creator Dashboard
```typescript
// Creators see all their prompts regardless of status
// Includes moderation metadata for transparency
const creatorPrompts = await getPromptsByCreator(config, creatorAddress);
```

### Access Rights After Moderation

| User Type | Can View | Can Purchase | Can Unlock |
|-----------|----------|--------------|------------|
| **Public** | ❌ No | ❌ No | ❌ No |
| **Existing Buyer** | ✅ Yes | N/A | ✅ Yes |
| **Creator** | ✅ Yes | N/A | ✅ Yes |
| **Admin** | ✅ Yes | ❌ No | ✅ Yes |

## Cache Invalidation and Frontend Consistency

Moderation decisions are stored in the DB-backed marketplace API (`/api/prompts/index`) and must be reflected on the public detail page, the marketplace listing, and the creator dashboard without serving stale cached data.

### Endpoints

- `GET /api/prompts/index` — public marketplace listing. Filters out prompts whose `moderationStatus` is `restricted` or `retired`.
- `GET /api/prompts/index?walletAddress=<addr>` — creator dashboard view. Returns **all** of the creator's prompts, including moderated ones, so the current status and reason are always visible.
- `GET /api/prompts/index?onChainId=<id>` — single-prompt moderation lookup used by the detail page to render policy state.

### Consistency guarantees

- The detail page (`PromptDetailPage.tsx`) and the creator dashboard (`MyPrompts.tsx`) fetch moderation state from the DB API using React Query keys `["prompt-moderation", id]` and `["creator-moderation", address]` respectively.
- Both keys use `staleTime: 0`, `refetchOnWindowFocus: true`, and short `gcTime`, and the pages explicitly `invalidateQueries` on mount so a persisted cache can never serve a pre-moderation view.
- The on-chain `prompt-detail` and `created-prompts` caches are invalidated on mount/focus for the same reason.

### Operator checklist after a moderation action

1. Confirm the DB `moderationStatus` field is set (`none` | `restricted` | `retired`) with `moderationReason` and `moderatedAt`.
2. For marketplace-wide hiding, the public `GET /api/prompts/index` query already excludes `restricted`/`retired`.
3. Ask the affected creator to refresh their dashboard; the invalidation logic will surface the new status and reason automatically. No manual cache purge is required.

## Audit Trail and Compliance

### On-Chain Records

Every moderation action emits a `PromptAdminModerated` event:

```rust
PromptAdminModerated {
    prompt_id: u64,
    admin: Address,
    status: PromptSaleStatus,
    reason: ModerationReason,
    policy_reference: String,
}
```

### Database Records

MongoDB moderation metadata:

```javascript
{
  moderationStatus: "restricted",
  moderatedAt: ISODate("2024-01-15T10:30:00Z"),
  moderatedBy: "GADMIN_WALLET_ADDRESS",
  moderationReason: "copyright",
  moderationNotes: "DMCA takedown notice..."
}
```

### Audit Trail Service

All actions logged via `recordAuditEvent`:

```typescript
{
  action: "prompt_restrict",
  result: "success",
  promptId: "12345",
  walletAddress: "GADMIN_WALLET_ADDRESS",
  requestId: "req-uuid",
  clientIp: "192.168.1.1",
  reason: "copyright",
  metadata: {
    policyReference: "DMCA-2024-001",
    notes: "...",
    previousStatus: "Active",
    newStatus: "Restricted"
  },
  timestamp: "2024-01-15T10:30:00Z"
}
```

### Audit Log Retention

- **On-Chain Events**: Permanent (Stellar ledger)
- **Database Records**: 7 years minimum
- **Audit Logs**: 7 years minimum
- **Supporting Documents**: 7 years minimum

## Reinstatement Process

### Criteria for Reinstatement

1. **Copyright Claims**
   - Counter-notice received
   - Dispute resolved in creator's favor
   - Content modified to remove infringing material

2. **Abuse Reports**
   - Content updated to remove violations
   - Creator acknowledges policy
   - Independent review confirms compliance

3. **Policy Violations**
   - Corrective action completed
   - Waiting period elapsed
   - No repeat violations

### Reinstatement Procedure

1. **Review Appeal**
   - Verify identity of requester
   - Review supporting evidence
   - Assess remediation steps

2. **Make Decision**
   - Document reasoning
   - Get secondary approval for major cases
   - Prepare response

3. **Execute Reinstatement**

```bash
POST /api/prompts/moderate
{
  "promptId": "12345",
  "action": "reinstate",
  "reason": "other",
  "policyReference": "REINSTATE-2024-001",
  "adminWallet": "GADMIN_WALLET_ADDRESS",
  "notes": "Counter-notice accepted. Content verified compliant."
}
```

4. **Notify Parties**
   - Inform creator of reinstatement
   - Notify original reporter (if safe to do so)
   - Update internal tracking

## Escalation Paths

### Level 1: Support Team
- **Scope**: Initial triage and documentation
- **Actions**: Gather evidence, classify violation
- **Escalates to**: Level 2 for action decisions

### Level 2: Moderation Team
- **Scope**: Execute standard moderation actions
- **Actions**: Restrict/reinstate based on clear policy
- **Escalates to**: Level 3 for complex cases

### Level 3: Legal/Compliance Team
- **Scope**: Complex legal matters, appeals, major incidents
- **Actions**: Final decisions on contentious cases
- **Escalates to**: Executive team for platform-wide issues

### Emergency Escalation

For immediate threats (malware, active harm, legal urgency):

1. Execute restriction immediately
2. Notify legal team within 1 hour
3. Document action within 4 hours
4. Complete full review within 24 hours

## Best Practices

### For Moderators

- ✅ Always include detailed policy reference
- ✅ Document reasoning in notes field
- ✅ Verify prompt ID before taking action
- ✅ Use most specific reason code available
- ✅ Check for related prompts by same creator
- ❌ Never restrict without documented reason
- ❌ Never share internal notes publicly
- ❌ Never take action on personal preference

### For Response Times

- **Critical (malware, active harm)**: 1 hour
- **High (copyright, abuse)**: 24 hours
- **Medium (policy violation)**: 48 hours
- **Low (appeals, reviews)**: 5 business days

### For Communication

- Be professional and neutral
- State facts, avoid opinions
- Reference specific policies
- Provide clear next steps
- Document all interactions

## Administrative Setup

### Configure Admin Wallets

```bash
# Environment variable configuration
ADMIN_WALLETS=GADMIN1ABC,GADMIN2XYZ,GADMIN3QRS
```

### Verify Admin Access

```typescript
// Check if wallet is authorized
const isAdmin = ADMIN_WALLETS.split(',')
  .map(w => w.trim().toLowerCase())
  .includes(walletAddress.toLowerCase());
```

### Rotate Admin Access

1. Generate new admin wallet
2. Add to ADMIN_WALLETS list
3. Test access with non-destructive operation
4. Remove old admin wallet after grace period
5. Update internal documentation

## Related Documentation

- [Security Policy](../SECURITY.md)
- [Terms of Service](../TERMS.md)
- [DMCA Policy](../DMCA.md)
- [Community Guidelines](../COMMUNITY_GUIDELINES.md)

## Contact

For moderation inquiries: [moderation@prompthash.example](mailto:moderation@prompthash.example)
For security issues: [security@prompthash.example](mailto:security@prompthash.example)
For legal matters: [legal@prompthash.example](mailto:legal@prompthash.example)
