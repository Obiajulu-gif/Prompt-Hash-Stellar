# Strict destination and content allow-lists (#1025, #1177)

User-supplied URLs, files, and content payloads that the server stores, renders,
or later contacts are checked against named **destination and content allow-list
policies**. Each policy explicitly lists what is permitted (schemes, ports,
hosts, file types, MIME types, byte bounds, and HTML tags/attributes). Anything
else is rejected with a stable error code before it is persisted or delivered.

Code: `server/src/services/allowListPolicy.ts` (destination, file-type, and
content policies), `server/src/routes/allowListRoutes.ts` (operator view,
dry-run evaluator, and audited runtime overrides). Delivery-time SSRF protection
(DNS pinning, per-hop redirect checks) in `server/src/services/ssrfGuard.ts`
also enforces `webhook_destination` on the initial URL and every redirect hop.

## Destination Policies

| Policy | Applied at | Schemes | Ports | Hosts | File types |
| --- | --- | --- | --- | --- | --- |
| `webhook_destination` | `POST /api/webhooks` & `ssrfGuard.postSignedWebhook` (every hop) | https | default, 8443 | public DNS names; `WEBHOOK_ALLOWED_HOSTS` if set | — |
| `listing_image` | listing metadata & bulk import validation | http, https | default | public DNS names; `IMAGE_ALLOWED_HOSTS` if set | png, jpg/jpeg, gif, webp, avif (when the path has an extension) |
| `report_evidence` | `POST /api/prompts/reports` evidence items | http, https | default | public DNS names; `EVIDENCE_ALLOWED_HOSTS` if set | must match the declared kind: `image` → image types, `pdf` → pdf, `text` → txt/md, `link` → not checked |
| `dispute_evidence` | ownership-transfer disputes & support case `evidenceUrls` | https | default | public DNS names; `DISPUTE_EVIDENCE_ALLOWED_HOSTS` if set | image, pdf, or text (when the path has an extension) |
| `external_reference` | bulk import `externalUrl` provenance links | https | default | public DNS names; `EXTERNAL_REFERENCE_ALLOWED_HOSTS` if set | — |

Every destination policy also refuses:

- embedded credentials (`https://user:pass@…`);
- **any IP literal**, including encoded forms the URL parser normalizes:
  decimal `2130706433`, hex `0x7f.0.0.1`, IPv6 `[::1]` and IPv4-mapped
  addresses. Public IPs are refused too: a destination must be a DNS name;
- single-label, internal, and cloud-metadata names: `localhost`, `*.localhost`,
  `*.local`, `*.internal`, `*.lan`, `*.home.arpa`, `*.intranet`, `*.corp`,
  `*.localdomain`, `metadata.google.internal`, `metadata.aws`,
  `metadata.azure`, `instance-data` (including trailing-dot FQDNs);
- URLs longer than 2048 characters.

Host allow-lists accept exact hosts and `*.example.com` wildcards. A wildcard
matches subdomains only, never `example.com` itself.

## Content & File-Type Allow-Lists

### Content policies (`checkContentAgainstPolicy` / `enforceContentAllowList`)

| Policy | Applied at | Allowed MIME types | Max bytes | Allowed HTML tags | Allowed link schemes |
| --- | --- | --- | ---: | --- | --- |
| `prompt_content` | listing metadata & bulk import prompt content | `text/plain`, `text/markdown` | 50,000 | safe markdown subset (`h1`–`h3`, `p`, `a`, `ul`, `ol`, `li`, `blockquote`, `code`, `pre`, `em`, `strong`, `hr`, `br`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `img`, `del`, `span`, `div`) | `https`, `http` |
| `evidence_note` | ownership-transfer dispute evidence notes | `text/plain` | 2,000 | none (all raw HTML tags rejected) | `https` |
| `webhook_payload` | outbound webhook payload verification | `application/json` (JSON object required) | 65,536 | none | `https` |
| `import_manifest` | catalog import manifests | `application/json`, `text/csv` | 524,288 | none | `https`, `http` |

Every content policy also refuses:

