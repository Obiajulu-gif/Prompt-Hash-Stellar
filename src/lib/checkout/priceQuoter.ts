/**
 * Multi-Currency Stellar Price Quoting & Protection Engine (#760)
 *
 * Provides safe multi-currency Stellar quotes with predictable expiry
 * and slippage protection for prompt purchases.
 */

export interface SupportedAssetConfig {
  code: string;
  name: string;
  issuer: string | null;
  contractAddress?: string;
  decimals: number;
  rateNumerator: bigint;
  rateDenominator: bigint;
  defaultSlippageBps: number;
  defaultTtlSeconds: number;
}

export const DEFAULT_QUOTE_TTL_SECONDS = 60; // 60 seconds
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
export const DEFAULT_FEE_BPS = 500; // 5%

export const SUPPORTED_ASSET_CONFIGS: Record<string, SupportedAssetConfig> = {
  XLM: {
    code: "XLM",
    name: "Stellar Lumens",
    issuer: null,
    decimals: 7,
    rateNumerator: 1n,
    rateDenominator: 1n,
    defaultSlippageBps: 50,
    defaultTtlSeconds: 60,
  },
  USDC: {
    code: "USDC",
    name: "USD Coin",
    issuer: "GA5ZSEJYB37JRC5AVCIA5XYG4DZ6NMTCDD75B2B4VPP6QLY4VMKS74JD",
    decimals: 7,
    rateNumerator: 120_000n, // 1 XLM = 0.12 USDC
    rateDenominator: 1_000_000n,
    defaultSlippageBps: 50,
    defaultTtlSeconds: 60,
  },
  EURC: {
    code: "EURC",
    name: "Euro Coin",
    issuer: "GDHU6WR2E7VWVHJH2B5NZEWNZT27N5DXZC3UY4K2Q4Q4Q4Q4Q4Q4Q4Q4",
    decimals: 7,
    rateNumerator: 110_000n, // 1 XLM = 0.11 EURC
    rateDenominator: 1_000_000n,
    defaultSlippageBps: 50,
    defaultTtlSeconds: 60,
  },
};

export interface ConversionRate {
  rateNumerator: bigint;
  rateDenominator: bigint;
  formattedRate: string;
}

export interface PriceQuote {
  id: string;
  promptId: string;
  buyerAddress?: string;
  baseAsset: string; // e.g., "XLM"
  baseAmountStroops: bigint;
  quoteAsset: string; // e.g., "USDC", "XLM", "EURC"
  quoteAssetDecimals: number;
  conversionRate: ConversionRate;
  rawQuoteAmountUnits: bigint;
  quoteAmountFormatted: string;
  slippageBps: number;
  slippageAmountUnits: bigint;
  maxChargeAmountUnits: bigint;
  maxChargeFormatted: string;
  feeBps: number;
  platformFeeUnits: bigint;
  platformFeeFormatted: string;
  creatorAmountUnits: bigint;
  creatorAmountFormatted: string;
  createdAt: number; // timestamp in ms
  expiresAt: number; // timestamp in ms
  ttlSeconds: number;
  termsHash: string;
}

export interface QuoteGenerationOptions {
  promptId: string | bigint;
  baseAmountStroops: bigint;
  targetAsset?: string;
  buyerAddress?: string;
  slippageBps?: number;
  ttlSeconds?: number;
  feeBps?: number;
  now?: number; // Injectable timestamp for deterministic testing
  customAssetConfigs?: Record<string, SupportedAssetConfig>;
}

export interface QuoteValidationOptions {
  promptId: string | bigint;
  requestedAsset: string;
  maxAuthorizedAmountUnits?: bigint;
  now?: number;
}

export interface QuoteValidationResult {
  isValid: boolean;
  errorCode?: string;
  errorMessage?: string;
  quote?: PriceQuote;
}

/**
 * Format asset units (bigint) to decimal string based on decimals count.
 * Trims unnecessary trailing zeros after decimal point.
 */
export function formatAssetUnits(units: bigint, decimals = 7): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const str = abs.toString().padStart(decimals + 1, "0");
  const integerPart = str.slice(0, str.length - decimals);
  const decimalPart = str.slice(str.length - decimals).replace(/0+$/, "");
  const result = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
  return negative ? `-${result}` : result;
}

