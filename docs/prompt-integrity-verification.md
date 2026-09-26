# Purchased prompt integrity verification

## Commitment format (v1)

A published prompt carries a `content_hash` commitment: lowercase hexadecimal SHA-256 over the exact UTF-8 bytes of the prompt content. Prompt content is a scalar string rather than a JSON object, so UTF-8 encoding is its canonical serialization; listing metadata, counters, prices, and timestamps are deliberately excluded. The 32-byte digest is persisted with the Soroban prompt record and exposed as `contentHash` by the contract client.

`contentHashVersion: 1` and `contentHashAlgorithm: "SHA-256"` identify this format in successful unlock responses. Existing v1 listings remain compatible. Do not reinterpret `content_hash` as a ciphertext digest: ciphertext, IV, and key wrapping are encryption transport details, while the commitment authenticates the decrypted prompt content.

## Publish and unlock

At publish time, the creator client encrypts the exact prompt string with AES-256-GCM, wraps the generated AES key to the unlock public key, computes the v1 digest from the same plaintext, and submits encrypted payload fields and the digest to the contract. Mutable listing fields are not part of the digest.

Unlock verifies the buyer entitlement, fetches the contract-published ciphertext, decrypts it, and compares the recomputed SHA-256 digest with the on-chain commitment. The browser independently repeats that comparison before returning plaintext to the UI. Missing, malformed, unsupported, or mismatching commitments fail closed; the unlock API returns an integrity error rather than plaintext.

The purchase receipt UI displays a copyable commitment only when it has the expected 32-byte hex representation. Before unlock it identifies the on-chain commitment as awaiting verification; after a successful unlock it marks it verified against the decrypted content. Keep the prompt ID, transaction hash, and support correlation ID together for an incident report. Structured error logs retain the expected and computed digests; audit records retain the stable failure reason and correlation ID. Neither path records plaintext or encryption keys.

## Upgrade path

Do not silently change the v1 digest bytes. A future format must use an explicit version/algorithm discriminator, add a distinct on-chain commitment field or a versioned payload schema, keep v1 verification for existing listings, and update publish, contract reads, unlock server/client, receipt proof, and shared test vectors in one rollout. Any future hash over structured metadata must use a specified canonical serialization (stable key ordering, number representation, and UTF-8 encoding) and exclude mutable fields. A ciphertext-level commitment must be separate from `content_hash` and anchored on-chain before it can be treated as an authenticity proof.

## Validation for reviewers

- Review shared crypto vectors and the tampered plaintext/API unlock cases.
- Confirm publish uses the helper's `encryptedPrompt`, `encryptionIv`, `keyBytes`, and `contentHash` fields, and wraps the generated AES key.
- Confirm a successful unlock returns hash metadata and the browser checks it before exposing content.
- Confirm receipts flag malformed/missing commitment data and do not label that state as verified.
