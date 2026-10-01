# Preview seed data

Use the preview seed script to create repeatable demo data for pull-request and Vercel preview deployments.

## Populate a preview environment

```bash
APP_ENV=preview ALLOW_PREVIEW_SEED=true MONGODB_URI=<preview-mongodb-uri> yarn seed:preview
```

The script upserts deterministic sample creators, public prompt metadata, categories, and purchase states. Encrypted prompt bodies are synthetic placeholders prefixed with `SYNTHETIC_ENCRYPTED_PAYLOAD_`; no real prompt content or secrets are stored.

## Idempotency

Run the command multiple times safely. Creators are matched by `walletAddress`, prompts by `onChainId`, and purchase states by `promptId` plus `buyerWallet`, so reruns update the same records instead of duplicating them.

## Production guardrail

The script refuses to run when `APP_ENV`, `VERCEL_ENV`, or `NODE_ENV` is `production`, `prod`, or `mainnet`. For non-production targets, set both `APP_ENV=preview` and `ALLOW_PREVIEW_SEED=true`.

## Reset preview seed data

To reset only seeded records in a preview database, run the following against that preview MongoDB URI:

```bash
mongosh "$MONGODB_URI" --eval 'db.prompts.deleteMany({tags:"preview-seed-v1"}); db.purchases.deleteMany({txHash:/^preview_tx_/}); db.users.deleteMany({walletAddress:/^gpreviewcreator/})'
```

After resetting, rerun `APP_ENV=preview ALLOW_PREVIEW_SEED=true MONGODB_URI=<preview-mongodb-uri> yarn seed:preview` to repopulate fresh demo data.
