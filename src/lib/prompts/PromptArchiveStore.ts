/**
 * PromptArchiveStore — UI-layer archive state backed by localStorage.
 *
 * Archive is intentionally a client-side overlay. The on-chain `active` flag
 * controls marketplace visibility; archive is a personal organisation tool
 * that preserves full history and allows restore at any time.
 */

const STORE_PREFIX = "prompt-hash:archive:";

interface ArchivedEntry {
  archivedAt: string; // ISO-8601 timestamp
}

type ArchiveStore = Record<string, ArchivedEntry>;

function storageKey(walletAddress: string): string {
  return `${STORE_PREFIX}${walletAddress}`;
}

function readStore(walletAddress: string): ArchiveStore {
  try {
    const raw = window.localStorage.getItem(storageKey(walletAddress));
    return raw ? (JSON.parse(raw) as ArchiveStore) : {};
  } catch {
    return {};
  }
}

function writeStore(walletAddress: string, store: ArchiveStore): void {
  try {
    window.localStorage.setItem(storageKey(walletAddress), JSON.stringify(store));
  } catch {
    // localStorage may be unavailable (private browsing quota exceeded etc.)
  }
}

/** Mark a prompt as archived. */
export function archivePrompt(walletAddress: string, promptId: string): void {
  const store = readStore(walletAddress);
  store[promptId] = { archivedAt: new Date().toISOString() };
  writeStore(walletAddress, store);
}

/** Restore a previously archived prompt. */
export function restorePrompt(walletAddress: string, promptId: string): void {
  const store = readStore(walletAddress);
  delete store[promptId];
  writeStore(walletAddress, store);
}

/** Returns true if the given prompt is currently archived. */
export function isPromptArchived(walletAddress: string, promptId: string): boolean {
  return promptId in readStore(walletAddress);
}

/** Returns the set of all archived prompt IDs for a wallet. */
export function getArchivedPromptIds(walletAddress: string): Set<string> {
  return new Set(Object.keys(readStore(walletAddress)));
}

/** Returns the ISO timestamp at which a prompt was archived, or null. */
export function getArchivedAt(walletAddress: string, promptId: string): string | null {
  return readStore(walletAddress)[promptId]?.archivedAt ?? null;
}
