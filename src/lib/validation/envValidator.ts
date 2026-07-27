/**
 * PromptHash Stellar environment validation helpers.
 * Checks for missing or placeholder secrets securely without exposing raw values.
 */

const PLACEHOLDER_PATTERNS = [
  /^replace-with/i,
  /^BASE64_/i,
  /^[CG]X{10,}/,
  /^your-/i,
  /^<.*>$/,
];

export function isPlaceholder(val: string | undefined): boolean {
  if (!val) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(val));
}

/**
 * Validates the core cryptographic and signing keys required by the unlock service.
 * Throws a detailed but secure error if any configuration is incorrect.
 */
export function validateUnlockSecrets() {
  const challengeSecret = process.env.CHALLENGE_TOKEN_SECRET;
  const unlockPublicKey = process.env.UNLOCK_PUBLIC_KEY;
  const unlockPrivateKey = process.env.UNLOCK_PRIVATE_KEY;

  const errors: string[] = [];

  if (!challengeSecret) {
    errors.push("CHALLENGE_TOKEN_SECRET is not configured.");
  } else if (isPlaceholder(challengeSecret)) {
    errors.push("CHALLENGE_TOKEN_SECRET still has a placeholder value.");
  } else if (challengeSecret.length < 16) {
    errors.push("CHALLENGE_TOKEN_SECRET must be at least 16 characters long.");
  }

  // Base64 keys usually consist of alphanumeric characters, +, /, and optional padding =
  const BASE64_KEY = /^[A-Za-z0-9+/=]{20,}$/;

  if (!unlockPublicKey) {
    errors.push("UNLOCK_PUBLIC_KEY is not configured.");
  } else if (isPlaceholder(unlockPublicKey)) {
    errors.push("UNLOCK_PUBLIC_KEY still has a placeholder value.");
  } else if (!BASE64_KEY.test(unlockPublicKey)) {
    errors.push("UNLOCK_PUBLIC_KEY does not match base64 format.");
  }

  if (!unlockPrivateKey) {
    errors.push("UNLOCK_PRIVATE_KEY is not configured.");
  } else if (isPlaceholder(unlockPrivateKey)) {
    errors.push("UNLOCK_PRIVATE_KEY still has a placeholder value.");
  } else if (!BASE64_KEY.test(unlockPrivateKey)) {
    errors.push("UNLOCK_PRIVATE_KEY does not match base64 format.");
  }

  if (errors.length > 0) {
    throw new Error(
      `[Unlock Service Config Error]:\n- ${errors.join("\n- ")}`
    );
  }
}
