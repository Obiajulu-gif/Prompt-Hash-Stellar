/**
 * Locale-aware formatting helpers (#456).
 *
 * All helpers accept an optional `locale` string (defaults to the current
 * i18next language).  Using the browser Intl API ensures dates, numbers, and
 * currency-style amounts are rendered correctly for every supported locale.
 */
import i18n from './index';
import { stroopsToXlmString } from '../lib/stellar/format';

/** Return the active locale code, e.g. "en", "fr". */
function activeLocale(): string {
  return i18n.language?.slice(0, 2) ?? 'en';
}

/**
 * Format a Date (or ISO string / timestamp) as a localised date string.
 *
 * @example
 *   formatDate(new Date())          // "27 Jul 2026" (en)
 *   formatDate('2026-01-01', 'fr')  // "1 janv. 2026" (fr)
 */
export function formatDate(
  value: Date | string | number,
  locale?: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale ?? activeLocale(), options).format(d);
}

/**
 * Format a Date (or ISO string / timestamp) as a localised date+time string.
 *
 * @example
 *   formatDateTime(new Date()) // "27 Jul 2026, 14:05" (en)
 */
export function formatDateTime(
  value: Date | string | number,
  locale?: string,
): string {
  return formatDate(value, locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a plain number with locale-appropriate thousands separator /
 * decimal mark.
 *
 * @example
 *   formatNumber(1234567.89)        // "1,234,567.89" (en)
 *   formatNumber(1234567.89, 'de')  // "1.234.567,89" (de)
 */
export function formatNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale ?? activeLocale(), options).format(value);
}

/**
 * Format a XLM amount from raw stroops.
 * Returns a locale-formatted decimal string followed by " XLM".
 *
 * @example
 *   formatXlm(100_000_000n)  // "10 XLM"
 *   formatXlm(12_345_678n)   // "1.2345678 XLM"
 */
export function formatXlm(stroops: bigint, locale?: string): string {
  const xlm = stroopsToXlmString(stroops);
  // Parse back so Intl can format with locale decimal separator
  const numeric = parseFloat(xlm);
  if (isNaN(numeric)) return `${xlm} XLM`;
  const formatted = new Intl.NumberFormat(locale ?? activeLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  }).format(numeric);
  return `${formatted} XLM`;
}
