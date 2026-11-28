# AI provider boundary

Status: implemented for #29. Code: `server/src/services/aiProvider.ts`,
`server/src/controllers/aiGatewayControllers.ts`, `server/src/controllers/controllers.ts`
(`PostChat`, `ImproveProxy`), `src/lib/api.ts`.

## Summary

- The **browser never contacts an AI provider.** It calls backend routes only.
- The provider URL and credential are **server environment values**, validated at
  startup. No provider URL is hard-coded in frontend or backend code.
- If the provider is **not configured, AI is disabled**. The UI shows an
  unavailable state. Nothing else on the site depends on AI.
- Every provider call has a **timeout** and a **bounded retry** policy. Failures
  return **structured errors**.
- **Prompt text is not logged.** Provider response bodies are not returned to
  clients or logged.

## Configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AI_PROVIDER_BASE_URL` | No | unset (disabled) | `https://` only. `http://` allowed for `localhost` outside production. No credentials or query string in the URL. |
| `AI_PROVIDER_API_KEY` | No | unset | Sent as `Authorization: Bearer`. At least 16 characters. Never logged or echoed. |
| `AI_PROVIDER_TIMEOUT_MS` | No | `10000` | Per attempt. Allowed range 500 to 60000. |
| `AI_PROVIDER_MAX_RETRIES` | No | `1` | Retries after the first attempt. Allowed range 0 to 3. |
| `PUBLIC_CHAT_API_BASE` | No | empty (same-origin) | **Frontend.** Origin of the backend that serves `/api/chat/gateway` and `/api/improve-proxy`. This is the backend, not the provider. |

**Startup behavior.** `AI_PROVIDER_BASE_URL` unset is a valid disabled state. A
set but invalid value fails startup with an actionable message. The validator
never prints the key.

Example (server `.env`):

```
AI_PROVIDER_BASE_URL=https://ai-provider.example.com
AI_PROVIDER_API_KEY=<credential from your secret store>
AI_PROVIDER_TIMEOUT_MS=10000
AI_PROVIDER_MAX_RETRIES=1
```

## Backend routes

| Route | Purpose | Provider call |
|---|---|---|
| `GET /api/chat/gateway?prompt=&model=` | Chat reply | `GET /api/chat` |
| `GET /api/chat/gateway/models` | Model list | `GET /api/models` |
| `GET /api/chat/gateway/health` | Feature status for the UI | `GET /api/health` (not called when disabled) |
| `POST /api/improve-proxy` | Prompt improvement (`text/plain` body) | `POST /api/improve-prompt` |
| `POST /api/chat` | OpenAI-backed streaming chat | Requires `OPENAI_API_KEY`; returns 503 when unset |

`GET /api/chat/gateway/health` returns `{"status":"ok"|"disabled"|"degraded"}`
and never reveals the provider URL.

## Failure behavior

Errors use one shape:

```json
{ "error": "AI_PROVIDER_TIMEOUT", "message": "AI provider did not respond within 10000 ms.", "retryable": true }
```

| Code | HTTP | Retried? | When |
|---|---|---|---|
| `AI_PROVIDER_NOT_CONFIGURED` | 503 | No | `AI_PROVIDER_BASE_URL` is unset |
| `AI_PROVIDER_TIMEOUT` | 504 | Yes, up to `AI_PROVIDER_MAX_RETRIES` | No response within the timeout |
| `AI_PROVIDER_UNAVAILABLE` | 503 | Yes | Network failure, 429, or 5xx after all retries |
| `AI_PROVIDER_REJECTED` | 502 | No | Provider returned another 4xx |
| `AI_PROVIDER_INVALID_RESPONSE` | 502 | No | Provider returned an empty body |

Retries use exponential backoff with equal jitter, capped at 2 seconds. Only
transient failures are retried. A 4xx is returned immediately, because it will
not succeed on retry.

On the frontend, a structured `AI_*` error becomes an `AiUnavailableError` with the
backend's message. Plain (non-AI) errors keep their existing handling. When
`improvePrompt` fails for any reason, the UI falls back to a local, deterministic
rewrite, as before.

## What prompt data is transmitted, and to whom

When AI features are enabled, the following data leaves the application:

- **Chat**: the user's message text and the selected model name, sent to the
  configured provider as part of the `GET /api/chat` request.
- **Prompt improvement**: the draft prompt text, sent as the body of
  `POST /api/improve-prompt`.
- **Chat (OpenAI route)**: the messages array of the conversation, sent to OpenAI
  when `OPENAI_API_KEY` is set.

Nothing else is sent. Wallet secrets, unlock keys, buyer identities, and
purchased prompt content are not part of these requests. Purchased content is
never sent to AI routes.

**Known constraint.** The current chat route passes the prompt in the query
string of a `GET` request, because that is the provider's existing contract. Query
strings are often written to provider and proxy access logs. Treat the provider's
log retention as part of the privacy surface. Moving the provider to a `POST` with a
body is the recommended follow-up.

## Logging rules

- Logs carry the action name, the error code, and the upstream status. They never
  carry prompt text, message bodies, provider response bodies, or the API key.
- Error messages from the boundary are fixed strings. A provider body that echoes
  the prompt cannot reach a client or a log line.
- Structured errors that reach the browser contain no provider details.

Covered by `server/src/tests/aiProvider.test.ts`, which asserts that a provider
error body containing the prompt does not appear in the thrown error.

## Operating it

- **Disable AI quickly**: unset `AI_PROVIDER_BASE_URL` and redeploy. The UI shows
  the unavailable state, and no provider calls are made.
- **Provider outage**: callers receive `AI_PROVIDER_UNAVAILABLE` or
  `AI_PROVIDER_TIMEOUT` within the configured bounds. Requests do not hang.
- **Check status**: `GET /api/chat/gateway/health`.
