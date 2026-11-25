# Cryptographic Provenance for Imported Records (#1206)

Status: implemented in `server/src/services/importProvenance.ts` and the secure
import pipeline (`server/src/services/promptImportPipeline.ts`).

## Why

`rowRef` and `importId` identify an imported record, but they do not prove it
was not edited afterwards. An operator with database access could rewrite a
row's title and keep its identifiers. Cryptographic provenance makes such an
edit detectable.

## What is signed

```text
record ──▶ SHA-256 digest ──▶ envelope (previousDigest ◀── prior record)
                                      │ HMAC-SHA256
                                      ▼
                       manifest (entry digests + head + subject)
                                      │ HMAC-SHA256
                                      ▼
                              ImportAttestation
```

- `record` is the **persisted** imported row (exactly what the store wrote),
  addressed by the pipeline's stable `rowRef`.
- `entries[i].recordDigest` = SHA-256 over canonical JSON of the record.
- `entries[i].previousDigest` links to the previous **record** digest, so
  reordering or removing an entry breaks the chain.
- `entries[i].digest` binds the envelope header (key id, rowRef, record
  digest, previous digest, issuedAt) and is HMAC-signed.
- `manifestDigest` covers the subject (`importId`), issuedAt, entry count,
  head and every entry digest; `signature` is HMAC over that manifest.
- Canonicalization sorts object keys and normalizes `Date`s, so logically
  identical records serialize identically regardless of key insertion order.

Only digests leave the module — raw record payloads and the signing secret are
never part of an attestation.

## Enabling it

| Variable | Required | Meaning |
| --- | --- | --- |
| `IMPORT_PROVENANCE_SIGNING_KEY` | yes (to sign) | HMAC secret, minimum 16 characters. A missing/short value disables signing; there is **no default key**. |
| `IMPORT_PROVENANCE_KEY_ID` | no | Key id pinned in every envelope. Default `import-v1`. |
| `IMPORT_PROVENANCE_SIGNING_KEY_PREVIOUS` | no | Previous key, accepted during rotation. |
| `IMPORT_PROVENANCE_KEY_ID_PREVIOUS` | no | Default `<keyId>-previous`. |

Signing is opt-in per commit:

```ts
const receipt = await commitPromptImport(store, rows, {
  previewId,
  now,
  provenance: { signer: { keyId, secret } },
});
receipt.attestation; // ImportAttestation
```

Without `provenance`, the receipt is byte-for-byte the previous contract — no
`attestation` field, same `receiptHash`. Existing consumers are unaffected.

## Verification endpoint

`POST /api/provenance/imports/verify` (admin scope `provenance:read`) verifies a
stored receipt without giving the reviewer the signing key:

```json
{
  "subject": "prev_…",
  "attestation": { "...": "ImportAttestation" },
  "records": [{ "rowRef": "row_…", "record": { "...": "persisted row" } }]
}
```

| Status | Meaning |
| --- | --- |
| `200` | Attestation verifies against the supplied records |
| `400` | Body is not a record list / attestation envelope |
| `401`/`403`/`503` | Missing or insufficient admin token; admin auth unconfigured |
| `422` | Well-formed but invalid (tampered, unknown key, chain break, …) |
| `503` | Import signing key not configured on the deployment |

The endpoint is read-only: it verifies caller-supplied evidence and touches no
database state. It fails closed when no key ring is configured. Admin auth
itself also fails closed when `ADMIN_TOKEN_SECRET` is absent.

## Verification reason codes

Global (`reasons`): `unsigned`, `unsupported_version`, `unsupported_algorithm`,
`unknown_key`, `subject_mismatch`, `attestation_signature_invalid`,
`manifest_digest_mismatch`, `entry_count_mismatch`, `head_mismatch`,
`duplicate_record_ref`.

Per entry (`entries[].reasons`): `chain_mismatch`, `entry_digest_mismatch`,
`entry_signature_invalid`, `record_digest_mismatch`, `missing_record`,
`unattested_record`, plus `unknown_key`/`unsigned` when no key is available.

## Normal, failure, retry and authorization paths

- **Normal.** Every accepted (non-quarantined) row is signed in import order.
  Quarantined rows are not attested because they were never imported.
- **Failure.** Any of: edited record content, edited envelope digest/signature,
  reordered or removed entry, extra unattested record, duplicate `rowRef`,
  wrong subject, unknown key id, or a signature made with a different secret
  yields `valid: false` with specific reason codes. Verification is
  all-or-nothing and fail-closed.
- **Retry.** Signing is deterministic for fixed inputs: same records, key,
  subject and `issuedAt` produce byte-identical envelopes and attestation.
  A retried `commitPromptImport` with the same `now`/`issuedAt` therefore
  reproduces the identical `attestation`, and idempotent store writes mean
  the signed payload is unchanged. An operator retry must reuse the receipt's
  `issuedAt` (the committedAt time) to reproduce the signature; otherwise the
  chain is still valid but the attestation differs by `issuedAt`.
- **Authorization.** Producing an attestation requires possession of the
  signing secret. Verification through the API requires an admin token with
  `provenance:read`; the signing secret is never exposed to reviewers.

## Edge cases

- **Empty batch.** Zero entries is valid; `head` is the empty string and the
  manifest binds `entryCount: 0`.
- **payloadRef-only rows.** The signed payload is the persisted row, so the
  attestation covers whatever the store wrote; `rowRef` remains the stable
  identifier.
- **Unsafe rows.** Rows quarantined as `unsafe_payload` are excluded; they
  never reached the store and cannot be attested as imported.
- **Metadata normalization.** Because the attestation signs the persisted
  representation, verification compares against a store export, not the
  caller's pre-normalization input.
- **Weak keys.** Secrets shorter than 16 characters are rejected at signing
  time and ignored by the key-ring loader.
- **Rotation.** Old attestations keep verifying while the previous key is
  configured; remove it only after every stored receipt has been re-verified
  or re-issued.
- **Tampered limit.** `entryCount`, `head` and the manifest are all covered by
  the manifest digest and signature, so counting tricks do not pass.

## Migration and rollback

- **Migration is additive.** No schema change and no change to unsigned
  receipts. Deploy the code, set the key env vars, and start signing new
  imports. Historical imports stay unsigned and verify as `unsigned` rather
  than falsely valid.
- **Rollback.** Unset the signing key to stop attesting new imports; existing
  attestations remain readable and verifiable as long as their key is in the
  key ring. No data migration is required.
- **Lost key.** Attestations signed with a lost key cannot be re-verified;
  they are reported as `unknown_key`. Preserve old keys for at least the audit
  retention window.
- **Compromised key.** Rotate: move the current secret to
  `IMPORT_PROVENANCE_SIGNING_KEY_PREVIOUS`, install a new
  `IMPORT_PROVENANCE_SIGNING_KEY`/`IMPORT_PROVENANCE_KEY_ID`, then re-issue
  attestations for imports signed with the compromised key. Old signatures
  still verify, which is evidence, not trust: treat the compromised window as
  suspect.

## Verification

```bash
cd server
npx vitest run src/tests/importProvenance.test.ts \
               src/tests/importProvenancePipeline.test.ts \
               src/tests/importAttestationRoute.test.ts
```
