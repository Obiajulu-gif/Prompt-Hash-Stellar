# Challenge Token Secret Rotation

## Overview

The unlock service uses HMAC-signed challenge tokens to authenticate wallet ownership before decrypting purchased prompt content. To maintain security, the signing secret should be rotated periodically. This document describes the automated rotation mechanism and operational procedures.

## Architecture

### Multi-Secret Support

The system supports multiple active secrets simultaneously during a configurable grace period. This prevents service disruption during rotation:

1. **Current Secret**: The primary secret used to sign new challenge tokens
2. **Previous Secret**: The old secret, valid during the grace period for existing tokens
3. **Grace Period**: Time window (default 5 minutes) where both secrets are valid

### Token Verification Flow

```
1. Client requests challenge token
   ↓
2. Server signs token with CURRENT secret
   ↓
3. Client signs challenge message
   ↓
4. Client submits unlock request with token
   ↓
5. Server verifies token against [CURRENT, PREVIOUS] secrets
   ↓
6. If valid with either secret, proceed with unlock
```

## Environment Variables

### Required Variables

- `CHALLENGE_TOKEN_SECRET`: Current active secret for signing tokens
- `ADMIN_ROTATION_TOKEN`: Authentication token for rotation endpoint

### Optional Variables (Rotation State)

- `CHALLENGE_TOKEN_SECRET_PREVIOUS`: Previous secret (valid during grace period)
- `CHALLENGE_TOKEN_ROTATION_TIMESTAMP`: Unix timestamp (ms) of last rotation
- `CHALLENGE_TOKEN_GRACE_PERIOD_MS`: Grace period duration in milliseconds (default: 300000 = 5 minutes)

## Rotation Methods

### 1. Automated Rotation (Recommended)

Use the provided shell script with cron scheduling:

```bash
# Set environment variables
export ADMIN_ROTATION_TOKEN="your-secure-token"
export UNLOCK_SERVICE_URL="https://your-domain.com"

# Run rotation with 10-minute grace period
./scripts/rotate-secrets.sh --grace-period 600
```

#### Cron Setup

```bash
# Copy example cron configuration
cp scripts/cron-rotation.example /etc/cron.d/prompt-hash-rotation

# Edit with your schedule and paths
sudo nano /etc/cron.d/prompt-hash-rotation

# Example: Rotate every 30 days at 2 AM UTC
0 2 1 * * /path/to/scripts/rotate-secrets.sh --grace-period 600 >> /var/log/secret-rotation.log 2>&1
```

### 2. Manual Rotation via API

```bash
curl -X POST https://your-domain.com/api/auth/rotateSecret \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "Secret rotated successfully",
  "rotationTimestamp": 1714567200000,
  "gracePeriodMs": 300000,
  "expiresAt": 1714567500000
}
```

### 3. Manual Rotation via Environment Update

For deployments without API access:

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -base64 32 | tr -d '=' | tr '+/' '-_')

# 2. Update environment variables
export CHALLENGE_TOKEN_SECRET_PREVIOUS="$CHALLENGE_TOKEN_SECRET"
export CHALLENGE_TOKEN_SECRET="$NEW_SECRET"
export CHALLENGE_TOKEN_ROTATION_TIMESTAMP=$(date +%s000)
export CHALLENGE_TOKEN_GRACE_PERIOD_MS=300000

# 3. Restart service
systemctl restart unlock-service

# 4. After grace period, clean up
unset CHALLENGE_TOKEN_SECRET_PREVIOUS
unset CHALLENGE_TOKEN_ROTATION_TIMESTAMP
```

## Rotation Schedule Recommendations

### Security Level vs. Frequency

| Security Level | Rotation Frequency | Grace Period | Use Case |
|----------------|-------------------|--------------|----------|
| **High** | Weekly | 5 minutes | Financial applications, sensitive data |
| **Standard** | Monthly (30 days) | 10 minutes | General production use |
| **Moderate** | Quarterly (90 days) | 15 minutes | Low-risk applications |

### Factors to Consider

- **Traffic Volume**: Higher traffic → longer grace periods to avoid disruption
- **Token TTL**: Challenge tokens expire after 5 minutes by default
- **Compliance**: Some regulations require specific rotation frequencies
- **Operational Capacity**: More frequent rotation requires more monitoring

## Monitoring and Alerting

### Key Metrics to Track

1. **Rotation Success Rate**
   - Alert if rotation fails
   - Retry mechanism for transient failures

2. **Token Verification Failures**
   - Spike during rotation indicates grace period too short
   - Gradual increase indicates secret compromise

3. **Grace Period Expiration**
   - Ensure previous secret is cleaned up after grace period
   - Alert if cleanup fails

### Log Monitoring

Monitor unlock service logs for:

```
✓ Secret rotation successful
✓ Token verified with current secret
⚠ Token verified with previous secret (during grace period)
✗ Token verification failed - invalid signature
```

## Troubleshooting

### Issue: Token Verification Failures After Rotation

**Symptoms:**
- Unlock requests fail with "Invalid challenge token signature"
- Errors occur immediately after rotation

**Diagnosis:**
```bash
# Check if previous secret is configured
echo $CHALLENGE_TOKEN_SECRET_PREVIOUS

