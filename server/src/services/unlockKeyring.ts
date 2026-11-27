/**
 * Unlock key ring: custody, versioning and lookup for the keys that open
 * purchased prompts (#27). Design and rotation runbook: docs/UNLOCK_KEY_CUSTODY.md.
 *
 * Two configuration modes, both resolved here:
 *
 *   Single key (default, backward compatible)
 *     UNLOCK_PUBLIC_KEY, UNLOCK_PRIVATE_KEY, optional UNLOCK_ACTIVE_KEY_ID
 *     (defaults to "unlock-v1").
 *
 *   Key ring (rotation)
 *     UNLOCK_KEYS_JSON = [{ "keyId", "publicKey", "privateKey", "status" }]
 *     exactly one entry with status "active" (used for new wraps); entries with
 *     status "retired" are decrypt-only. UNLOCK_ACTIVE_KEY_ID, if set, must name
 *     the active entry.
 *
 * Legacy payloads carry no key version. They resolve to UNLOCK_LEGACY_KEY_ID,
 * which defaults to the active key. Set it before rotating, or legacy payloads
 * sealed under the previous key will fail to open.
 *
 * Failure policy: configuration problems throw an UnlockKeyError that lists
 * the problems without any key material. Callers return a 500 configuration
 * error. Nothing falls back to a different key silently.
 */

import {
  isValidUnlockKeyId,
  parseWrappedKey,
  WrappedKeyFormatError,
} from "../../../src/lib/crypto/wrappedKeyFormat";
import { isPlaceholder } from "../../../src/lib/validation/placeholders";

const DEFAULT_SINGLE_KEY_ID = "unlock-v1";
const BASE64_KEY = /^[A-Za-z0-9+/=]{20,}$/;

export type UnlockKeyStatus = "active" | "retired";

export interface UnlockKeyEntry {
  keyId: string;
  publicKey: string;
  privateKey: string;
  status: UnlockKeyStatus;
}

export interface UnlockKeyring {
  activeKeyId: string;
  legacyKeyId: string;
  keys: ReadonlyMap<string, UnlockKeyEntry>;
}

export type UnlockKeyErrorCode =
  | "UNLOCK_KEY_CONFIG_INVALID"
  | "UNLOCK_KEY_LOOKUP_FAILED"
  | "UNLOCK_KEY_MALFORMED_VERSION"
  | "UNLOCK_KEY_UNKNOWN_VERSION";

export class UnlockKeyError extends Error {
  readonly code: UnlockKeyErrorCode;
  /** Key version involved, when known. Identifiers are safe to log; key material never is. */
  readonly keyId?: string;
  readonly problems: readonly string[];

  constructor(code: UnlockKeyErrorCode, message: string, keyId?: string, problems: string[] = []) {
    super(message);
    this.name = "UnlockKeyError";
    this.code = code;
    this.keyId = keyId;
    this.problems = problems;
  }
}

function checkKeyMaterial(label: string, value: unknown, problems: string[]): value is string {
  if (typeof value !== "string" || value.length === 0) {
    problems.push(`${label} is not configured.`);
    return false;
  }
  if (isPlaceholder(value)) {
    problems.push(`${label} still has a placeholder value.`);
    return false;
  }
  if (!BASE64_KEY.test(value)) {
    problems.push(`${label} does not match base64 format.`);
    return false;
  }
  return true;
}

function parseKeyset(raw: string, problems: string[]): UnlockKeyEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    problems.push("UNLOCK_KEYS_JSON is not valid JSON.");
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    problems.push("UNLOCK_KEYS_JSON must be a non-empty array.");
    return [];
  }

  const entries: UnlockKeyEntry[] = [];
  parsed.forEach((item, index) => {
    const label = `UNLOCK_KEYS_JSON[${index}]`;
    if (!item || typeof item !== "object") {
      problems.push(`${label} must be an object.`);
      return;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.keyId !== "string" || !isValidUnlockKeyId(record.keyId)) {
      problems.push(`${label}.keyId is missing or malformed.`);
      return;
    }
    const keyId = record.keyId;
    if (record.status !== "active" && record.status !== "retired") {
      problems.push(`${label}.status must be "active" or "retired" (key ${keyId}).`);
      return;
    }
    const publicOk = checkKeyMaterial(`${keyId} publicKey`, record.publicKey, problems);
    const privateOk = checkKeyMaterial(`${keyId} privateKey`, record.privateKey, problems);
    if (publicOk && privateOk) {
      entries.push({
        keyId,
        publicKey: record.publicKey as string,
        privateKey: record.privateKey as string,
        status: record.status,
      });
    }
  });
  return entries;
}

/**
 * Loads the unlock key ring from env. Throws UnlockKeyError when configuration
 * is missing or inconsistent. The message lists every problem found.
 */
