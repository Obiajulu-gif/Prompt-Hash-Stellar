/**
 * Helpers for referencing IPFS-hosted ciphertext.
 *
 * Large encrypted prompt payloads are uploaded to IPFS and only a compact
 * `ipfs://<cid>` reference is stored on-chain — comfortably under the 4KB
 * contract field limit. These helpers let both the browser (upload side) and
 * the unlock service (fetch side) recognise and parse those references.
 *
 * This module is intentionally free of any browser- or Node-specific APIs so it
 * can be imported safely from both environments.
 */

export const IPFS_URI_PREFIX = "ipfs://";

/** Returns true when a stored payload is an IPFS reference rather than inline ciphertext. */
export function isIpfsReference(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().startsWith(IPFS_URI_PREFIX);
}

/**
 * Extracts the bare CID from an `ipfs://` reference, tolerating extra leading
 * slashes (e.g. `ipfs:///cid`). Returns null when the value is not a reference.
 */
export function parseIpfsCid(value: string | null | undefined): string | null {
  if (!isIpfsReference(value)) return null;
  const cid = value.trim().slice(IPFS_URI_PREFIX.length).replace(/^\/+/, "");
  return cid.length > 0 ? cid : null;
}

/** Builds a canonical `ipfs://<cid>` reference for storage on-chain. */
export function toIpfsUri(cid: string): string {
  const trimmed = cid.trim().replace(/^\/+/, "");
  if (!trimmed) {
    throw new Error("Cannot build an IPFS URI from an empty CID.");
  }
  return isIpfsReference(trimmed) ? trimmed : `${IPFS_URI_PREFIX}${trimmed}`;
}
