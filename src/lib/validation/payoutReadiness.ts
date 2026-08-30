/**
 * Payout readiness validation for creator onboarding
 * Validates that creators have proper payout configuration before allowing paid prompt publication
 */

import { CreatorProfile } from "../profiles/creatorProfile";

export interface PayoutReadinessCheck {
  id: string;
  name: string;
  description: string;
  status: "pass" | "fail" | "warn";
  message: string;
  actionUrl?: string;
  actionText?: string;
}

export interface PayoutReadinessResult {
  isReady: boolean;
  checks: PayoutReadinessCheck[];
  blockers: string[]; // List of blocking issues
  warnings: string[]; // List of non-blocking warnings
}

export interface PayoutPreferences {
  payoutAddress: string;
  preferredCurrency?: "XLM"; // Future expansion for other assets
  minimumPayout?: number;
}

export interface CreatorReadinessData {
  address: string;
  profile?: CreatorProfile | null;
  payoutPreferences?: PayoutPreferences | null;
  hasActivePrompts?: boolean;
  walletBalance?: string;
}

/**
 * Core validation logic for payout readiness
 */
export function validatePayoutReadiness(data: CreatorReadinessData): PayoutReadinessResult {
  const checks: PayoutReadinessCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 1. Wallet Connection Check
  const walletCheck = validateWalletConnection(data);
  checks.push(walletCheck);
  if (walletCheck.status === "fail") {
    blockers.push(walletCheck.message);
  }

  // 2. Payout Destination Check
  const payoutCheck = validatePayoutDestination(data);
  checks.push(payoutCheck);
  if (payoutCheck.status === "fail") {
    blockers.push(payoutCheck.message);
  } else if (payoutCheck.status === "warn") {
    warnings.push(payoutCheck.message);
  }

  // 3. Creator Profile Check
  const profileCheck = validateCreatorProfile(data);
  checks.push(profileCheck);
  if (profileCheck.status === "fail") {
    blockers.push(profileCheck.message);
  } else if (profileCheck.status === "warn") {
    warnings.push(profileCheck.message);
  }

  // 4. Asset Settlement Check (XLM balance for transactions)
  const settlementCheck = validateSettlementReadiness(data);
  checks.push(settlementCheck);
  if (settlementCheck.status === "fail") {
    blockers.push(settlementCheck.message);
  } else if (settlementCheck.status === "warn") {
    warnings.push(settlementCheck.message);
  }

  const isReady = blockers.length === 0;

  return {
    isReady,
    checks,
    blockers,
    warnings,
  };
}

/**
 * Validate wallet connection and basic setup
 */
function validateWalletConnection(data: CreatorReadinessData): PayoutReadinessCheck {
  if (!data.address) {
    return {
      id: "wallet-connection",
      name: "Wallet Connection",
      description: "Valid Stellar wallet must be connected",
      status: "fail",
      message: "Connect your Stellar wallet to receive payments",
      actionUrl: "/profile",
      actionText: "Connect Wallet",
    };
  }

  // Basic Stellar address validation
  const stellarAddressPattern = /^G[A-Z0-9]{55}$/;
  if (!stellarAddressPattern.test(data.address)) {
    return {
      id: "wallet-connection",
      name: "Wallet Connection",
      description: "Valid Stellar wallet must be connected",
      status: "fail",
      message: "Invalid Stellar wallet address format",
      actionUrl: "/profile",
      actionText: "Check Wallet",
    };
  }

  return {
    id: "wallet-connection",
    name: "Wallet Connection",
    description: "Valid Stellar wallet must be connected",
    status: "pass",
    message: "Wallet connected successfully",
  };
}

/**
 * Validate payout destination configuration
 */
function validatePayoutDestination(data: CreatorReadinessData): PayoutReadinessCheck {
  if (!data.payoutPreferences?.payoutAddress) {
    return {
      id: "payout-destination",
      name: "Payout Destination",
      description: "Configured address where earnings will be sent",
      status: "fail",
      message: "Set up your payout address to receive earnings",
      actionUrl: "/profile/payout-settings",
      actionText: "Configure Payout",
    };
  }

  const payoutAddress = data.payoutPreferences.payoutAddress.trim();
  
  // Validate payout address format
  const stellarAddressPattern = /^G[A-Z0-9]{55}$/;
  if (!stellarAddressPattern.test(payoutAddress)) {
    return {
      id: "payout-destination",
      name: "Payout Destination", 
      description: "Configured address where earnings will be sent",
      status: "fail",
      message: "Invalid payout address format",
      actionUrl: "/profile/payout-settings",
      actionText: "Fix Payout Address",
    };
  }

  // Warn if payout address is the same as connected wallet
  if (payoutAddress === data.address) {
    return {
      id: "payout-destination",
      name: "Payout Destination",
      description: "Configured address where earnings will be sent", 
      status: "warn",
      message: "Using same address for wallet and payouts (this is fine but consider a dedicated payout address)",
    };
  }

  return {
    id: "payout-destination",
    name: "Payout Destination",
    description: "Configured address where earnings will be sent",
    status: "pass",
    message: "Payout address configured successfully",
  };
}

