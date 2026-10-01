# Safe Import Dry Run

`server/src/services/importDryRun.ts` provides a write-free import planner for bulk prompt imports.

The planner validates required row fields, reports duplicate rows inside the import file, compares rows against existing prompts by `externalId` and `contentHash`, and returns a deterministic report:

```json
{
  "dryRun": true,
  "valid": false,
  "summary": {
    "totalRows": 2,
    "creates": 1,
    "updates": 0,
    "skips": 0,
    "errors": 1,
    "conflicts": 1
  },
  "rows": []
}
```

The dry run never writes to MongoDB. A production import endpoint should require a clean dry-run report before allowing a commit path.