# Check rotation timestamp
echo $CHALLENGE_TOKEN_ROTATION_TIMESTAMP

# Verify grace period
echo $CHALLENGE_TOKEN_GRACE_PERIOD_MS
```

**Resolution:**
1. Ensure `CHALLENGE_TOKEN_SECRET_PREVIOUS` is set to the old secret
2. Verify `CHALLENGE_TOKEN_ROTATION_TIMESTAMP` is recent
3. Increase grace period if failures persist

### Issue: Rotation Endpoint Returns 401 Unauthorized

**Symptoms:**
- Rotation script fails with HTTP 401
- API returns "Unauthorized" error

**Resolution:**
1. Verify `ADMIN_ROTATION_TOKEN` is set correctly
2. Check Authorization header format: `Bearer YOUR_TOKEN`
3. Ensure token matches server-side configuration

### Issue: Previous Secret Not Expiring

**Symptoms:**
- `CHALLENGE_TOKEN_SECRET_PREVIOUS` remains set after grace period
- Old tokens continue to work indefinitely

**Resolution:**
1. Manually clean up expired secrets:
   ```bash
   unset CHALLENGE_TOKEN_SECRET_PREVIOUS
   unset CHALLENGE_TOKEN_ROTATION_TIMESTAMP
   ```
2. Implement automated cleanup in rotation script
3. Use secret management service with TTL support

## Security Best Practices

### Secret Generation

- **Length**: Minimum 32 bytes (256 bits)
- **Entropy**: Use cryptographically secure random generator
- **Encoding**: Base64url (URL-safe, no padding)

```bash
# Good: Cryptographically secure
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'

# Bad: Weak entropy
echo "my-secret-key"
```

### Secret Storage

**Development:**
- `.env` files (never commit to git)
- Local environment variables

**Production:**
- AWS Secrets Manager
- HashiCorp Vault
- Azure Key Vault
- Google Secret Manager

**Never:**
- Hardcode in source code
- Commit to version control
- Log in plaintext
- Share via insecure channels

### Access Control

- Limit rotation endpoint to authorized operators only
- Use strong `ADMIN_ROTATION_TOKEN` (32+ characters)
- Rotate admin token separately from challenge secrets
- Audit all rotation attempts

### Incident Response

If secret compromise is suspected:

1. **Immediate Rotation**
   ```bash
   ./scripts/rotate-secrets.sh --grace-period 0
   ```

2. **Invalidate All Tokens**
   - Set grace period to 0 to immediately invalidate old tokens
   - Force users to request new challenge tokens

3. **Audit Logs**
   - Review unlock service logs for suspicious activity
   - Check for unusual token verification patterns

4. **Notify Stakeholders**
   - Inform security team
   - Document incident for compliance

## Production Deployment Checklist

- [ ] Generate strong initial secret (32+ bytes)
- [ ] Store secrets in secure secret management service
- [ ] Configure `ADMIN_ROTATION_TOKEN` for rotation endpoint
- [ ] Set up automated rotation schedule (cron or systemd timer)
- [ ] Configure monitoring and alerting for rotation failures
- [ ] Test rotation in staging environment
- [ ] Document rotation procedures in runbook
- [ ] Train operations team on manual rotation process
- [ ] Set up log aggregation for token verification events
- [ ] Establish incident response plan for secret compromise

## API Reference

### POST /api/auth/rotateSecret

Rotate the challenge token signing secret.

**Authentication:** Bearer token via `Authorization` header

**Request:**
```http
POST /api/auth/rotateSecret HTTP/1.1
Host: your-domain.com
Authorization: Bearer YOUR_ADMIN_TOKEN
Content-Type: application/json
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Secret rotated successfully",
  "rotationTimestamp": 1714567200000,
  "gracePeriodMs": 300000,
  "expiresAt": 1714567500000
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Unauthorized"
}
```

**Response (500 Internal Server Error):**
```json
{
  "error": "CHALLENGE_TOKEN_SECRET not configured"
}
```

## Future Enhancements

1. **Automatic Cleanup Worker**
   - Background job to remove expired previous secrets
   - Runs every hour to check grace period expiration

2. **Rotation History**
   - Store rotation audit trail in database
   - Track who rotated, when, and from where

3. **Multi-Region Support**
   - Coordinate rotation across multiple service instances
   - Use distributed locking to prevent race conditions

4. **Gradual Rollout**
   - Rotate secrets for percentage of traffic first
   - Monitor error rates before full rollout

5. **Emergency Rotation**
   - One-click rotation via admin dashboard
   - Immediate invalidation of all existing tokens

## Related Documentation

- [Security Model](./security-model.md) - Overall security architecture
- [API Reference](./api-reference.md) - Challenge-response protocol
- [Operations Runbook](./operations/runbook.md) - Operational procedures
