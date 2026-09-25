import { Buffer } from "buffer";
import sodium from "libsodium-wrappers";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ENVELOPE_VERSION = 2;
const ENVELOPE_ALGORITHM = "AES-256-GCM";

function cloneBytes(value: Uint8Array) {
  return Uint8Array.from(value);
}

async function ensureSodium() {
  await sodium.ready;
  return sodium;
}

async function importAesKey(rawKey: Uint8Array, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    "raw",
    cloneBytes(rawKey),
    "AES-GCM",
    false,
    usages,
  );
}

export async function hashPrompt(prompt: string): Promise<string> {
  // Delegate to SHA-256 for consistent content hashing across the app
  return hashPromptPlaintext(prompt);
}

export async function encryptPrompt(prompt: string, publicKey: string) {
  const sodiumLib = await ensureSodium();
  const messageBytes = cloneBytes(encoder.encode(prompt));
  const publicKeyBytes = base64ToBytes(publicKey);

  // Sealed box encryption (only decryptable by the recipient's private key)
  const encryptedBytes = sodiumLib.crypto_box_seal(messageBytes, publicKeyBytes);

  return {
    hash: await hashPrompt(prompt),
    encryptedBlob: bytesToBase64(encryptedBytes),
    version: "1.0.0",
  };
}

export function bytesToBase64(value: Uint8Array) {
  return Buffer.from(value).toString("base64");
}

export function base64ToBytes(value: string) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

export function bytesToHex(value: Uint8Array) {
  return Buffer.from(value).toString("hex");
}

export async function generateAesKey() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

export async function hashPromptPlaintext(plaintext: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    cloneBytes(encoder.encode(plaintext)),
  );
  return bytesToHex(new Uint8Array(digest));
}

export interface PromptEnvelopeMetadata {
  promptId: string;
  creator: string;
  networkPassphrase: string;
  contentHash: string;
  keyId: string;
}

export interface EncryptedPromptEnvelope extends PromptEnvelopeMetadata {
  version: typeof ENVELOPE_VERSION;
  algorithm: typeof ENVELOPE_ALGORITHM;
  nonce: string;
  ciphertext: string;
}

function canonicalizeEnvelopeAad(metadata: PromptEnvelopeMetadata) {
  return JSON.stringify({
    contentHash: metadata.contentHash,
    creator: metadata.creator,
    keyId: metadata.keyId,
    networkPassphrase: metadata.networkPassphrase,
    promptId: metadata.promptId,
  });
}

function assertSupportedEnvelope(envelope: EncryptedPromptEnvelope) {
  if (envelope.version !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported encrypted prompt envelope version: ${envelope.version}`);
  }
  if (envelope.algorithm !== ENVELOPE_ALGORITHM) {
    throw new Error(`Unsupported encrypted prompt envelope algorithm: ${envelope.algorithm}`);
  }
}

/** Normalize on-chain or API content hashes to lowercase hex (64 chars). */
export function normalizeContentHash(hash: string | Uint8Array): string {
  if (hash instanceof Uint8Array) {
    return bytesToHex(hash);
  }

  const trimmed = hash.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  try {
    const bytes = base64ToBytes(trimmed);
    if (bytes.length === 32) {
      return bytesToHex(bytes);
    }
  } catch {
    // fall through
  }

  return trimmed.toLowerCase();
}

export async function encryptPromptPlaintext(
  plaintext: string,
  rawKey?: Uint8Array,
) {
  const keyBytes = rawKey ?? (await generateAesKey());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const importedKey = await importAesKey(keyBytes, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: cloneBytes(iv) },
    importedKey,
    cloneBytes(encoder.encode(plaintext)),
  );

  return {
    keyBytes,
    encryptedPrompt: bytesToBase64(new Uint8Array(ciphertext)),
    encryptionIv: bytesToBase64(iv),
    contentHash: await hashPromptPlaintext(plaintext),
  };
}

export async function encryptPromptEnvelope(
  plaintext: string,
  metadata: Omit<PromptEnvelopeMetadata, "contentHash"> & { contentHash?: string },
  rawKey?: Uint8Array,
) {
  const contentHash = metadata.contentHash ?? (await hashPromptPlaintext(plaintext));
  const envelopeMetadata: PromptEnvelopeMetadata = {
    promptId: metadata.promptId,
    creator: metadata.creator,
    networkPassphrase: metadata.networkPassphrase,
    contentHash,
    keyId: metadata.keyId,
  };
  const keyBytes = rawKey ?? (await generateAesKey());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const importedKey = await importAesKey(keyBytes, ["encrypt"]);
  const aad = encoder.encode(canonicalizeEnvelopeAad(envelopeMetadata));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: cloneBytes(iv), additionalData: cloneBytes(aad) },
    importedKey,
    cloneBytes(encoder.encode(plaintext)),
  );

  return {
    keyBytes,
    envelope: {
      version: ENVELOPE_VERSION,
      algorithm: ENVELOPE_ALGORITHM,
      nonce: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      ...envelopeMetadata,
    } satisfies EncryptedPromptEnvelope,
  };
}

export async function decryptPromptCiphertext(
  encryptedPrompt: string,
  encryptionIv: string,
  rawKey: Uint8Array,
) {
  const importedKey = await importAesKey(rawKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: cloneBytes(base64ToBytes(encryptionIv)) },
    importedKey,
    cloneBytes(base64ToBytes(encryptedPrompt)),
  );

  return decoder.decode(plaintext);
}

export async function decryptPromptEnvelope(
  envelope: EncryptedPromptEnvelope,
  rawKey: Uint8Array,
  expectedMetadata: Partial<PromptEnvelopeMetadata> = {},
) {
  assertSupportedEnvelope(envelope);
  for (const [field, expected] of Object.entries(expectedMetadata)) {
    if (
      expected !== undefined &&
      envelope[field as keyof PromptEnvelopeMetadata] !== expected
    ) {
      throw new Error(`Encrypted prompt envelope ${field} mismatch.`);
    }
  }

  const importedKey = await importAesKey(rawKey, ["decrypt"]);
  const aad = encoder.encode(canonicalizeEnvelopeAad(envelope));
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: cloneBytes(base64ToBytes(envelope.nonce)),
      additionalData: cloneBytes(aad),
    },
    importedKey,
    cloneBytes(base64ToBytes(envelope.ciphertext)),
  );

  return decoder.decode(plaintext);
}

export async function wrapPromptKey(
  rawKey: Uint8Array,
  publicKeyBase64: string,
) {
  const sodiumLib = await ensureSodium();
  return bytesToBase64(
    sodiumLib.crypto_box_seal(rawKey, base64ToBytes(publicKeyBase64)),
  );
}

export async function unwrapPromptKey(
  wrappedKeyBase64: string,
  publicKeyBase64: string,
  privateKeyBase64: string,
) {
  const sodiumLib = await ensureSodium();
  return sodiumLib.crypto_box_seal_open(
    base64ToBytes(wrappedKeyBase64),
    base64ToBytes(publicKeyBase64),
    base64ToBytes(privateKeyBase64),
  );
}
