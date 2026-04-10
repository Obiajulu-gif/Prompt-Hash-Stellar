const STROOPS_PER_XLM = 10_000_000n;

const DECIMAL_PATTERN = /^(?<whole>\d+)(?:\.(?<fraction>\d{1,7})?)?$/;

export function xlmToStroops(value: string | number | bigint): bigint {
  if (typeof value === "bigint") {
    return value * STROOPS_PER_XLM;
  }

  const normalized = typeof value === "number" ? value.toString() : value.trim();
  const match = normalized.match(DECIMAL_PATTERN);
  if (!match?.groups?.whole) {
    throw new Error("Enter a valid XLM amount with up to 7 decimal places.");
  }

  const whole = BigInt(match.groups.whole);
  const fraction = (match.groups.fraction ?? "").padEnd(7, "0");
  return (whole * STROOPS_PER_XLM) + BigInt(fraction || "0");
}

export function stroopsToXlmString(value: string | number | bigint): string {
  const stroops = typeof value === "bigint" ? value : BigInt(value);
  const sign = stroops < 0 ? "-" : "";
  const normalized = stroops < 0 ? -stroops : stroops;
  const whole = normalized / STROOPS_PER_XLM;
  const fraction = (normalized % STROOPS_PER_XLM)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");

  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export function formatPriceLabel(value: string | number | bigint): string {
  return `${stroopsToXlmString(value)} XLM`;
}
