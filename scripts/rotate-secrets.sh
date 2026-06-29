#!/bin/bash

###############################################################################
# Automated Secret Rotation Script
# 
# This script automates the rotation of challenge token secrets for the
# unlock service. It supports a grace period to prevent service disruption.
#
# Usage:
#   ./scripts/rotate-secrets.sh [--grace-period SECONDS]
#
# Environment Variables Required:
#   - ADMIN_ROTATION_TOKEN: Authentication token for rotation endpoint
#   - UNLOCK_SERVICE_URL: Base URL of the unlock service
#
# Example:
#   ADMIN_ROTATION_TOKEN=secret123 UNLOCK_SERVICE_URL=https://api.example.com \
#     ./scripts/rotate-secrets.sh --grace-period 300
###############################################################################

set -e

# Default grace period: 5 minutes (300 seconds)
GRACE_PERIOD_SECONDS=300

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --grace-period)
      GRACE_PERIOD_SECONDS="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [--grace-period SECONDS]"
      echo ""
      echo "Options:"
      echo "  --grace-period SECONDS   Grace period for old tokens (default: 300)"
      echo "  --help                   Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Validate required environment variables
if [ -z "$ADMIN_ROTATION_TOKEN" ]; then
  echo "Error: ADMIN_ROTATION_TOKEN environment variable is required"
  exit 1
fi

if [ -z "$UNLOCK_SERVICE_URL" ]; then
  echo "Error: UNLOCK_SERVICE_URL environment variable is required"
  exit 1
fi

# Calculate grace period in milliseconds
GRACE_PERIOD_MS=$((GRACE_PERIOD_SECONDS * 1000))

echo "========================================="
echo "Challenge Token Secret Rotation"
echo "========================================="
echo "Service URL: $UNLOCK_SERVICE_URL"
echo "Grace Period: ${GRACE_PERIOD_SECONDS}s (${GRACE_PERIOD_MS}ms)"
echo ""

# Call rotation endpoint
echo "Initiating secret rotation..."
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_ROTATION_TOKEN" \
  -H "Content-Type: application/json" \
  "${UNLOCK_SERVICE_URL}/api/auth/rotateSecret" \
  -w "\nHTTP_STATUS:%{http_code}")

# Extract HTTP status code
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✓ Secret rotation successful!"
  echo ""
  echo "Response:"
  echo "$BODY" | jq '.'
  
  # Extract expiration timestamp
  EXPIRES_AT=$(echo "$BODY" | jq -r '.expiresAt')
  if [ "$EXPIRES_AT" != "null" ]; then
    EXPIRES_DATE=$(date -d "@$((EXPIRES_AT / 1000))" 2>/dev/null || date -r "$((EXPIRES_AT / 1000))" 2>/dev/null || echo "N/A")
    echo ""
    echo "Previous secret will expire at: $EXPIRES_DATE"
  fi
  
  echo ""
  echo "========================================="
  echo "Next Steps:"
  echo "========================================="
  echo "1. Monitor unlock service logs for any token verification errors"
  echo "2. Previous secret will be automatically invalidated after grace period"
  echo "3. Schedule next rotation in 30-90 days"
  echo ""
  
  exit 0
else
  echo "✗ Secret rotation failed!"
  echo "HTTP Status: $HTTP_STATUS"
  echo ""
  echo "Response:"
  echo "$BODY"
  echo ""
  exit 1
fi
