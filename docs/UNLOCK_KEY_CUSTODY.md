# Unlock key custody, versioning, rotation and recovery

Status: implemented for #27. Code: `server/src/services/unlockKeyring.ts`,
`src/lib/crypto/wrappedKeyFormat.ts`, `api/prompts/unlock.ts`.

## What the keys do

The unlock service opens the content key that protects each purchased prompt.
Each prompt's `wrappedKey` is the AES content key sealed to an **unlock public
key** (libsodium `crypto_box_seal`). The unlock handler opens it with the
matching **unlock private key** after verifying the buyer's entitlement.

Two backend secrets matter here:

| Secret | Purpose | Compromise impact |
|---|---|---|
| Unlock private key(s) | Opens wrapped content keys | Anyone holding ciphertext plus this key can read the prompt |
| `CHALLENGE_TOKEN_SECRET` | Signs unlock challenge tokens | Forged challenges; rotation is covered by `docs/secret-rotation.md` |

The unlock **public** key is not secret. It is embedded in the publish flow
(`PUBLIC_UNLOCK_PUBLIC_KEY`) so creators can seal content keys.

## Custody

**Generation.** Generate unlock keypairs on an operator workstation, never in
CI and never in a shared chat or ticket. Use libsodium:

```bash
node -e "const s=require('libsodium-wrappers');s.ready.then(()=>{const k=s.crypto_box_keypair();const b=s.base64_variants.ORIGINAL;console.log('publicKey='+s.to_base64(k.publicKey,b));console.log('privateKey='+s.to_base64(k.privateKey,b));})"
```

**Storage.** In production, private keys live only in the approved secret store
for the deployment platform (for example, the platform's encrypted secret
manager or a cloud KMS-backed secret). They are loaded as environment values
at deploy time. They must not appear in source, in `.env` files committed to git,
in container images, in logs, or in error messages.

**Access.** Only the deployment role reads production unlock secrets. Developers
do not. Changes to the key ring are made through the secret store, with its audit
log, and reviewed like a schema migration.

**Local development.** Use the single-key mode with a keypair you generated for
local use (above). Never copy production keys to a developer machine. Values
from `.env.example` are placeholders; the validator rejects them, so local runs
need real generated values.

## Configuration

Two modes. Both are checked at startup and on every unlock request.

**Single key (default, backward compatible)**

```
UNLOCK_PUBLIC_KEY=<base64>
UNLOCK_PRIVATE_KEY=<base64>
UNLOCK_ACTIVE_KEY_ID=unlock-v1   # optional; defaults to "unlock-v1"
```

**Key ring (use for rotation)**

```
UNLOCK_KEYS_JSON=[
  {"keyId":"unlock-2026-11","publicKey":"<base64>","privateKey":"<base64>","status":"active"},
  {"keyId":"unlock-2026-01","publicKey":"<base64>","privateKey":"<base64>","status":"retired"}
]
UNLOCK_ACTIVE_KEY_ID=unlock-2026-11   # optional; must match the active entry
UNLOCK_LEGACY_KEY_ID=unlock-2026-01   # see "Legacy payloads" below
```

Validation rules (startup fails closed with a list of problems that names
variables and key ids, never key values):

- Exactly one entry has `status: "active"`. It is used for new wraps.
- `status: "retired"` entries are **decrypt-only**. They open existing purchases.
- Key ids are 1 to 64 characters of letters, digits, `.`, `_` or `-`, and unique.
- Each version has its own key material. Reusing a key under a new id is rejected,
  because that would make a "rotation" a relabel that protects nothing.
- Placeholders and non-base64 values are rejected.

## Key versioning in encrypted payloads

New wrapped keys carry their version:

```
unlock-key:v1:<keyId>:<base64 sealed box>
```

The version travels with the ciphertext, so the unlock path always selects the
right private key, including during and after rotation, without a separate
table that could drift from the data.

Lookup outcomes on unlock:

| Condition | Result |
|---|---|
| Version present and configured (active or retired) | Opened with that key |
| Untagged (legacy) | Opened with `UNLOCK_LEGACY_KEY_ID` (default: the active key) |
| Tag present but malformed | 500 `CONFIGURATION_ERROR`, logged with code only |
| Version not in the ring | 500 `CONFIGURATION_ERROR`, logged with the version id |
| Ring itself invalid | Startup fails; requests return 500 `CONFIGURATION_ERROR` |

Logs record the key **version id** and error code. They never record key
material, challenge tokens, plaintext prompts or decrypted content.

## Legacy payloads and migration

Prompts published before this change have untagged `wrappedKey` values. They
resolve to `UNLOCK_LEGACY_KEY_ID`.

Consequences:

- **Set `UNLOCK_LEGACY_KEY_ID` before any rotation.** It must name the key that
  sealed existing prompts. If it defaults to a new active key after rotation,
  legacy purchases fail to open. This is the most likely rotation mistake, so
  the runbook makes it step 1.
