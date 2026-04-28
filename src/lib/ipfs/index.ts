export type IpfsUploadResult = {
  cid: string;
  uri: string;
};

const IPFS_URI_PREFIX = "ipfs://";
const DEFAULT_UPLOAD_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const DEFAULT_GATEWAY_URL = "https://gateway.pinata.cloud/ipfs";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_IPFS_PAYLOAD_BYTES = 2 * 1024 * 1024;

function getEnvValue(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }

  return undefined;
}

function timeoutSignal() {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return controller.signal;
}

function assertValidCid(cid: string) {
  const validCidPattern = /^[a-zA-Z0-9]+$/;

  if (!validCidPattern.test(cid)) {
    throw new Error("Invalid IPFS CID.");
  }
}

async function readJsonWithLimit(response: Response) {
  const contentLength = response.headers.get("content-length");

  if (contentLength && Number(contentLength) > MAX_IPFS_PAYLOAD_BYTES) {
    throw new Error("IPFS payload exceeds maximum allowed size.");
  }

  const text = await response.text();

  if (new TextEncoder().encode(text).length > MAX_IPFS_PAYLOAD_BYTES) {
    throw new Error("IPFS payload exceeds maximum allowed size.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("IPFS response was not valid JSON.");
  }
}

export function isIpfsUri(value: string): boolean {
  return value.startsWith(IPFS_URI_PREFIX);
}

export function cidFromIpfsUri(value: string): string {
  if (!isIpfsUri(value)) {
    throw new Error("Value is not an IPFS URI.");
  }

  const cid = value.slice(IPFS_URI_PREFIX.length).trim();

  if (!cid) {
    throw new Error("IPFS URI is missing a CID.");
  }

  assertValidCid(cid);
  return cid;
}

export async function uploadEncryptedPromptToIpfs(
  encryptedPrompt: string,
): Promise<IpfsUploadResult> {
  const response = await fetch("/api/ipfs/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ encryptedPrompt }),
  });

  if (!response.ok) {
    throw new Error(`Failed to upload encrypted prompt to IPFS: ${response.status}`);
  }

  const data = await response.json();

  if (!data?.cid || !data?.uri) {
    throw new Error("IPFS upload response did not include a CID.");
  }

  return data;
}

export async function pinEncryptedPromptToIpfs(
  encryptedPrompt: string,
): Promise<IpfsUploadResult> {
  const jwt = getEnvValue("PINATA_JWT");
  const uploadUrl = getEnvValue("PINATA_API_URL") ?? DEFAULT_UPLOAD_URL;

  if (!jwt) {
    throw new Error("PINATA_JWT is required to upload large encrypted prompts.");
  }

  const response = await fetch(uploadUrl, {
    method: "POST",
    signal: timeoutSignal(),
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataContent: { encryptedPrompt },
      pinataMetadata: { name: "prompt-hash-encrypted-payload" },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to upload encrypted prompt to IPFS: ${response.status}`);
  }

  const data = await readJsonWithLimit(response);
  const cid = data?.IpfsHash ?? data?.cid;

  if (!cid || typeof cid !== "string") {
    throw new Error("IPFS upload response did not include a CID.");
  }

  assertValidCid(cid);

  return {
    cid,
    uri: `${IPFS_URI_PREFIX}${cid}`,
  };
}

export async function fetchEncryptedPromptFromIpfs(
  uriOrCid: string,
): Promise<string> {
  const cid = isIpfsUri(uriOrCid) ? cidFromIpfsUri(uriOrCid) : uriOrCid.trim();

  assertValidCid(cid);

  const gateway = getEnvValue("IPFS_GATEWAY_URL") ?? DEFAULT_GATEWAY_URL;

  const response = await fetch(
    `${gateway.replace(/\/$/, "")}/${encodeURIComponent(cid)}`,
    { signal: timeoutSignal() },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch encrypted prompt from IPFS: ${response.status}`);
  }

  const data = await readJsonWithLimit(response);

  if (
    data !== null &&
    typeof data === "object" &&
    typeof data.encryptedPrompt === "string"
  ) {
    return data.encryptedPrompt;
  }

  throw new Error("IPFS payload did not include encryptedPrompt.");
}