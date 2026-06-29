/**
 * IPFS gateway access — fetching ciphertext stored off-chain.
 *
 * Used by the unlock service (Node) to resolve an `ipfs://<cid>` reference back
 * into the encrypted payload before decryption. Kept free of any Vite-only
 * (`import.meta.env`) APIs so it is safe to import in the serverless runtime;
 * the gateway can be configured via `PINATA_GATEWAY` / `IPFS_GATEWAY`, or passed
 * in explicitly by browser callers.
 */
import { parseIpfsCid } from "./reference";

/** Default public gateway used when no override is configured. */
export const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

function readEnvGateway(): string | undefined {
  // `process` is only present in Node (the unlock serverless function). Guard so
  // this module stays safe to import in the browser, where it is undefined.
  if (typeof process !== "undefined" && process.env) {
    return process.env.PINATA_GATEWAY || process.env.IPFS_GATEWAY || undefined;
  }
  return undefined;
}

/** Normalises a gateway base so it always ends with exactly one trailing slash. */
function normaliseGatewayBase(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

export function resolveGatewayBase(override?: string): string {
  return normaliseGatewayBase(override || readEnvGateway() || DEFAULT_IPFS_GATEWAY);
}

/**
 * Fetches the encrypted payload stored at an `ipfs://<cid>` reference via an
 * HTTP gateway. Returns the raw stored text (base64 ciphertext).
 */
export async function fetchCiphertextFromIpfs(
  reference: string,
  options?: { gatewayBase?: string; signal?: AbortSignal },
): Promise<string> {
  const cid = parseIpfsCid(reference);
  if (!cid) {
    throw new Error(`"${reference}" is not a valid IPFS reference.`);
  }

  const url = `${resolveGatewayBase(options?.gatewayBase)}${cid}`;
  const response = await fetch(url, { signal: options?.signal });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ciphertext from IPFS (${response.status} ${response.statusText}).`,
    );
  }
  return (await response.text()).trim();
}
