/**
 * Authentication and token-gating middleware for the PromptHash API.
 *
 * Two middlewares are exported:
 *
 *  isAuthenticated(handler)
 *    Wraps a serverless handler and validates the JWT from the
 *    "auth_token" HTTP-only cookie (or Authorization: Bearer header).
 *    Attaches `req.authAddress` (Stellar public key) on success.
 *    Returns 401 on missing / invalid / expired token.
 *
 *  hasAssetAccess(requirement)(handler)
 *    Higher-order middleware that first runs isAuthenticated, then checks
 *    the verified Stellar account against Horizon to confirm it holds the
 *    required asset (XLM balance, custom token, etc.).
 *    Returns 403 when the account does not meet the requirement.
 *
 * Node-only module (used by api/ serverless functions).
 */

import { Horizon } from "@stellar/stellar-sdk";
import { verifyJwt } from "./jwt";
import { AUTH_COOKIE_NAME } from "../../../api/auth/verify";
import { apiError, ErrorCode } from "../api/errorCodes";
import type { AssetRequirement, AssetAccessResult } from "./stellarAuth";

// ─── Cookie parsing ───────────────────────────────────────────────────────────

function extractTokenFromRequest(req: any): string | null {
  // 1. HTTP-only cookie (preferred)
  const cookies: string = req.headers?.cookie ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === AUTH_COOKIE_NAME) {
      return rest.join("=").trim();
    }
  }

  // 2. Authorization: Bearer <token> header (for programmatic clients)
  const auth: string = req.headers?.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  return null;
}

// ─── isAuthenticated ─────────────────────────────────────────────────────────

export type ApiHandler = (req: any, res: any) => Promise<void> | void;

/**
 * Middleware: validates the session JWT and attaches `req.authAddress`.
 * The wrapped handler only executes when authentication succeeds.
 */
export function isAuthenticated(handler: ApiHandler): ApiHandler {
  return async (req: any, res: any) => {
    const token = extractTokenFromRequest(req);

    if (!token) {
      res.status(401).json(
        apiError(ErrorCode.CHALLENGE_INVALID, "Authentication required. Please sign in."),
      );
      return;
    }

    try {
      const payload = verifyJwt(token);
      req.authAddress = payload.sub;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid token";
      const isExpired = message.toLowerCase().includes("expired");
      res.status(401).json(
        apiError(
          isExpired ? ErrorCode.CHALLENGE_EXPIRED : ErrorCode.CHALLENGE_INVALID,
          isExpired
            ? "Your session has expired. Please sign in again."
            : "Invalid authentication token.",
        ),
      );
      return;
    }

    await handler(req, res);
  };
}

// ─── hasAssetAccess ───────────────────────────────────────────────────────────

const HORIZON_URL =
  process.env.PUBLIC_STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const STELLAR_NETWORK =
  process.env.PUBLIC_STELLAR_NETWORK ?? "TESTNET";

/** Fetch and evaluate the Horizon balance for a given asset requirement. */
export async function checkAssetAccess(
  stellarAddress: string,
  requirement: AssetRequirement,
): Promise<AssetAccessResult> {
  const horizon = new Horizon.Server(HORIZON_URL, {
    allowHttp: STELLAR_NETWORK === "LOCAL" || STELLAR_NETWORK === "STANDALONE",
  });

  let balances: Horizon.HorizonApi.BalanceLine[];
  try {
    const account = await horizon.accounts().accountId(stellarAddress).call();
    balances = account.balances;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Horizon error";
    return {
      hasAccess: false,
      balance: null,
      reason: `Failed to fetch account from Horizon: ${message}`,
    };
  }

  if (requirement.assetType === "native") {
    const nativeBalance = balances.find((b) => b.asset_type === "native");
    const amount = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
    const minimum = requirement.minimumBalance ?? 0;
    return {
      hasAccess: amount > minimum,
      balance: nativeBalance?.balance ?? "0",
      reason:
        amount <= minimum
          ? `Insufficient XLM balance. Required: >${minimum} XLM, found: ${amount} XLM`
          : undefined,
    };
  }

  // Custom asset (credit_alphanum4 or credit_alphanum12)
  const assetBalance = balances.find(
    (b): b is Horizon.HorizonApi.BalanceLineAsset<"credit_alphanum4" | "credit_alphanum12"> =>
      (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
      b.asset_code === requirement.code &&
      b.asset_issuer === requirement.issuer,
  );

  if (!assetBalance) {
    return {
      hasAccess: false,
      balance: null,
      reason: `Account does not hold asset ${requirement.code} issued by ${requirement.issuer}`,
    };
  }

  const amount = parseFloat(assetBalance.balance);
  const minimum = requirement.minimumBalance ?? 0;

  return {
    hasAccess: amount > minimum,
    balance: assetBalance.balance,
    reason:
      amount <= minimum
        ? `Insufficient ${requirement.code} balance. Required: >${minimum}, found: ${amount}`
        : undefined,
  };
}

/**
 * Higher-order middleware: runs isAuthenticated then verifies asset ownership
 * via Horizon before executing the wrapped handler.
 *
 * @example
 * export default hasAssetAccess({
 *   assetType: "credit_alphanum4",
 *   code: "USDC",
 *   issuer: "G...",
 *   minimumBalance: 1,
 * })(myHandler);
 */
export function hasAssetAccess(requirement: AssetRequirement): (handler: ApiHandler) => ApiHandler {
  return (handler: ApiHandler): ApiHandler => {
    return isAuthenticated(async (req: any, res: any) => {
      const stellarAddress: string = req.authAddress;

      const result = await checkAssetAccess(stellarAddress, requirement);

      if (!result.hasAccess) {
        req.logger?.warn(
          { address: stellarAddress.slice(0, 8) + "...", reason: result.reason },
          "Asset access denied",
        );
        res.status(403).json({
          error: result.reason ?? "You do not hold the required asset.",
          code: ErrorCode.ACCESS_NOT_PURCHASED,
        });
        return;
      }

      await handler(req, res);
    });
  };
}

/**
 * Logout helper — clears the auth cookie by setting it to expired.
 * Use in a dedicated logout endpoint or call directly in a handler.
 */
export function clearAuthCookie(res: any): void {
  res.setHeader(
    "Set-Cookie",
    [
      `${AUTH_COOKIE_NAME}=`,
      "HttpOnly",
      process.env.NODE_ENV === "production" ? "Secure" : "",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=0",
    ]
      .filter(Boolean)
      .join("; "),
  );
}
