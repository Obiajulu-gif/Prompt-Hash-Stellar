# External identity linking

Prompt Hash exposes wallet-authenticated identity management at
`/api/external-identities`.

1. Establish a wallet session through `/api/wallet-session`.
2. `POST /api/external-identities/challenge` with `{ walletAddress, provider, subject }`.
3. Sign the returned `challenge` with the same wallet and `POST /api/external-identities` with
   `{ walletAddress, provider, subject, token, signedMessage }`.
4. List active links with `GET /api/external-identities` and the
   `x-wallet-address` header.
5. Unlink deliberately with `DELETE /api/external-identities/:provider/:subject`, the
   `x-wallet-address` header, and `{ "confirm": true }`.

Provider names are normalized to lowercase. A provider subject can have only one
active wallet link, and a wallet can have only one active link per provider.
Unlinking marks the record inactive instead of deleting it, so relinking is
possible without losing history. Link and unlink successes and blocked attempts
are written to the tamper-evident audit trail as `identity_link` and
`identity_unlink` events. Raw signatures and challenge tokens are never stored.

The wallet signature proves control of the linking wallet and binds the request
to the normalized provider subject. Provider-specific attestations can be added
behind the same verification-method field without changing the link policy.
