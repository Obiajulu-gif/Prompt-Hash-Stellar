# API Reference: Unlock Service

The Unlock Service is a gated delivery system that provides plaintext prompt content (or unwrapped encryption keys) only to users who have a verifiable purchase on the Stellar blockchain.

## Authentication: Challenge-Response Protocol

The service uses a cryptographic challenge-response flow to verify wallet ownership without requiring persistent sessions or passwords.

### 1. Request Challenge
**Endpoint:** `POST /api/unlock/challenge`

Generates a short-lived challenge token that the user must sign with their Stellar wallet.

**Request Body:**
```json
{
  "address": "G...",
  "promptId": "123"
}
```

**Response (200 OK):**
```json
{
  "token": "base64payload.serverSignature",
  "challenge": "prompt-hash unlock:G...:123:uuid:timestamp",
  "expiresAt": 1714230000000
}
```

### 2. Verify and Unlock
**Endpoint:** `POST /api/unlock/verify`

Verifies the wallet signature and the challenge token. If the wallet has purchased the prompt (verified on-chain), it returns the decrypted content.

**Request Body:**
```json
{
  "token": "base64payload.serverSignature",
  "address": "G...",
  "promptId": "123",
  "signature": "base64_or_hex_signature"
}
```

**Response (200 OK):**
```json
{
  "decryptedContent": "Act as a senior engineer...",
  "contentHash": "..."
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid signature or malformed token.
- `403 Forbidden`: Wallet does not have access (no purchase recorded on-chain).
- `410 Gone`: Challenge token has expired.

---

## Client-Side Encryption Protocol

To ensure privacy, prompt content is encrypted before it ever reaches the blockchain.

### 1. Encryption (Creator Side)
1. Generate a random 256-bit AES key.
2. Encrypt the prompt content using **AES-256-GCM**.
3. Generate a content hash (SHA-256) of the plaintext.
4. Wrap the AES key using the Unlock Service's public key (RSA-OAEP or ECIES).
5. Submit the encrypted payload, wrapped key, and metadata to the Soroban contract.

### 2. Decryption (Unlock Service Side)
1. Verify the buyer's entitlement on the Soroban contract.
2. Unwrap the AES key using the service's private key.
3. Decrypt the ciphertext.
4. Verify the integrity of the plaintext against the stored content hash.
5. Return the plaintext to the authorized buyer.

## Implementation Details

- **AES-GCM**: Used for symmetric encryption of the prompt body.
- **Key Wrapping**: Prevents the server from reading content unless requested by an authorized buyer (assuming the server follows the protocol).
- **On-Chain Verification**: The service calls the `has_access` method on the `PromptHash` Soroban contract.