/**
 * Validate creator profile completeness
 */
function validateCreatorProfile(data: CreatorReadinessData): PayoutReadinessCheck {
  if (!data.profile) {
    return {
      id: "creator-profile",
      name: "Creator Profile",
      description: "Complete profile builds buyer trust and credibility",
      status: "fail", 
      message: "Complete your creator profile before listing paid prompts",
      actionUrl: "/profile",
      actionText: "Complete Profile",
    };
  }

  const profile = data.profile;
  const missingFields: string[] = [];

  // Required fields for paid listings
  if (!profile.displayName?.trim()) {
    missingFields.push("display name");
  }

  if (!profile.bio?.trim()) {
    missingFields.push("bio");
  }

  if (missingFields.length > 0) {
    return {
      id: "creator-profile",
      name: "Creator Profile", 
      description: "Complete profile builds buyer trust and credibility",
      status: "fail",
      message: `Complete your ${missingFields.join(", ")} to list paid prompts`,
      actionUrl: "/profile",
      actionText: "Complete Profile",
    };
  }

  // Optional but recommended fields
  const recommendedFields: string[] = [];
  if (!profile.avatarUrl?.trim()) {
    recommendedFields.push("profile picture");
  }
  if (!profile.websiteUrl?.trim() && !profile.twitterHandle?.trim()) {
    recommendedFields.push("website or social links");
  }

  if (recommendedFields.length > 0) {
    return {
      id: "creator-profile",
      name: "Creator Profile",
      description: "Complete profile builds buyer trust and credibility",
      status: "warn", 
      message: `Consider adding ${recommendedFields.join(", ")} to improve buyer trust`,
      actionUrl: "/profile",
      actionText: "Improve Profile",
    };
  }

  return {
    id: "creator-profile", 
    name: "Creator Profile",
    description: "Complete profile builds buyer trust and credibility",
    status: "pass",
    message: "Creator profile is complete and professional",
  };
}

/**
 * Validate settlement readiness (XLM balance for transaction fees)
 */
function validateSettlementReadiness(data: CreatorReadinessData): PayoutReadinessCheck {
  if (!data.walletBalance) {
    return {
      id: "settlement-readiness",
      name: "Settlement Readiness", 
      description: "Sufficient XLM balance for transaction fees",
      status: "warn",
      message: "Unable to verify wallet balance - ensure you have XLM for transaction fees",
    };
  }

  const balance = parseFloat(data.walletBalance);
  const minimumBalance = 1.0; // 1 XLM minimum for transaction fees

  if (balance < minimumBalance) {
    return {
      id: "settlement-readiness",
      name: "Settlement Readiness",
      description: "Sufficient XLM balance for transaction fees", 
      status: "fail",
      message: `Add at least ${minimumBalance} XLM to your wallet for transaction fees`,
      actionUrl: "https://stellar.org/developers/reference/testnet",
      actionText: "Get XLM",
    };
  }

  if (balance < 2.0) {
    return {
      id: "settlement-readiness", 
      name: "Settlement Readiness",
      description: "Sufficient XLM balance for transaction fees",
      status: "warn",
      message: "Low XLM balance - consider adding more for multiple transactions",
    };
  }

  return {
    id: "settlement-readiness",
    name: "Settlement Readiness", 
    description: "Sufficient XLM balance for transaction fees",
    status: "pass",
    message: "Sufficient balance for transaction fees",
  };
}

/**
 * Get payout preferences from localStorage
 */
export function getPayoutPreferences(address: string): PayoutPreferences | null {
  try {
    const storageKey = `prompt-hash:payout:${address}`;
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Check if a creator is ready for paid prompt publication
 * This is the main function to be called from components
 */
export function checkCreatorPayoutReadiness(
  address: string,
  profile?: CreatorProfile | null,
  walletBalance?: string,
): PayoutReadinessResult {
  const payoutPreferences = getPayoutPreferences(address);
  
  const data: CreatorReadinessData = {
    address,
    profile,
    payoutPreferences,
    walletBalance,
  };

  return validatePayoutReadiness(data);
}

/**
 * Helper to determine if paid prompt publication should be blocked
 */
export function shouldBlockPaidPublication(readiness: PayoutReadinessResult): boolean {
  return !readiness.isReady;
}

/**
 * Helper to get blocking issues for display
 */
export function getBlockingIssues(readiness: PayoutReadinessResult): string[] {
  return readiness.blockers;
}