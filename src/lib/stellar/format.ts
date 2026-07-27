/**
 * Converts stroops (smallest unit) to XLM string
 * 1 XLM = 10,000,000 stroops
 */
export function stroopsToXlmString(stroops: bigint): string {
  const xlm = Number(stroops) / 10_000_000;
  return xlm.toString();
}

/**
 * Converts XLM to stroops
 */
export function xlmToStroops(xlm: number | string): bigint {
  const val = typeof xlm === "string" ? parseFloat(xlm) : xlm;
  return BigInt(Math.round(val * 10_000_000));
}

/**
 * Formats a price in stroops as a human-readable XLM label.
 */
export function formatPriceLabel(stroops: bigint): string {
  const xlmStr = stroopsToXlmString(stroops);
  return `${xlmStr} XLM`;
}

/**
 * Formats an address for display (truncated)
 */
export function formatAddress(
  address: string,
  prefixLength = 8,
  suffixLength = 4,
): string {
  if (address.length <= prefixLength + suffixLength) {
    return address;
  }
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

