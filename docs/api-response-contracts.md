# API Response Contracts

Prompt Hash contributor-facing APIs should expose a versioned response envelope when a route is added or materially changed.

The current contract version is `2026-09-29`. New code can use `successResponse`, `errorResponse`, and `validateApiResponseContract` from `server/src/services/apiResponseContract.ts`.

Success responses:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "contractVersion": "2026-09-29",
    "requestId": "optional-request-id"
  }
}
```

Error responses:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human-readable summary",
    "details": {}
  },
  "meta": {
    "contractVersion": "2026-09-29"
  }
}
```

Validation tests live in `server/src/tests/apiResponseContract.test.ts` so integrations can detect accidental contract drift before release.
