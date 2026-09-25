# External Integration API Keys

External marketplace clients authenticate with the `X-API-Key` header. Keys are
scoped to the wallet that created them:

- `listings:read` allows `GET /api/integrations/listings`.
- `purchases:read` allows `GET /api/integrations/purchases`.
- `creator:manage` allows `GET /api/integrations/creator/analytics`.

## Lifecycle

API keys are managed with the wallet owner header used by the existing server:

- `POST /api/integrations/keys` with `{ "name": "Marketplace", "scopes": ["listings:read"] }`
- `GET /api/integrations/keys`
- `POST /api/integrations/keys/:keyId/rotate`
- `POST /api/integrations/keys/:keyId/revoke`

Management requests require `X-Wallet-Address` and an existing user account.
The full secret is returned only by create and rotate responses. The database
stores only a SHA-256 digest, while key listings expose the prefix, scopes,
revocation state, last-use metadata, and usage count. Revocation is checked on
every protected request, and management endpoints are rate limited.