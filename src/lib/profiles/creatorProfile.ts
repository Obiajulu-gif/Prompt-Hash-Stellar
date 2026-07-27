import { DEFAULT_IPFS_GATEWAY, resolveGatewayBase } from "@/lib/ipfs/gateway";
import { parseIpfsCid, toIpfsUri } from "@/lib/ipfs/reference";

export interface CreatorProfile {
  address: string;
  displayName: string;
  bio: string;
  websiteUrl: string;
  avatarUrl: string;
  twitterHandle: string;
  metadataUri?: string;
  updatedAt: string;
}

export type CreatorProfileInput = Omit<
  CreatorProfile,
  "address" | "metadataUri" | "updatedAt"
>;

export const CREATOR_PROFILE_LIMITS = {
  displayName: 50,
  bio: 280,
};

const PROFILE_STORAGE_PREFIX = "prompt-hash:profile:";
const PROFILE_INDEX_KEY = "prompt-hash:profiles:index";
const PINATA_PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

const mockProfiles: Record<string, CreatorProfileInput> = {
  "GD...1234": {
    displayName: "Stellar Systems Lab",
    bio: "Technical prompts for architecture reviews, launch plans, and production readiness.",
    websiteUrl: "https://stellar.org",
    avatarUrl: "",
    twitterHandle: "@stellarorg",
  },
  "GB...5678": {
    displayName: "Narrative Forge",
    bio: "Creative prompt packs for fiction, worldbuilding, and long-form storytelling.",
    websiteUrl: "",
    avatarUrl: "",
    twitterHandle: "",
  },
};

export function shortenCreatorAddress(address: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Unknown";
}

export function getCreatorDisplayName(
  address: string,
  profile?: Pick<CreatorProfile, "displayName"> | null,
): string {
  return profile?.displayName?.trim() || shortenCreatorAddress(address);
}

export function getCreatorInitials(
  address: string,
  displayName?: string,
): string {
  const source = displayName?.trim() || address;
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function validateCreatorProfile(
  data: CreatorProfileInput,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.displayName.trim()) {
    errors.displayName = "Display name is required.";
  } else if (
    data.displayName.trim().length > CREATOR_PROFILE_LIMITS.displayName
  ) {
    errors.displayName = `Display name must be ${CREATOR_PROFILE_LIMITS.displayName} characters or fewer.`;
  }

  if (data.bio.length > CREATOR_PROFILE_LIMITS.bio) {
    errors.bio = `Bio must be ${CREATOR_PROFILE_LIMITS.bio} characters or fewer.`;
  }

  if (data.websiteUrl && !/^https?:\/\/.+/.test(data.websiteUrl.trim())) {
    errors.websiteUrl = "Website must start with http:// or https://";
  }

  if (data.avatarUrl && !/^https?:\/\/.+/.test(data.avatarUrl.trim())) {
    errors.avatarUrl = "Avatar URL must start with http:// or https://";
  }

  if (
    data.twitterHandle &&
    !/^@?[A-Za-z0-9_]{1,15}$/.test(data.twitterHandle.trim())
  ) {
    errors.twitterHandle =
      "Enter a valid X handle with 1-15 letters, numbers, or underscores.";
  }

  return errors;
}

export function normalizeCreatorProfile(
  address: string,
  data: CreatorProfileInput,
  metadataUri?: string,
): CreatorProfile {
  return {
    address,
    displayName: data.displayName.trim(),
    bio: data.bio.trim(),
    websiteUrl: data.websiteUrl.trim(),
    avatarUrl: data.avatarUrl.trim(),
    twitterHandle: data.twitterHandle.trim().replace(/^([^@])/, "@$1"),
    metadataUri,
    updatedAt: new Date().toISOString(),
  };
}

function profileKey(address: string): string {
  return `${PROFILE_STORAGE_PREFIX}${address}`;
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function readPinataJwt(): string | undefined {
  const jwt = import.meta.env.PUBLIC_PINATA_JWT;
  return typeof jwt === "string" && jwt.trim() ? jwt.trim() : undefined;
}

function readProfileIndex(): Record<string, string> {
  const storage = safeLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(PROFILE_INDEX_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeProfileIndex(index: Record<string, string>) {
  safeLocalStorage()?.setItem(PROFILE_INDEX_KEY, JSON.stringify(index));
}

async function pinCreatorProfileToIpfs(
  profile: CreatorProfile,
): Promise<string | undefined> {
  const jwt = readPinataJwt();
  if (!jwt) return undefined;

  const response = await fetch(PINATA_PIN_JSON_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataMetadata: {
        name: `creator-profile-${profile.address.slice(0, 8)}`,
      },
      pinataContent: {
        schema: "prompt-hash.creator-profile.v1",
        sep: {
          profileMetadata: "SEP-1 stellar.toml account metadata",
          webAuth: "SEP-10 wallet authentication compatible",
          federation: "SEP-2 address discovery compatible",
        },
        ...profile,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Profile IPFS upload failed (${response.status} ${response.statusText}).`,
    );
  }

  const data = (await response.json()) as { IpfsHash?: string };
  return data.IpfsHash ? toIpfsUri(data.IpfsHash) : undefined;
}

async function fetchProfileFromIpfs(
  metadataUri: string,
): Promise<CreatorProfile | null> {
  const cid = parseIpfsCid(metadataUri);
  if (!cid) return null;

  const response = await fetch(
    `${resolveGatewayBase(DEFAULT_IPFS_GATEWAY)}${cid}`,
  );
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    pinataContent?: CreatorProfile;
  } & CreatorProfile;
  return payload.pinataContent ?? payload;
}

export async function saveCreatorProfile(
  address: string,
  data: CreatorProfileInput,
): Promise<CreatorProfile> {
  const localProfile = normalizeCreatorProfile(address, data);
  const metadataUri = await pinCreatorProfileToIpfs(localProfile);
  const profile = metadataUri
    ? { ...localProfile, metadataUri, updatedAt: new Date().toISOString() }
    : localProfile;

  const storage = safeLocalStorage();
  storage?.setItem(profileKey(address), JSON.stringify(profile));

  const index = readProfileIndex();
  index[address.toLowerCase()] = metadataUri ?? profileKey(address);
  writeProfileIndex(index);

  return profile;
}

export async function getCreatorProfile(
  address: string,
): Promise<CreatorProfile | null> {
  const storage = safeLocalStorage();
  const indexed = readProfileIndex()[address.toLowerCase()];

  if (indexed?.startsWith("ipfs://")) {
    const ipfsProfile = await fetchProfileFromIpfs(indexed).catch(() => null);
    if (ipfsProfile) return ipfsProfile;
  }

  const raw = storage?.getItem(profileKey(address));
  if (raw) {
    try {
      return JSON.parse(raw) as CreatorProfile;
    } catch {
      return null;
    }
  }

  const mock = mockProfiles[address];
  return mock ? normalizeCreatorProfile(address, mock) : null;
}

export async function getCreatorProfiles(
  addresses: string[],
): Promise<Record<string, CreatorProfile | null>> {
  const unique = Array.from(new Set(addresses.filter(Boolean)));
  const entries = await Promise.all(
    unique.map(
      async (address) => [address, await getCreatorProfile(address)] as const,
    ),
  );
  return Object.fromEntries(entries);
}