- empty or whitespace-only payloads (`content_empty`);
- payloads exceeding `maxBytes` in UTF-8 (`content_too_large`);
- binary control characters (`\u0000`–`\u0008`, `\u000b`, `\u000c`, `\u000e`–`\u001f`, `\u007f`) or the UTF-8 replacement character `\ufffd` (`content_encoding_invalid`);
- non-allow-listed HTML tags (`<script>`, `<iframe>`, `<svg>`, `<object>`, `<embed>`, `<style>`, `<form>`, `<meta>`, etc.) and event-handler or inline-style attributes (`onerror=`, `onload=`, `style=`, `srcdoc=`, `formaction=`) (`content_tag_not_allowed`);
- embedded executable or inline data URIs (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`), including numeric HTML entity obfuscations (`&#x6a;avascript:`) (`content_uri_not_allowed`);
- malformed JSON or non-object JSON when `requireJsonObject` is set (`content_structure_invalid`).

### File types (`checkFileType`)

`checkFileType({ kind, filename, contentType, bytes })` requires the
extension, the declared MIME type and (for binary kinds) the magic bytes to
agree. A renamed `.svg`, or an HTML page served as `image/png`, fails with
`file_type_mismatch`. SVG is never an allowed image type because it can carry
script.

## Error codes

Rejections return HTTP 400 with `{ error, code }`, where `code` is one of:

- Destination / URL: `url_invalid`, `url_too_long`, `scheme_not_allowed`,
  `credentials_not_allowed`, `port_not_allowed`, `ip_literal_not_allowed`,
  `host_not_allowed`
- File type: `file_type_not_allowed`, `file_type_mismatch`
- Content: `content_empty`, `content_too_large`, `content_type_not_allowed`,
  `content_encoding_invalid`, `content_tag_not_allowed`,
  `content_uri_not_allowed`, `content_structure_invalid`

Listing validation keeps its existing message for a non-http(s) image (`Image
URL must start with http:// or https://.`) and adds the allow-list message for
the new destination and content rejections.

## Normal, Failure, Retry, and Authorization Paths

- **Normal:** an allowed destination URL, file, or content payload is normalized
  and stored/delivered as before.
- **Failure:** a disallowed destination or content payload gets a 400 with a
  stable code and nothing is stored. At webhook delivery time, any destination
  or redirect hop that violates `webhook_destination` throws
  `UnsafeWebhookUrlError` and is immediately dead-lettered without retrying.
  Violations are logged as `allow-list violation` with the policy, code, and
  mode (raw URLs and content bodies are never logged).
- **Retry:** validation is deterministic. Repeating the same rejected request
  with the same `Idempotency-Key` replays the same 400. After fixing the URL or
  content, send it as a **new** request with a new key. Reusing the old key
  with a different body is refused with `409 IDEMPOTENCY_KEY_CONFLICT`
  ([idempotency.md](../idempotency.md)). If an operator tightens or relaxes a
  host allow-list via runtime override, a previously rejected destination or
  dead-lettered webhook can be retried cleanly.
- **Authorization:**
  - `GET /api/admin/allow-list` (effective policies, content rules, runtime
    overrides, and mode) and `POST /api/admin/allow-list/check` (dry-run a URL,
    file, or content payload) require the `allowlist:read` admin scope.
  - `PUT /api/admin/allow-list/override` and
    `DELETE /api/admin/allow-list/override` require the `allowlist:write` admin
    scope and a justification `reason`, recording an `admin_config_change`
    audit event with before/after state.

```http
POST /api/admin/allow-list/check
Authorization: Bearer <admin token with allowlist:read>

{ "policy": "webhook_destination", "url": "https://hooks.partner.io/x" }
```

```http
POST /api/admin/allow-list/check
Authorization: Bearer <admin token with allowlist:read>

{
  "content": {
    "policy": "prompt_content",
    "contentType": "text/markdown",
    "value": "# Launch checklist\n\nFollow the verified release steps."
  }
}
```

The dry run always reports what **enforce** mode would decide, whatever the
current mode.

## Edge Cases, Rollout, Rollback, and Migration

- **Instant rollback (`report` mode):**
  - Environment: `ALLOWLIST_MODE=enforce` (default) rejects violations;
    `ALLOWLIST_MODE=report` logs violations (`reportOnly: true`) and lets them
    through. Any other value fails closed (`enforce`).
  - Runtime API (no redeploy needed):
    `PUT /api/admin/allow-list/override` with `{ "mode": "report", "reason": "..." }`
    switches to report-only mode immediately; `DELETE /api/admin/allow-list/override`
    restores environment defaults.
- **Redirect-chain SSRF bypasses:** A public `https://` webhook URL that returns
  `302 Location: https://unapproved.partner.io/hook` or
  `302 Location: https://169.254.169.254/latest` is re-validated against
  `webhook_destination` on every redirect hop before opening a socket.
- **Trailing-dot FQDN & obfuscated URI edge cases:** Hostnames with a trailing
  DNS root dot (`hooks.partner.io.`, `localhost.`) are normalized before
  allow-list matching; numeric HTML entities (`&#x6a;avascript:`) and control
  bytes inside markdown/HTML content are decoded before scheme checks.
- **Legacy stored data & migration plan:** Data already stored is not rewritten.
  Existing webhook subscriptions that violate an updated `WEBHOOK_ALLOWED_HOSTS`
  policy are blocked at delivery time by `ssrfGuard` and moved to `dead_letter`
  so they cannot exfiltrate data. Operators can audit existing subscriptions by
  dry-running each URL through `POST /api/admin/allow-list/check`, updating the
  subscriber destination or host allow-list, and replaying dead-lettered events
  via `POST /api/webhooks/dead-letters/:id/replay`.
- **Contract compatibility:** Existing API request/response schemas and
  shared `@prompthash/schema` fixtures (including `http://example.com/img.png`
  for listing images and extensionless IPFS/CDN image paths) remain supported.
