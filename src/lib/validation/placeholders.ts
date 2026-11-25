/**
 * Placeholder detection for configuration values. Kept dependency-free so
 * both the env validator and the unlock key ring can use it without a cycle.
 */

const PLACEHOLDER_PATTERNS = [
  /^replace-with/i,
  /^BASE64_/i,
  /^[CG]X{10,}/,
  /^your[-_]/i,
  /_here$/i,
  /^<.*>$/,
];

export function isPlaceholder(val: string | undefined): boolean {
  if (!val) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(val));
}