export function loadUnlockKeyring(env: Record<string, string | undefined> = process.env): UnlockKeyring {
  const problems: string[] = [];
  const explicitActive = env.UNLOCK_ACTIVE_KEY_ID?.trim() || undefined;
  const keysetRaw = env.UNLOCK_KEYS_JSON?.trim();

  let entries: UnlockKeyEntry[];
  if (keysetRaw) {
    entries = parseKeyset(keysetRaw, problems);
  } else {
    const keyId = explicitActive ?? DEFAULT_SINGLE_KEY_ID;
    if (!isValidUnlockKeyId(keyId)) {
      problems.push("UNLOCK_ACTIVE_KEY_ID is malformed.");
    }
    const publicOk = checkKeyMaterial("UNLOCK_PUBLIC_KEY", env.UNLOCK_PUBLIC_KEY, problems);
    const privateOk = checkKeyMaterial("UNLOCK_PRIVATE_KEY", env.UNLOCK_PRIVATE_KEY, problems);
    entries =
      publicOk && privateOk && isValidUnlockKeyId(keyId)
        ? [
            {
              keyId,
              publicKey: env.UNLOCK_PUBLIC_KEY as string,
              privateKey: env.UNLOCK_PRIVATE_KEY as string,
              status: "active",
            },
          ]
        : [];
  }

  const keys = new Map<string, UnlockKeyEntry>();
  for (const entry of entries) {
    if (keys.has(entry.keyId)) {
      problems.push(`Duplicate unlock key id "${entry.keyId}".`);
      continue;
    }
    keys.set(entry.keyId, entry);
  }

  // Rotation must produce new key material. Reusing a key under a new id
  // would make "rotation" a label change that protects nothing.
  const publicKeys = new Set<string>();
  const privateKeys = new Set<string>();
  for (const entry of keys.values()) {
    if (publicKeys.has(entry.publicKey) || privateKeys.has(entry.privateKey)) {
      problems.push(`Unlock key "${entry.keyId}" reuses key material from another version; each version must be distinct.`);
    }
    publicKeys.add(entry.publicKey);
    privateKeys.add(entry.privateKey);
  }

  const active = [...keys.values()].filter((entry) => entry.status === "active");
  if (keys.size > 0 && active.length !== 1) {
    problems.push(`Exactly one unlock key must be active (found ${active.length}).`);
  }
  const activeKeyId = active[0]?.keyId;
  if (explicitActive && activeKeyId && explicitActive !== activeKeyId) {
    problems.push("UNLOCK_ACTIVE_KEY_ID must name the active key in UNLOCK_KEYS_JSON.");
  }

  const legacyRaw = env.UNLOCK_LEGACY_KEY_ID?.trim() || undefined;
  const legacyKeyId = legacyRaw ?? activeKeyId ?? "";
  if (legacyRaw !== undefined && !isValidUnlockKeyId(legacyRaw)) {
    problems.push("UNLOCK_LEGACY_KEY_ID is malformed.");
  } else if (activeKeyId !== undefined && !keys.has(legacyKeyId)) {
    problems.push(`UNLOCK_LEGACY_KEY_ID names no configured key ("${legacyKeyId}").`);
  }

  if (problems.length > 0 || activeKeyId === undefined) {
    throw new UnlockKeyError(
      "UNLOCK_KEY_CONFIG_INVALID",
      `[Unlock Key Config Error]:\n- ${(problems.length ? problems : ["No unlock key is configured."]).join("\n- ")}`,
      undefined,
      problems,
    );
  }

  return { activeKeyId, legacyKeyId, keys };
}

/** Startup check. Returns the problems found; an empty array means the ring is valid. */
export function validateUnlockKeyring(env: Record<string, string | undefined> = process.env): string[] {
  try {
    loadUnlockKeyring(env);
    return [];
  } catch (err) {
    if (err instanceof UnlockKeyError) return [...err.problems];
    return ["Unlock key ring could not be loaded."];
  }
}

export interface ResolvedPromptUnlockKey {
  keyId: string;
  sealed: string;
  publicKey: string;
  privateKey: string;
  status: UnlockKeyStatus;
}

/**
 * Resolves the key that opens one prompt's wrapped key. Retired keys still
 * resolve, because they remain needed to decrypt existing purchases.
 *
 * Throws UnlockKeyError with a code the caller can map to a response:
 *   - LOOKUP_FAILED: the ring itself is unavailable or misconfigured.
 *   - MALFORMED_VERSION: the stored version tag cannot be parsed.
 *   - UNKNOWN_VERSION: the version is not in the ring.
 */
export function resolvePromptUnlockKey(
  wrappedKey: unknown,
  env: Record<string, string | undefined> = process.env,
): ResolvedPromptUnlockKey {
  let keyring: UnlockKeyring;
  try {
    keyring = loadUnlockKeyring(env);
  } catch {
    throw new UnlockKeyError("UNLOCK_KEY_LOOKUP_FAILED", "Unlock key ring is unavailable.");
  }

  let parsed: ReturnType<typeof parseWrappedKey>;
  try {
    parsed = parseWrappedKey(wrappedKey);
  } catch (err) {
    const message = err instanceof WrappedKeyFormatError ? err.message : "Wrapped key is malformed.";
    throw new UnlockKeyError("UNLOCK_KEY_MALFORMED_VERSION", message);
  }

  const keyId = parsed.keyId ?? keyring.legacyKeyId;
  const entry = keyring.keys.get(keyId);
  if (!entry) {
    throw new UnlockKeyError(
      "UNLOCK_KEY_UNKNOWN_VERSION",
      `No unlock key is configured for version "${keyId}".`,
      keyId,
    );
  }

  return {
    keyId: entry.keyId,
    sealed: parsed.sealed,
    publicKey: entry.publicKey,
    privateKey: entry.privateKey,
    status: entry.status,
  };
}