- **Existing on-chain prompts stay bound to their legacy key.** `wrappedKey` is
  stored on-chain. Re-wrapping it would require a contract data update, which this
  change does not perform. Legacy keys are therefore retained decrypt-only for as
  long as legacy prompts exist.
- **Only new publishes are tagged.** Publish tooling passes the active key id:
  `encryptAndWrapPromptPayload(plaintext, activePublicKey, { unlockKeyId })`.

## Retention of retired keys

Retired keys are kept as long as any stored prompt, or any purchase still in
dispute, references their version. The system does not delete keys automatically.

To retire a key permanently:

1. Confirm no prompt references the version (see the query under "Rotation").
2. Confirm no open dispute or unlock investigation references it.
3. Remove the entry from `UNLOCK_KEYS_JSON` in a reviewed change, and record the
   removal in the release notes.

Deleting a retired key that is still referenced makes those purchases
unrecoverable. That is the failure this design exists to prevent.

## Rotation

### Normal (scheduled) rotation

1. **Set the legacy pointer.** Set `UNLOCK_LEGACY_KEY_ID` to the current active
   key id, if it is not already set explicitly.
2. **Generate** a new keypair on an operator workstation (command above).
3. **Stage the ring.** Add the new entry as `active` and change the previous
   active entry to `retired`. Do not remove any entry. Set
   `UNLOCK_ACTIVE_KEY_ID` to the new id.
4. **Deploy** the ring change to staging. Verify:
   - an existing legacy purchase still unlocks;
   - a purchase tagged with the retired version still unlocks;
   - a test publish produces a `unlock-key:v1:<new id>:` wrapped key and that
     it unlocks.
5. **Deploy to production.** Watch `UNLOCK_KEY_UNKNOWN_VERSION` and
   `UNLOCK_KEY_MALFORMED_VERSION` in logs, and the unlock failure metrics, for at
   least one business day.
6. **Record** the rotation in the key register: key id, activation time, operator.

### Emergency rotation (suspected compromise of an unlock private key)

Compromise changes the risk profile. A stolen private key can open every prompt
sealed to it, and ciphertext already public or copied stays exposed. Rotation
limits future exposure. It does not undo past exposure.

1. **Declare an incident** and follow `docs/INCIDENT_RUNBOOK.md`. Assign an owner.
2. **Stop new exposure.** Generate and activate a new key (normal steps 2 to 3),
   skipping the staging soak only if the incident requires it. Publishing uses the
   new key immediately.
3. **Quarantine the compromised version.** Remove it from `UNLOCK_KEYS_JSON`
   once legacy and other still-needed purchases are confirmed on the new ring.
   Requests for prompts sealed to it then fail closed with
   `UNLOCK_KEY_UNKNOWN_VERSION`. Accept that affected buyers cannot unlock until
   the content is re-sealed. Document that trade-off in the incident record.
4. **Assess exposure.** List prompts referencing the compromised version
   (query below). For each, decide with the security owner whether content must
   be re-encrypted. Re-encryption requires a content update and, for on-chain
   payloads, a contract data change. Track it as its own work item.
5. **Rotate the challenge secret** too if the compromise touched the unlock
   service host (`docs/secret-rotation.md`).
6. **Communicate** to affected creators and buyers per the incident runbook.

### Rollback

The key ring is additive, so rollback is a configuration revert:

- Keep the previous `UNLOCK_KEYS_JSON` value as a numbered version in the secret
  store.
- To roll back a rotation, restore the previous ring. Its active key becomes
  active again. Keys added during the failed rotation remain in the store, but are
  unused.
- Never roll back by deleting a retired key. Deleting a key that prompts still
  reference is the one irreversible step.
- After rollback, prompts published under the newer key still open, because that
  key stays in the ring as long as it is referenced. Keep it in `UNLOCK_KEYS_JSON`
  until the rollback is verified.

## Finding prompts that reference a key version

Use the prompt store with a query for the `wrappedKey` prefix:

```
wrappedKey starts with "unlock-key:v1:<keyId>:"   -> versioned, referenced by keyId
wrappedKey does not start with "unlock-key:v1:"  -> legacy, resolves to UNLOCK_LEGACY_KEY_ID
```

Keep the count and a sample of identifiers in the rotation record. Do not paste
`wrappedKey` values into tickets.

## Failure behavior summary

- Missing or invalid production secrets fail startup with actionable messages.
- A version the ring does not contain fails that request with a configuration
  error. It never falls back to another key. A silent fallback could open a prompt
  with the wrong key or mask a misconfiguration.
- Nothing logs key material.

## Related

- `docs/secret-rotation.md`: challenge token rotation.
- `docs/INCIDENT_RUNBOOK.md`: incident process.
- `docs/environments.md`: environment variable reference.
