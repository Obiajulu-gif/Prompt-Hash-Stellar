/**
 * GET /api/auth/asset-check
 *
 * Checks whether the authenticated Stellar account holds the requested asset.
 * Protected by `isAuthenticated` middleware — requires a valid JWT session.
 *
 * Query parameters:
 *   assetType      "native" | "credit_alphanum4" | "credit_alphanum12"
 *   code           Asset code (omit for native XLM)
 *   issuer         Issuer address (omit for native XLM)
 *   minimumBalance Minimum balance in asset units (default: > 0)
 *
 * Returns:
 *   200 { hasAccess: boolean, balance: string | null, reason?: string }
 *   400 Bad query parameters
 *   401 Not authenticated
 */

import { withObservability } from "../../src/lib/observability/wrapper";
import { isAuthenticated, checkAssetAccess } from "../../src/lib/auth/middleware";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import type { AssetRequirement } from "../../src/lib/auth/stellarAuth";

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const { assetType, code, issuer, minimumBalance } = req.query ?? {};

  if (!assetType) {
    res
      .status(400)
      .json(apiError(ErrorCode.MISSING_FIELDS, "assetType query parameter is required."));
    return;
  }

  const validTypes = ["native", "credit_alphanum4", "credit_alphanum12"];
  if (!validTypes.includes(String(assetType))) {
    res
      .status(400)
      .json(
        apiError(
          ErrorCode.MISSING_FIELDS,
          `assetType must be one of: ${validTypes.join(", ")}`,
        ),
      );
    return;
  }

  if (assetType !== "native" && (!code || !issuer)) {
    res
      .status(400)
      .json(
        apiError(
          ErrorCode.MISSING_FIELDS,
          "code and issuer are required for non-native assets.",
        ),
      );
    return;
  }

  const requirement: AssetRequirement = {
    assetType: String(assetType) as AssetRequirement["assetType"],
    code: code ? String(code) : undefined,
    issuer: issuer ? String(issuer) : undefined,
    minimumBalance: minimumBalance ? parseFloat(String(minimumBalance)) : undefined,
  };

  const stellarAddress: string = req.authAddress;
  const result = await checkAssetAccess(stellarAddress, requirement);

  res.status(200).json(result);
}

export default withObservability(isAuthenticated(handler), "auth/asset-check");
