/**
 * Stellar destination constraints and payout settings verification (#678).
 *
 * Validates payout destination addresses, muxed accounts (SEP-0023),
 * memo requirements (SEP-0029), and network constraints to prevent failed
 * or lost marketplace settlements.
 */

import { StrKey, Horizon, MuxedAccount } from "@stellar/stellar-sdk";
import { horizonUrl as defaultHorizonUrl, stellarNetwork as defaultNetwork } from "../env";

export interface PayoutAddressFormatResult {
  isValid: boolean;
  isMuxed: boolean;
  baseAddress: string;
  muxedId?: string;
  type?: "standard" | "muxed";
  error?: string;
  warning?: string;
}

export interface PayoutOnChainVerificationResult {
  exists: boolean;
  isFunded: boolean;
  balanceXlm?: string;
  memoRequiredSep29: boolean;
  memoRequiredHandled: boolean;
  isMuxed: boolean;
  baseAddress: string;
  muxedId?: string;
  network: string;
  status: "verified" | "unfunded" | "memo_required_blocked" | "network_error" | "invalid";
  error?: string;
  warning?: string;
}

/**
 * Validates the syntax, format, and type of a Stellar payout destination address.
 * Supports standard G... Ed25519 addresses and M... Med25519 Muxed Accounts (SEP-0023).
 * Explicitly rejects secret keys (S...), contract IDs (C...), and signed payloads (P...).
 */
export function validatePayoutAddressFormat(
  address: string,
  connectedAddress?: string,
): PayoutAddressFormatResult {
  const trimmed = (address || "").trim();

  if (!trimmed) {
    if (connectedAddress && connectedAddress.trim()) {
      return validatePayoutAddressFormat(connectedAddress);
    }
    return {
      isValid: false,
      isMuxed: false,
      baseAddress: "",
      error: "Payout address cannot be empty.",
    };
  }

  // Prevent secret key leakage
  if (trimmed.startsWith("S")) {
    return {
      isValid: false,
      isMuxed: false,
      baseAddress: "",
      error: "Security violation: Secret keys (S...) must never be used as a payout destination.",
    };
  }

  // Prevent contract IDs as direct creator payout destinations
  if (trimmed.startsWith("C")) {
    return {
      isValid: false,
      isMuxed: false,
      baseAddress: "",
      error: "Contract IDs (C...) cannot receive direct creator payouts. Provide a standard wallet or muxed account.",
    };
  }

  // Prevent signed payload addresses
  if (trimmed.startsWith("P")) {
    return {
      isValid: false,
      isMuxed: false,
      baseAddress: "",
      error: "Signed payload addresses (P...) are not valid payout destinations.",
    };
  }

  // Muxed Account (M...) - SEP-0023
  if (trimmed.startsWith("M")) {
    if (!StrKey.isValidMed25519PublicKey(trimmed)) {
      return {
        isValid: false,
        isMuxed: true,
        baseAddress: "",
        error: "Invalid Stellar Muxed Account (M...) address format or checksum.",
      };
    }

    try {
      const muxed = MuxedAccount.fromAddress(trimmed, "0");
      const baseGAddress = muxed.baseAccount().accountId();
      const muxedId = muxed.id();

      return {
        isValid: true,
        isMuxed: true,
        baseAddress: baseGAddress,
        muxedId: muxedId || undefined,
        type: "muxed",
      };
    } catch {
      return {
        isValid: false,
        isMuxed: true,
        baseAddress: "",
        error: "Failed to decode Muxed Account ID.",
      };
    }
  }

  // Standard Account (G...) - Ed25519
  if (trimmed.startsWith("G")) {
    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      return {
        isValid: false,
        isMuxed: false,
        baseAddress: "",
        error: "Invalid Stellar public key (G...) address format or checksum.",
      };
    }

    const isSameAsConnected =
      Boolean(connectedAddress) &&
      trimmed.toUpperCase() === connectedAddress?.trim().toUpperCase();

    return {
      isValid: true,
      isMuxed: false,
      baseAddress: trimmed,
      type: "standard",
      warning: isSameAsConnected
        ? "Using same address as connected wallet (this is fine, but consider a dedicated payout address)."
        : undefined,
    };
  }

  return {
    isValid: false,
    isMuxed: false,
    baseAddress: "",
    error: "Invalid address prefix. Stellar payout addresses must begin with 'G' or 'M'.",
  };
}

/**
 * Checks on-chain ledger state for a destination address via Horizon:
 * - Checks whether the destination account exists and is funded with XLM.
 * - Checks SEP-0029 memo requirements (`config.memo_required`).
 * - For memo-required accounts, validates that a Muxed Account (M...) is used.
 */
