export type UnlockKeyEntry = {
  version: string;
  publicKey: string;
  privateKey: string;
};

export function parseVersionedKeyStore(raw?: string) {
  const entries = new Map<string, string>();
  if (!raw) {
    return entries;
  }

  for (const item of raw.split(",").map((entry) => entry.trim())) {
    if (!item) {
      continue;
    }

    const [version, value] = item.split(/:(.+)/);
    if (!version || !value) {
      throw new Error(
        "Malformed versioned unlock key entry. Expected version:keyBase64 format.",
      );
    }

    if (entries.has(version)) {
      throw new Error(`Duplicate unlock key version configured: ${version}`);
    }

    entries.set(version, value);
  }

  return entries;
}

export function loadUnlockKeyStore(
  currentVersion: string,
  publicKey?: string,
  privateKey?: string,
  publicKeyStore?: string,
  privateKeyStore?: string,
) {
  const publicKeys = parseVersionedKeyStore(publicKeyStore);
  const privateKeys = parseVersionedKeyStore(privateKeyStore);

  if (publicKeys.size === 0 && publicKey) {
    publicKeys.set(currentVersion, publicKey);
  }

  if (privateKeys.size === 0 && privateKey) {
    privateKeys.set(currentVersion, privateKey);
  }

  if (publicKeys.size === 0 || privateKeys.size === 0) {
    throw new Error(
      "Unlock key store is not configured. Set UNLOCK_PRIVATE_KEYS and UNLOCK_PUBLIC_KEYS or UNLOCK_PRIVATE_KEY/UNLOCK_PUBLIC_KEY.",
    );
  }

  const keySet = new Map<string, UnlockKeyEntry>();
  const versions = new Set<string>([
    ...Array.from(publicKeys.keys()),
    ...Array.from(privateKeys.keys()),
  ]);

  for (const version of versions) {
    const publicKeyValue = publicKeys.get(version);
    const privateKeyValue = privateKeys.get(version);

    if (!publicKeyValue || !privateKeyValue) {
      throw new Error(
        `Unlock key version ${version} does not have both public and private values configured.`,
      );
    }

    keySet.set(version, {
      version,
      publicKey: publicKeyValue,
      privateKey: privateKeyValue,
    });
  }

  if (!keySet.has(currentVersion)) {
    throw new Error(
      `Current unlock key version ${currentVersion} is not configured. Verify UNLOCK_KEY_VERSION and your versioned key store values.`,
    );
  }

  return keySet;
}
