/**
 * Client-side IPFS upload via Pinata.
 *
 * Prompt plaintext is always encrypted in the browser first; only opaque
 * ciphertext is uploaded here. The returned `ipfs://<cid>` reference is what
 * gets stored on-chain in place of the full payload, letting listings exceed
 * the 4KB on-chain encrypted-payload limit.
 *
 * Upload is optional: when no `PUBLIC_PINATA_JWT` is configured the create flow
 * falls back to inline on-chain storage, so existing deployments keep working.
 */
import { toIpfsUri } from "./reference";

const PINATA_PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

function readPinataJwt(): string | undefined {
  const jwt = import.meta.env.PUBLIC_PINATA_JWT;
  return typeof jwt === "string" && jwt.trim() ? jwt.trim() : undefined;
}

/** True when a Pinata JWT is configured and client-side IPFS upload is available. */
export function isIpfsUploadConfigured(): boolean {
  return Boolean(readPinataJwt());
}

export interface IpfsUploadResult {
  cid: string;
  uri: string;
}

/**
 * Uploads encrypted ciphertext to IPFS via Pinata and returns the resulting CID
 * plus a canonical `ipfs://` reference suitable for on-chain storage.
 */
export async function uploadCiphertextToIpfs(
  ciphertextBase64: string,
  options?: { name?: string },
): Promise<IpfsUploadResult> {
  const jwt = readPinataJwt();
  if (!jwt) {
    throw new Error(
      "IPFS upload is not configured. Set PUBLIC_PINATA_JWT to enable off-chain payload storage.",
    );
  }

  const name = options?.name ?? "prompt-ciphertext";
  const form = new FormData();
  form.append("file", new Blob([ciphertextBase64], { type: "text/plain" }), `${name}.txt`);
  form.append("pinataMetadata", JSON.stringify({ name }));

  const response = await fetch(PINATA_PIN_FILE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Pinata upload failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}.`,
    );
  }

  const data = (await response.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) {
    throw new Error("Pinata upload succeeded but did not return an IPFS hash.");
  }

  return { cid: data.IpfsHash, uri: toIpfsUri(data.IpfsHash) };
}