export async function verifyPayoutDestinationOnChain(
  address: string,
  options?: {
    horizonUrl?: string;
    network?: string;
    allowHttp?: boolean;
  },
): Promise<PayoutOnChainVerificationResult> {
  const format = validatePayoutAddressFormat(address);
  const network = options?.network || defaultNetwork || "TESTNET";
  const horizonEndpoint = options?.horizonUrl || defaultHorizonUrl || "https://horizon-testnet.stellar.org";

  if (!format.isValid) {
    return {
      exists: false,
      isFunded: false,
      memoRequiredSep29: false,
      memoRequiredHandled: false,
      isMuxed: format.isMuxed,
      baseAddress: format.baseAddress,
      network,
      status: "invalid",
      error: format.error || "Invalid payout address format",
    };
  }

  try {
    const horizon = new Horizon.Server(horizonEndpoint, {
      allowHttp: options?.allowHttp ?? (network === "LOCAL" || horizonEndpoint.startsWith("http://")),
    });

    const account = await horizon.accounts().accountId(format.baseAddress).call();

    // Account exists on ledger
    const nativeBalanceObj = account.balances.find((b) => b.asset_type === "native");
    const balanceXlm = nativeBalanceObj ? nativeBalanceObj.balance : "0";
    const isFunded = parseFloat(balanceXlm) > 0;

    // Check SEP-0029 memo requirement: data_attr with "config.memo_required"
    let memoRequiredSep29 = false;
    if (account.data_attr && account.data_attr["config.memo_required"]) {
      const rawVal = account.data_attr["config.memo_required"];
      // Value can be base64 "MQ==" (1) or "1"
      try {
        const decoded = typeof atob === "function" ? atob(rawVal) : Buffer.from(rawVal, "base64").toString("utf8");
        memoRequiredSep29 = decoded.trim() === "1";
      } catch {
        memoRequiredSep29 = rawVal === "1" || rawVal === "MQ==";
      }
    }

    if (memoRequiredSep29) {
      if (format.isMuxed) {
        // Muxed accounts encode destination routing into the address (SEP-0023/SEP-0029 compliant)
        return {
          exists: true,
          isFunded,
          balanceXlm,
          memoRequiredSep29: true,
          memoRequiredHandled: true,
          isMuxed: true,
          baseAddress: format.baseAddress,
          muxedId: format.muxedId,
          network,
          status: "verified",
          warning: "Destination account requires a memo (SEP-0029). Muxed Account ID is correctly configured.",
        };
      } else {
        // Standard G address on a memo-required custodial exchange will lose funds
        return {
          exists: true,
          isFunded,
          balanceXlm,
          memoRequiredSep29: true,
          memoRequiredHandled: false,
          isMuxed: false,
          baseAddress: format.baseAddress,
          network,
          status: "memo_required_blocked",
          error:
            "This destination account (often a centralized exchange) requires a memo (SEP-0029). Because marketplace settlements cannot attach manual transaction memos, you MUST use your exchange's Muxed Account address (starts with 'M') or a personal non-custodial wallet.",
        };
      }
    }

    if (!isFunded) {
      return {
        exists: true,
        isFunded: false,
        balanceXlm: "0",
        memoRequiredSep29: false,
        memoRequiredHandled: true,
        isMuxed: format.isMuxed,
        baseAddress: format.baseAddress,
        muxedId: format.muxedId,
        network,
        status: "unfunded",
        warning: `Account exists on ${network} but has 0 XLM balance. Ensure it remains active to receive settlements.`,
      };
    }

    return {
      exists: true,
      isFunded: true,
      balanceXlm,
      memoRequiredSep29: false,
      memoRequiredHandled: true,
      isMuxed: format.isMuxed,
      baseAddress: format.baseAddress,
      muxedId: format.muxedId,
      network,
      status: "verified",
    };
  } catch (err: any) {
    // 404 Not Found indicates the account is unfunded / does not exist on this ledger
    if (err?.response?.status === 404 || err?.status === 404 || err?.name === "NotFoundError") {
      return {
        exists: false,
        isFunded: false,
        memoRequiredSep29: false,
        memoRequiredHandled: false,
        isMuxed: format.isMuxed,
        baseAddress: format.baseAddress,
        muxedId: format.muxedId,
        network,
        status: "unfunded",
        error: `Destination account is not funded on Stellar ${network}. Payout destinations must exist on-chain with minimum reserve XLM to receive settlements.`,
      };
    }

    // Network / Horizon connectivity failure
    return {
      exists: false,
      isFunded: false,
      memoRequiredSep29: false,
      memoRequiredHandled: false,
      isMuxed: format.isMuxed,
      baseAddress: format.baseAddress,
      muxedId: format.muxedId,
      network,
      status: "network_error",
      warning: `Unable to verify destination account on Stellar Horizon (${err?.message || "network error"}). Format is valid.`,
    };
  }
}