/**
 * Parse string asset amount to bigint units.
 */
export function parseAssetUnitsToBigInt(amountStr: string, decimals = 7): bigint {
  const str = amountStr.trim();
  if (!str || isNaN(Number(str))) {
    throw new Error(`Invalid asset amount: "${amountStr}"`);
  }
  const [integerPart, decimalPart = ""] = str.split(".");
  const paddedDecimal = decimalPart.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${integerPart}${paddedDecimal}`);
}

/**
 * Convert base asset Stroops to target asset units deterministically without floats.
 */
export function convertBaseStroopsToAssetUnits(
  baseStroops: bigint,
  rateNumerator: bigint,
  rateDenominator: bigint
): bigint {
  if (baseStroops < 0n || rateNumerator < 0n || rateDenominator <= 0n) {
    throw new Error("Invalid parameters for rate conversion.");
  }
  if (baseStroops === 0n) return 0n;
  const converted = (baseStroops * rateNumerator) / rateDenominator;
  // If base amount is positive but rate conversion rounds down to zero, floor at 1 unit.
  return converted === 0n ? 1n : converted;
}

/**
 * Calculate ceiling-rounded max charge including slippage protection.
 */
export function calculateSlippageMaxCharge(
  quoteAmountUnits: bigint,
  slippageBps: number
): { slippageAmountUnits: bigint; maxChargeAmountUnits: bigint } {
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(`Invalid slippage BPS: ${slippageBps}`);
  }
  const bpsBigInt = BigInt(slippageBps);
  // Round up slippage calculation to guarantee buyer max ceiling coverage
  const slippageAmountUnits =
    quoteAmountUnits > 0n
      ? (quoteAmountUnits * bpsBigInt + 9999n) / 10000n
      : 0n;
  const maxChargeAmountUnits = quoteAmountUnits + slippageAmountUnits;
  return { slippageAmountUnits, maxChargeAmountUnits };
}

/**
 * Helper to compute pseudo-deterministic terms hash for quote commitment validation.
 */

function generateTermsHash(
  promptId: string,
  baseStroops: bigint,
  quoteAsset: string,
  rawQuoteUnits: bigint,
  feeBps: number,
  expiresAt: number
): string {
  const payload = `${promptId}:${baseStroops}:${quoteAsset}:${rawQuoteUnits}:${feeBps}:${expiresAt}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return `0x${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

/**
 * Generate a safe multi-currency price quote for Stellar asset settlement.
 */
export function generatePriceQuote(options: QuoteGenerationOptions): PriceQuote {
  const {
    promptId,
    baseAmountStroops,
    targetAsset = "XLM",
    buyerAddress,
    slippageBps,
    ttlSeconds,
    feeBps = DEFAULT_FEE_BPS,
    now = Date.now(),
    customAssetConfigs,
  } = options;

  const promptIdStr = String(promptId);
  const configs = customAssetConfigs || SUPPORTED_ASSET_CONFIGS;
  const assetConfig = configs[targetAsset];

  if (!assetConfig) {
    throw new Error(`Unsupported quote asset: "${targetAsset}"`);
  }

  const effectiveSlippageBps =
    slippageBps !== undefined ? slippageBps : assetConfig.defaultSlippageBps;
  const effectiveTtlSeconds =
    ttlSeconds !== undefined ? ttlSeconds : assetConfig.defaultTtlSeconds;

  const rawQuoteAmountUnits = convertBaseStroopsToAssetUnits(
    baseAmountStroops,
    assetConfig.rateNumerator,
    assetConfig.rateDenominator
  );

  const { slippageAmountUnits, maxChargeAmountUnits } = calculateSlippageMaxCharge(
    rawQuoteAmountUnits,
    effectiveSlippageBps
  );

  const feeBpsBigInt = BigInt(feeBps);
  const platformFeeUnits = (rawQuoteAmountUnits * feeBpsBigInt) / 10000n;
  const creatorAmountUnits = rawQuoteAmountUnits - platformFeeUnits;

  const expiresAt = now + effectiveTtlSeconds * 1000;
  const quoteId = `quote_${promptIdStr}_${targetAsset}_${now}_${Math.floor(
    Math.random() * 10000
  )}`;

  const formattedRateStr =
    targetAsset === "XLM"
      ? "1 XLM = 1 XLM"
      : `1 XLM = ${formatAssetUnits(
          assetConfig.rateNumerator,
          assetConfig.decimals
        )} ${targetAsset}`;

  const termsHash = generateTermsHash(
    promptIdStr,
    baseAmountStroops,
    targetAsset,
    rawQuoteAmountUnits,
    feeBps,
    expiresAt
  );

  return {
    id: quoteId,
    promptId: promptIdStr,
    buyerAddress,
    baseAsset: "XLM",
    baseAmountStroops,
    quoteAsset: targetAsset,
    quoteAssetDecimals: assetConfig.decimals,
    conversionRate: {
      rateNumerator: assetConfig.rateNumerator,
      rateDenominator: assetConfig.rateDenominator,
      formattedRate: formattedRateStr,
    },
    rawQuoteAmountUnits,
    quoteAmountFormatted: formatAssetUnits(
      rawQuoteAmountUnits,
      assetConfig.decimals
    ),
    slippageBps: effectiveSlippageBps,
    slippageAmountUnits,
    maxChargeAmountUnits,
    maxChargeFormatted: formatAssetUnits(
      maxChargeAmountUnits,
      assetConfig.decimals
    ),
    feeBps,
    platformFeeUnits,
    platformFeeFormatted: formatAssetUnits(
      platformFeeUnits,
      assetConfig.decimals
    ),
    creatorAmountUnits,
    creatorAmountFormatted: formatAssetUnits(
      creatorAmountUnits,
      assetConfig.decimals
    ),
    createdAt: now,
    expiresAt,
    ttlSeconds: effectiveTtlSeconds,
    termsHash,
  };
}

/**
 * Check if a price quote is expired.
 */
export function isQuoteExpired(quote: PriceQuote, now = Date.now()): boolean {
  return now >= quote.expiresAt;
}

/**
 * Validate price quote before purchase settlement.
 */
export function validateQuoteForPurchase(
  quote: PriceQuote | null | undefined,
  options: QuoteValidationOptions
): QuoteValidationResult {
  const now = options.now ?? Date.now();

  if (!quote) {
    return {
      isValid: false,
      errorCode: "QUOTE_MISSING",
      errorMessage: "Quote record is missing or invalid.",
    };
  }

  // 1. Expiry protection: Expired quotes cannot be used for settlement
  if (isQuoteExpired(quote, now)) {
    return {
      isValid: false,
      errorCode: "QUOTE_EXPIRED",
      errorMessage:
        "Expired quotes cannot be used for purchase settlement. Please refresh quote.",
      quote,
    };
  }

  // 2. Asset mismatch protection
  if (quote.quoteAsset !== options.requestedAsset) {
    return {
      isValid: false,
      errorCode: "QUOTE_ASSET_MISMATCH",
      errorMessage: `Quote asset mismatch: quote is for "${quote.quoteAsset}", but purchase requested "${options.requestedAsset}".`,
      quote,
    };
  }

  // 3. Prompt mismatch protection
  if (String(quote.promptId) !== String(options.promptId)) {
    return {
      isValid: false,
      errorCode: "QUOTE_PROMPT_MISMATCH",
      errorMessage: `Quote prompt ID mismatch: quote is for prompt "${quote.promptId}", but purchasing prompt "${options.promptId}".`,
      quote,
    };
  }

  // 4. Max charge ceiling (slippage breach) protection
  if (
    options.maxAuthorizedAmountUnits !== undefined &&
    options.maxAuthorizedAmountUnits < quote.maxChargeAmountUnits
  ) {
    return {
      isValid: false,
      errorCode: "QUOTE_CHARGE_EXCEEDED",
      errorMessage: `Purchase charge (${quote.maxChargeAmountUnits}) exceeds quote max authorized amount (${options.maxAuthorizedAmountUnits}).`,
      quote,
    };
  }

  return {
    isValid: true,
    quote,
  };
}
