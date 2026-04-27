export type IpfsUploadResult = {
  cid: string
  uri: string
}

const IPFS_URI_PREFIX = "ipfs://"

type RuntimeEnv = Record<string, string | undefined>

function getProcessEnv(): RuntimeEnv {
  if (typeof process !== "undefined" && process.env) {
    return process.env
  }

  return {}
}

function getEnvValue(key: string): string | undefined {
  const processEnv = getProcessEnv()

  return (
    processEnv[key] ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.[key] as string | undefined)
      : undefined)
  )
}

export function isIpfsUri(value: string): boolean {
  return value.startsWith(IPFS_URI_PREFIX)
}

export function cidFromIpfsUri(value: string): string {
  if (!isIpfsUri(value)) {
    throw new Error("Value is not an IPFS URI.")
  }

  const cid = value.slice(IPFS_URI_PREFIX.length).trim()

  if (!cid) {
    throw new Error("IPFS URI is missing a CID.")
  }

  return cid
}

export async function uploadEncryptedPromptToIpfs(
  encryptedPrompt: string,
): Promise<IpfsUploadResult> {
  const jwt = getEnvValue("PUBLIC_PINATA_JWT") ?? getEnvValue("PINATA_JWT")
  const uploadUrl =
    getEnvValue("PUBLIC_PINATA_API_URL") ??
    getEnvValue("PINATA_API_URL") ??
    "https://api.pinata.cloud/pinning/pinJSONToIPFS"

  if (!jwt) {
    throw new Error(
      "PUBLIC_PINATA_JWT or PINATA_JWT is required to upload large encrypted prompts.",
    )
  }

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataContent: {
        encryptedPrompt,
      },
      pinataMetadata: {
        name: "prompt-hash-encrypted-payload",
      },
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to upload encrypted prompt to IPFS: ${response.status}`,
    )
  }

  const data = await response.json()
  const cid = data.IpfsHash ?? data.cid

  if (!cid) {
    throw new Error("IPFS upload response did not include a CID.")
  }

  return {
    cid,
    uri: `${IPFS_URI_PREFIX}${cid}`,
  }
}

export async function fetchEncryptedPromptFromIpfs(
  uriOrCid: string,
): Promise<string> {
  const cid = isIpfsUri(uriOrCid) ? cidFromIpfsUri(uriOrCid) : uriOrCid
  const gateway =
    getEnvValue("PUBLIC_IPFS_GATEWAY_URL") ??
    getEnvValue("IPFS_GATEWAY_URL") ??
    "https://gateway.pinata.cloud/ipfs"

  const response = await fetch(`${gateway.replace(/\/$/, "")}/${cid}`)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch encrypted prompt from IPFS: ${response.status}`,
    )
  }

  const data = await response.json()

  if (typeof data === "string") {
    return data
  }

  if (typeof data.encryptedPrompt === "string") {
    return data.encryptedPrompt
  }

  throw new Error("IPFS payload did not include encryptedPrompt.")
}