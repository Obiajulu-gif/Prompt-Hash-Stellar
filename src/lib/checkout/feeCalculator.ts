/**
 * Fee Calculation Module (#455)
 *
 * Provides deterministic fee calculations that match the Soroban contract:
 * platform_fee = (price * fee_bps) / 10000;
 * seller_amount = price - platform_fee;
 */

export const STROOPS_PER_XLM = 10_000_000n;
export const DEFAULT_FEE_BPS = 500; // 5% platform fee (500 Basis Points)
export const MAX_FEE_BPS = 10_000;

export interface FeeConfig {
  feeBps: number;
  asset: string; // "XLM"
  updatedAt?: number;
  isAvailable?: boolean;
}

export interface FeeBreakdown {
  promptPriceXlm: string;
  platformFeeXlm: string;
  creatorAmountXlm: string;
  totalChargedXlm: string;
  asset: string;
  feeBps: number;
  promptPriceStroops: bigint;
  platformFeeStroops: bigint;
  creatorAmountStroops: bigint;
  totalChargedStroops: bigint;
  isStale: boolean;
  isAvailable: boolean;
  errorMessage?: string;
}

/**
 * Convert XLM string or number to Stroops (bigint) safely without floating point inaccuracy.
 */
export function xlmToStroopsBigInt(xlm: string | number): bigint {
  const str = typeof xlm === 'number' ? xlm.toString() : xlm.trim();
  if (!str || isNaN(Number(str))) {
    throw new Error(`Invalid XLM amount: "${xlm}"`);
  }

  const [integerPart, decimalPart = ''] = str.split('.');
  const paddedDecimal = decimalPart.padEnd(7, '0').slice(0, 7);
  const totalStroopsStr = `${integerPart}${paddedDecimal}`;
  return BigInt(totalStroopsStr);
}

/**
 * Convert Stroops (bigint) to formatted XLM string (up to 7 decimal places, trimmed).
 */
export function stroopsToXlmString(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const str = abs.toString().padStart(8, '0');
  const integerPart = str.slice(0, str.length - 7);
  const decimalPart = str.slice(str.length - 7).replace(/0+$/, '');
  const result = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
  return negative ? `-${result}` : result;
}

/**
 * Calculate payment breakdown deterministically matching the on-chain Soroban contract.
 */
export function calculatePaymentBreakdown(
  priceInput: string | number | bigint,
  config?: FeeConfig | null,
  maxStaleAgeMs = 15 * 60 * 1000 // 15 minutes
): FeeBreakdown {
  // Validate configuration availability
  if (!config || config.isAvailable === false || config.feeBps === undefined || config.feeBps === null) {
    return {
      promptPriceXlm: '0',
      platformFeeXlm: '0',
      creatorAmountXlm: '0',
      totalChargedXlm: '0',
      asset: config?.asset || 'XLM',
      feeBps: 0,
      promptPriceStroops: 0n,
      platformFeeStroops: 0n,
      creatorAmountStroops: 0n,
      totalChargedStroops: 0n,
      isStale: false,
      isAvailable: false,
      errorMessage: 'Fee configuration unavailable. Purchase disabled.',
    };
  }

  if (config.feeBps < 0 || config.feeBps > MAX_FEE_BPS) {
    return {
      promptPriceXlm: '0',
      platformFeeXlm: '0',
      creatorAmountXlm: '0',
      totalChargedXlm: '0',
      asset: config.asset || 'XLM',
      feeBps: config.feeBps,
      promptPriceStroops: 0n,
      platformFeeStroops: 0n,
      creatorAmountStroops: 0n,
      totalChargedStroops: 0n,
      isStale: false,
      isAvailable: false,
      errorMessage: `Invalid fee percentage (${config.feeBps} BPS).`,
    };
  }

  let promptPriceStroops: bigint;
  try {
    promptPriceStroops = typeof priceInput === 'bigint' ? priceInput : xlmToStroopsBigInt(priceInput);
  } catch (err) {
    return {
      promptPriceXlm: '0',
      platformFeeXlm: '0',
      creatorAmountXlm: '0',
      totalChargedXlm: '0',
      asset: config.asset || 'XLM',
      feeBps: config.feeBps,
      promptPriceStroops: 0n,
      platformFeeStroops: 0n,
      creatorAmountStroops: 0n,
      totalChargedStroops: 0n,
      isStale: false,
      isAvailable: false,
      errorMessage: `Invalid price: ${err.message}`,
    };
  }

  const feeBpsBigInt = BigInt(config.feeBps);

  // Exact smart contract calculation: platform_fee = (price * fee_bps) / 10000
  const platformFeeStroops = (promptPriceStroops * feeBpsBigInt) / 10000n;
  const creatorAmountStroops = promptPriceStroops - platformFeeStroops;
  const totalChargedStroops = promptPriceStroops;

  const now = Date.now();
  const isStale = Boolean(config.updatedAt && now - config.updatedAt > maxStaleAgeMs);

  return {
    promptPriceXlm: stroopsToXlmString(promptPriceStroops),
    platformFeeXlm: stroopsToXlmString(platformFeeStroops),
    creatorAmountXlm: stroopsToXlmString(creatorAmountStroops),
    totalChargedXlm: stroopsToXlmString(totalChargedStroops),
    asset: config.asset || 'XLM',
    feeBps: config.feeBps,
    promptPriceStroops,
    platformFeeStroops,
    creatorAmountStroops,
    totalChargedStroops,
    isStale,
    isAvailable: true,
  };
}
