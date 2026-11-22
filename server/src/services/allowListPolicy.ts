/**
 * Strict allow-list validation for URLs, file types, content, and destinations (#1025, #1177).
 *
 * Every user-supplied URL, file, or structured content payload the server
 * stores, renders, or later contacts is checked against a named policy that
 * lists what IS allowed (schemes, ports, hosts, file types, content kinds,
 * MIME types, encodings, and HTML tags/attributes) instead of trying to
 * enumerate what is dangerous:
 *
 *   webhook_destination — outbound webhook targets: https only, default/8443
 *                         port, public DNS names only (no IP literals, no
 *                         localhost / .local / .internal names), optional
 *                         operator host allow-list (WEBHOOK_ALLOWED_HOSTS).
 *   listing_image       — prompt cover images: http(s), no IP literals, and
 *                         when the path names a file it must be a raster image
 *                         type (SVG is refused: it can carry script).
 *   report_evidence     — moderation evidence links: http(s), no IP literals,
 *                         and the file type must match the declared kind.
 *   dispute_evidence    — ownership-transfer and support dispute evidence:
 *                         https only, public DNS names only, optional
 *                         DISPUTE_EVIDENCE_ALLOWED_HOSTS, and any named file
 *                         extension must be an image, pdf, or text document.
 *   external_reference  — provenance/import external catalog links: https only,
 *                         public DNS names only, optional EXTERNAL_REFERENCE_ALLOWED_HOSTS.
 *
 * Content allow-list policies (`CONTENT_ALLOW_LIST_POLICIES`):
 *   prompt_content      — plain text or sanitized markdown within size/encoding
 *                         bounds; no script/iframe/object/svg/event-handler HTML,
 *                         no embedded data:/javascript: URIs, no binary control bytes.
 *   evidence_note       — plain text evidence descriptions within size bounds,
 *                         rejecting raw HTML tags and script/protocol payloads.
 *   webhook_payload     — JSON object payloads within byte/depth/entry bounds
 *                         and free of null/control-character smuggling.
 *   import_manifest     — JSON or CSV catalog import content within size bounds.
 *
 * Runtime operator overrides (`setRuntimeAllowListOverride` / `clearRuntimeAllowListOverride`)
 * are layered on top of environment defaults and guarded by `allowlist:write`
 * on the admin routes so operators can tighten or roll back destination hosts
 * and enforcement mode without a redeploy.
 *
 * Delivery-time SSRF protection (DNS pinning, redirect re-validation) stays in
 * ssrfGuard.ts; this module rejects bad destinations at the door AND before
 * each outbound delivery hop so neither newly submitted nor legacy/redirected
 * destinations can bypass the policy.
 *
 * `ALLOWLIST_MODE=report` turns enforcement into logging only — the rollback
 * lever if a policy turns out to reject legitimate traffic. See
 * docs/operations/allow-list-validation.md.
 */

import * as net from "net";
import { isDisallowedAddress } from "./ssrfGuard";
import { logger } from "./structuredLogger";

export type AllowListPolicyName =
  | "webhook_destination"
  | "listing_image"
  | "report_evidence"
  | "dispute_evidence"
  | "external_reference";
export type ContentPolicyName =
  | "prompt_content"
  | "evidence_note"
  | "webhook_payload"
  | "import_manifest";
export type AllowListMode = "enforce" | "report";

export type AllowListViolationCode =
  | "url_invalid"
  | "url_too_long"
  | "scheme_not_allowed"
  | "credentials_not_allowed"
  | "port_not_allowed"
  | "ip_literal_not_allowed"
  | "host_not_allowed"
  | "file_type_not_allowed"
  | "file_type_mismatch"
  | "content_empty"
  | "content_too_large"
  | "content_type_not_allowed"
  | "content_encoding_invalid"
  | "content_tag_not_allowed"
  | "content_uri_not_allowed"
  | "content_structure_invalid";

export type FileKind = "image" | "pdf" | "json" | "csv" | "text";

export interface FileTypeRule {
  extensions: readonly string[];
  mimeTypes: readonly string[];
  /** Leading-byte signatures; any one match is enough. Empty = text format. */
  magic: readonly (readonly number[])[];
}

export const FILE_TYPE_ALLOW_LIST: Record<FileKind, FileTypeRule> = {
  image: {
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"],
    mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"],
    magic: [
      [0x89, 0x50, 0x4e, 0x47], // PNG
      [0xff, 0xd8, 0xff], // JPEG
      [0x47, 0x49, 0x46, 0x38], // GIF8
      [0x52, 0x49, 0x46, 0x46], // RIFF (WebP container)
      [0x00, 0x00, 0x00], // ISO-BMFF box (AVIF) — size prefix, checked with ftyp below
    ],
  },
  pdf: { extensions: ["pdf"], mimeTypes: ["application/pdf"], magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]] },
  json: { extensions: ["json"], mimeTypes: ["application/json"], magic: [] },
  csv: { extensions: ["csv"], mimeTypes: ["text/csv"], magic: [] },
  text: { extensions: ["txt", "md"], mimeTypes: ["text/plain", "text/markdown"], magic: [] },
};

interface UrlPolicy {
  schemes: readonly string[];
  /** Explicit ports allowed in addition to the scheme default. */
  ports: readonly number[];
  allowIpLiterals: false;
  /** File kinds a path extension may name; `null` = extension not checked. */
  fileKinds: readonly FileKind[] | null;
  /** Env var holding an optional comma-separated host allow-list. */
  hostAllowListEnv: string;
}

const MAX_URL_LENGTH = 2048;

export const ALLOW_LIST_POLICIES: Record<AllowListPolicyName, UrlPolicy> = {
  webhook_destination: {
    schemes: ["https:"],
    ports: [8443],
    allowIpLiterals: false,
    fileKinds: null,
    hostAllowListEnv: "WEBHOOK_ALLOWED_HOSTS",
  },
  listing_image: {
    schemes: ["https:", "http:"],
    ports: [],
    allowIpLiterals: false,
    fileKinds: ["image"],
    hostAllowListEnv: "IMAGE_ALLOWED_HOSTS",
  },
  report_evidence: {
    schemes: ["https:", "http:"],
    ports: [],
    allowIpLiterals: false,
    fileKinds: ["image", "pdf", "text"],
    hostAllowListEnv: "EVIDENCE_ALLOWED_HOSTS",
  },
  dispute_evidence: {
    schemes: ["https:"],
    ports: [],
    allowIpLiterals: false,
    fileKinds: ["image", "pdf", "text"],
    hostAllowListEnv: "DISPUTE_EVIDENCE_ALLOWED_HOSTS",
  },
  external_reference: {
    schemes: ["https:"],
    ports: [],
    allowIpLiterals: false,
    fileKinds: null,
    hostAllowListEnv: "EXTERNAL_REFERENCE_ALLOWED_HOSTS",
  },
};

export interface ContentPolicyRule {
  mimeTypes: readonly string[];
  maxBytes: number;
  allowHtmlTags: readonly string[];
  allowedLinkSchemes: readonly string[];
  requireJsonObject?: boolean;
}

export const ALLOWED_CONTENT_HTML_TAGS = [
  "h1",
  "h2",
  "h3",
  "p",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "em",
  "strong",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "del",
  "span",
  "div",
] as const;

export const CONTENT_ALLOW_LIST_POLICIES: Record<ContentPolicyName, ContentPolicyRule> = {
  prompt_content: {
    mimeTypes: ["text/plain", "text/markdown"],
    maxBytes: 50_000,
    allowHtmlTags: ALLOWED_CONTENT_HTML_TAGS,
    allowedLinkSchemes: ["https:", "http:"],
  },
  evidence_note: {
    mimeTypes: ["text/plain"],
    maxBytes: 2_000,
    allowHtmlTags: [],
    allowedLinkSchemes: ["https:"],
  },
  webhook_payload: {
    mimeTypes: ["application/json"],
    maxBytes: 65_536,
    allowHtmlTags: [],
    allowedLinkSchemes: ["https:"],
    requireJsonObject: true,
  },
  import_manifest: {
    mimeTypes: ["application/json", "text/csv"],
    maxBytes: 524_288,
    allowHtmlTags: [],
    allowedLinkSchemes: ["https:", "http:"],
  },
};

/** Names that only ever resolve inside a private network or cloud metadata service. */
const INTERNAL_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".intranet",
  ".corp",
  ".localdomain",
];

const DISALLOWED_EXACT_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.aws",
  "metadata.azure",
  "instance-data",
]);

/**
 * Runtime operator overrides layered on top of environment defaults (#1177).
 * Allows emergency destination allow-list tightening or rollback to `report`
 * mode via audited admin API without redeploying.
 */
interface RuntimeAllowListOverrideState {
  mode: AllowListMode | null;
  hostAllowLists: Partial<Record<AllowListPolicyName, string[]>>;
  updatedAt: string | null;
  updatedBy: string | null;
  reason: string | null;
}

const runtimeOverrideState: RuntimeAllowListOverrideState = {
  mode: null,
  hostAllowLists: {},
  updatedAt: null,
  updatedBy: null,
  reason: null,
};

export interface AllowListDecision {
  allowed: boolean;
  /** True when a violation was found but `report` mode let it through. */
  reportOnly: boolean;
  code?: AllowListViolationCode;
  message?: string;
  normalizedUrl?: string;
}

export function getAllowListMode(): AllowListMode {
  if (runtimeOverrideState.mode) return runtimeOverrideState.mode;
  return process.env.ALLOWLIST_MODE === "report" ? "report" : "enforce";
}

/** Parse an operator host allow-list: exact hosts or `*.example.com` wildcards. */
export function parseHostAllowList(raw: string | readonly string[] | undefined): string[] {
  const items = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return items
    .map((entry) => String(entry).trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
}

export function getEffectiveHostAllowList(policyName: AllowListPolicyName): string[] {
  const runtimeHosts = runtimeOverrideState.hostAllowLists[policyName];
  if (runtimeHosts !== undefined) return [...runtimeHosts];
  const policy = ALLOW_LIST_POLICIES[policyName];
  return parseHostAllowList(process.env[policy.hostAllowListEnv]);
}

export function setRuntimeAllowListOverride(input: {
  mode?: AllowListMode | null;
  hostAllowLists?: Partial<Record<AllowListPolicyName, string[] | string | null>>;
  actor?: string;
  reason?: string;
}): RuntimeAllowListOverrideState {
  if (input.mode !== undefined) {
    if (input.mode !== null && input.mode !== "enforce" && input.mode !== "report") {
      throw new Error("mode must be 'enforce', 'report', or null.");
    }
    runtimeOverrideState.mode = input.mode;
  }
  if (input.hostAllowLists) {
    for (const [key, raw] of Object.entries(input.hostAllowLists)) {
      if (!(key in ALLOW_LIST_POLICIES)) {
        throw new Error(`Unknown allow-list policy: ${key}`);
      }
      const policyKey = key as AllowListPolicyName;
      if (raw === null) {
        delete runtimeOverrideState.hostAllowLists[policyKey];
      } else {
        runtimeOverrideState.hostAllowLists[policyKey] = parseHostAllowList(raw);
      }
    }
  }
  runtimeOverrideState.updatedAt = new Date().toISOString();
  runtimeOverrideState.updatedBy = input.actor ?? null;
  runtimeOverrideState.reason = input.reason ?? null;
  return getRuntimeAllowListOverride();
}

export function clearRuntimeAllowListOverride(actor?: string, reason?: string): RuntimeAllowListOverrideState {
  runtimeOverrideState.mode = null;
  runtimeOverrideState.hostAllowLists = {};
  runtimeOverrideState.updatedAt = actor || reason ? new Date().toISOString() : null;
  runtimeOverrideState.updatedBy = actor ?? null;
  runtimeOverrideState.reason = reason ?? null;
  return getRuntimeAllowListOverride();
}

export function getRuntimeAllowListOverride(): RuntimeAllowListOverrideState {
  return {
    mode: runtimeOverrideState.mode,
    hostAllowLists: Object.fromEntries(
      Object.entries(runtimeOverrideState.hostAllowLists).map(([k, v]) => [k, [...(v ?? [])]]),
    ) as Partial<Record<AllowListPolicyName, string[]>>,
    updatedAt: runtimeOverrideState.updatedAt,
    updatedBy: runtimeOverrideState.updatedBy,
    reason: runtimeOverrideState.reason,
  };
}

export function hostMatchesAllowList(hostname: string, allowList: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  // `*.example.com` matches subdomains only, never `example.com` itself.
  return allowList.some((entry) => {
    const normalized = entry.toLowerCase().replace(/\.$/, "");
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1); // ".example.com"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === normalized;
  });
}

function extensionOf(pathname: string): string | null {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* malformed escape — inspect the raw path */
  }
  const last = decoded.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 && dot < last.length - 1 ? last.slice(dot + 1).toLowerCase() : null;
}

function kindForExtension(extension: string): FileKind | null {
  for (const [kind, rule] of Object.entries(FILE_TYPE_ALLOW_LIST) as [FileKind, FileTypeRule][]) {
    if (rule.extensions.includes(extension)) return kind;
  }
  return null;
}

function violation(code: AllowListViolationCode, message: string): AllowListDecision {
  return { allowed: false, reportOnly: false, code, message };
}

/** Pure policy check — no mode handling, no logging. */
export function checkUrlAgainstPolicy(
  rawUrl: unknown,
  policyName: AllowListPolicyName,
  options: { expectedKind?: FileKind; hostAllowList?: readonly string[]; skipFileType?: boolean } = {},
): AllowListDecision {
  const policy = ALLOW_LIST_POLICIES[policyName];
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return violation("url_invalid", "URL is required.");
  const trimmed = rawUrl.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    return violation("url_too_long", `URL must be ${MAX_URL_LENGTH} characters or fewer.`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return violation("url_invalid", "Not a valid absolute URL.");
  }

  if (!policy.schemes.includes(url.protocol)) {
    return violation(
      "scheme_not_allowed",
      `Only ${policy.schemes.map((s) => s.replace(":", "")).join(", ")} URLs are allowed.`,
    );
  }
  if (url.username || url.password) {
    return violation("credentials_not_allowed", "URLs may not embed credentials.");
  }
  if (url.port && !policy.ports.includes(Number(url.port))) {
    return violation("port_not_allowed", `Port ${url.port} is not allowed.`);
  }

  // WHATWG URL keeps brackets around IPv6 hosts and normalizes numeric IPv4
  // forms (e.g. 2130706433, 0x7f.1) to dotted quads, so net.isIP catches all.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (net.isIP(host)) {
    return violation(
      "ip_literal_not_allowed",
      isDisallowedAddress(host)
        ? "URLs may not point at private or internal addresses."
        : "URLs must use a DNS host name, not an IP address.",
    );
  }
  if (
    !host.includes(".") ||
    DISALLOWED_EXACT_HOSTS.has(host) ||
    INTERNAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return violation("host_not_allowed", "URL host must be a public DNS name.");
  }

  const hostAllowList = options.hostAllowList ?? getEffectiveHostAllowList(policyName);
  if (hostAllowList.length > 0 && !hostMatchesAllowList(host, hostAllowList)) {
    return violation("host_not_allowed", "URL host is not on the allow-list.");
  }

  if (policy.fileKinds && !options.skipFileType) {
    const extension = extensionOf(url.pathname);
    if (extension) {
      const kind = kindForExtension(extension);
      if (!kind || !policy.fileKinds.includes(kind)) {
        return violation("file_type_not_allowed", `.${extension} files are not allowed here.`);
      }
      if (options.expectedKind && kind !== options.expectedKind) {
        return violation("file_type_mismatch", `.${extension} is not a ${options.expectedKind} file.`);
      }
    }
  }

  return { allowed: true, reportOnly: false, normalizedUrl: url.toString() };
}

/**
 * Policy check plus enforcement mode. In `report` mode a violation is logged
 * and the request is let through (`reportOnly: true`), so operators can see
 * what a policy change would reject before enforcing it.
 */
export function enforceUrlAllowList(
  rawUrl: unknown,
  policyName: AllowListPolicyName,
  options: { expectedKind?: FileKind; skipFileType?: boolean; context?: string } = {},
): AllowListDecision {
  const decision = checkUrlAgainstPolicy(rawUrl, policyName, options);
  if (decision.allowed) return decision;

  const mode = getAllowListMode();
  logger.warn("allow-list violation", {
    action: "allow_list_check",
    policy: policyName,
    code: decision.code,
    mode,
    context: options.context,
  });
  return mode === "report" ? { ...decision, allowed: true, reportOnly: true } : decision;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.length <= bytes.length && signature.every((b, i) => bytes[i] === b);
}

/**
 * Identify a binary file kind from its leading bytes. Returns `null` for
 * anything not on the allow-list (including SVG, HTML and executables).
 */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  for (const [kind, rule] of Object.entries(FILE_TYPE_ALLOW_LIST) as [FileKind, FileTypeRule][]) {
    for (const signature of rule.magic) {
      if (!startsWith(bytes, signature)) continue;
      if (kind === "image" && signature[0] === 0x52) {
        // RIFF is only an image when the container type is WEBP.
        if (String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") continue;
      }
      if (kind === "image" && signature[0] === 0x00) {
        if (String.fromCharCode(...bytes.slice(4, 12)) !== "ftypavif") continue;
      }
      return kind;
    }
  }
  return null;
}

/**
 * Validate an uploaded/fetched file against the allow-list for `kind`: the
 * extension, the declared MIME type and (for binary kinds) the magic bytes
 * must all agree, so a renamed `.svg` or an HTML page served as `image/png`
 * is rejected.
 */
export function checkFileType(input: {
  kind: FileKind;
  filename?: string;
  contentType?: string;
  bytes?: Uint8Array;
}): AllowListDecision {
  const rule = FILE_TYPE_ALLOW_LIST[input.kind];

  if (input.filename !== undefined) {
    const extension = extensionOf(input.filename);
    if (!extension || !rule.extensions.includes(extension)) {
      return violation("file_type_not_allowed", `File extension must be one of: ${rule.extensions.join(", ")}.`);
    }
  }
  if (input.contentType !== undefined) {
    const mime = input.contentType.split(";")[0].trim().toLowerCase();
    if (!rule.mimeTypes.includes(mime)) {
      return violation("file_type_not_allowed", `Content type ${mime || "(none)"} is not allowed.`);
    }
  }
  if (input.bytes && rule.magic.length > 0 && sniffFileKind(input.bytes) !== input.kind) {
    return violation("file_type_mismatch", `File contents are not a valid ${input.kind} file.`);
  }
  return { allowed: true, reportOnly: false };
}

/**
 * Strict content allow-list evaluation (#1177).
 *
 * Validates structured or textual content against `CONTENT_ALLOW_LIST_POLICIES`:
 *   - Declared MIME type must be on the policy's `mimeTypes` allow-list.
 *   - Content must be non-empty and within `maxBytes` (UTF-8 byte length).
 *   - Binary control bytes (NULL, non-whitespace C0 controls, UTF-8 replacement
 *     character U+FFFD) are rejected with `content_encoding_invalid`.
 *   - HTML tags not in `allowHtmlTags` (e.g. `<script>`, `<iframe>`, `<svg>`,
 *     `<object>`, `<style>`, `<form>`, `<meta>`) or event-handler/style
 *     attributes (`onload=`, `onerror=`, `style=`) are rejected with
 *     `content_tag_not_allowed`.
 *   - Embedded URIs in markdown/HTML links or images using disallowed schemes
 *     (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`) are rejected with
 *     `content_uri_not_allowed`.
 *   - Policies requiring JSON objects (`webhook_payload`, `import_manifest`
 *     with `application/json`) verify structural parseability.
 */
// eslint-disable-next-line no-control-regex
const BINARY_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/;
const HTML_TAG_MATCHER = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g;
const DANGEROUS_ATTR_MATCHER = /\b(?:on[a-z0-9_-]+|style|formaction|xmlns|xlink:href|srcdoc)\s*=/i;
const MARKDOWN_OR_ATTR_URI_MATCHER =
  /(?:\]\(\s*|(?:\bhref|\bsrc|\baction)\s*=\s*["']?\s*)([a-zA-Z][a-zA-Z0-9+.-]*:[^\s)"'>]+)/gi;

function decodeNumericEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);?/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

export function checkContentAgainstPolicy(
  input: {
    content: unknown;
    contentType?: string;
  },
  policyName: ContentPolicyName,
): AllowListDecision {
  const policy = CONTENT_ALLOW_LIST_POLICIES[policyName];
  if (!policy) {
    return violation("content_type_not_allowed", "Unknown content allow-list policy.");
  }

  if (input.contentType !== undefined) {
    const normalizedMime = input.contentType.split(";")[0].trim().toLowerCase();
    if (!policy.mimeTypes.includes(normalizedMime)) {
      return violation(
        "content_type_not_allowed",
        `Content type ${normalizedMime || "(none)"} is not allowed for ${policyName}.`,
      );
    }
  }

  let text: string;
  let parsedObject: unknown;
  if (typeof input.content === "string") {
    text = input.content;
  } else if (
    input.content !== null &&
    typeof input.content === "object" &&
    policy.mimeTypes.includes("application/json")
  ) {
    try {
      text = JSON.stringify(input.content);
      parsedObject = input.content;
    } catch {
      return violation("content_structure_invalid", "Content cannot be serialized to JSON.");
    }
  } else {
    return violation("content_empty", "Content is required.");
  }

  if (!text.trim()) {
    return violation("content_empty", "Content is required.");
  }

  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > policy.maxBytes) {
    return violation(
      "content_too_large",
      `Content exceeds maximum allowed size of ${policy.maxBytes} bytes.`,
    );
  }

  if (BINARY_CONTROL_CHARS.test(text)) {
    return violation(
      "content_encoding_invalid",
      "Content contains disallowed binary or control characters.",
    );
  }

  // Check HTML tags and attributes against the policy's tag allow-list.
  const allowedTags = new Set(policy.allowHtmlTags.map((t) => t.toLowerCase()));
  for (const match of text.matchAll(HTML_TAG_MATCHER)) {
    const tagName = (match[1] ?? "").toLowerCase();
    const attrs = match[2] ?? "";
    if (!allowedTags.has(tagName)) {
      return violation(
        "content_tag_not_allowed",
        `HTML tag <${tagName}> is not allowed in ${policyName}.`,
      );
    }
    if (DANGEROUS_ATTR_MATCHER.test(attrs)) {
      return violation(
        "content_tag_not_allowed",
        `Executable or inline-style HTML attributes are not allowed in ${policyName}.`,
      );
    }
  }

  // Check embedded URIs (including entity-obfuscated schemes like `&#x6a;avascript:`)
  const decodedForUriScan = decodeNumericEntities(text).replace(/[\t\r\n]/g, "");
  if (/\b(?:javascript|vbscript|data|file|blob)\s*:/i.test(decodedForUriScan)) {
    return violation(
      "content_uri_not_allowed",
      "Embedded executable or inline data URIs are not allowed.",
    );
  }

  for (const match of decodedForUriScan.matchAll(MARKDOWN_OR_ATTR_URI_MATCHER)) {
    const candidateUri = match[1] ?? "";
    const colonIdx = candidateUri.indexOf(":");
    if (colonIdx <= 0) continue;
    const scheme = candidateUri.slice(0, colonIdx + 1).toLowerCase();
    if (!policy.allowedLinkSchemes.includes(scheme)) {
      return violation(
        "content_uri_not_allowed",
        `URI scheme ${scheme.replace(":", "")} is not allowed in ${policyName}.`,
      );
    }
  }

  const declaredMime = input.contentType?.split(";")[0].trim().toLowerCase();
  const shouldParseJson =
    policy.requireJsonObject ||
    declaredMime === "application/json" ||
    (policy.mimeTypes.length === 1 && policy.mimeTypes[0] === "application/json");

  if (shouldParseJson) {
    if (parsedObject === undefined) {
      try {
        parsedObject = JSON.parse(text);
      } catch {
        return violation("content_structure_invalid", "Content is not valid JSON.");
      }
    }
    if (
      policy.requireJsonObject &&
      (parsedObject === null || typeof parsedObject !== "object" || Array.isArray(parsedObject))
    ) {
      return violation("content_structure_invalid", "Content must be a JSON object.");
    }
  }

  return { allowed: true, reportOnly: false };
}

export function enforceContentAllowList(
  input: { content: unknown; contentType?: string },
  policyName: ContentPolicyName,
  options: { context?: string } = {},
): AllowListDecision {
  const decision = checkContentAgainstPolicy(input, policyName);
  if (decision.allowed) return decision;

  const mode = getAllowListMode();
  logger.warn("allow-list violation", {
    action: "allow_list_content_check",
    policy: policyName,
    code: decision.code,
    mode,
    context: options.context,
  });
  return mode === "report" ? { ...decision, allowed: true, reportOnly: true } : decision;
}

/** Effective policy view for operators (no secrets involved). */
export function describeAllowListPolicies() {
  return {
    mode: getAllowListMode(),
    runtimeOverride: getRuntimeAllowListOverride(),
    urlPolicies: Object.fromEntries(
      (Object.entries(ALLOW_LIST_POLICIES) as [AllowListPolicyName, UrlPolicy][]).map(([name, policy]) => [
        name,
        {
          schemes: policy.schemes.map((s) => s.replace(":", "")),
          extraPorts: policy.ports,
          ipLiterals: "denied",
          internalHostSuffixes: INTERNAL_HOST_SUFFIXES,
          fileKinds: policy.fileKinds,
          hostAllowList: getEffectiveHostAllowList(name),
          hostAllowListEnv: policy.hostAllowListEnv,
        },
      ]),
    ),
    fileTypes: Object.fromEntries(
      (Object.entries(FILE_TYPE_ALLOW_LIST) as [FileKind, FileTypeRule][]).map(([kind, rule]) => [
        kind,
        { extensions: rule.extensions, mimeTypes: rule.mimeTypes, magicChecked: rule.magic.length > 0 },
      ]),
    ),
    contentPolicies: Object.fromEntries(
      (Object.entries(CONTENT_ALLOW_LIST_POLICIES) as [ContentPolicyName, ContentPolicyRule][]).map(
        ([name, rule]) => [
          name,
          {
            mimeTypes: rule.mimeTypes,
            maxBytes: rule.maxBytes,
            allowHtmlTags: rule.allowHtmlTags,
            allowedLinkSchemes: rule.allowedLinkSchemes.map((s) => s.replace(":", "")),
            requireJsonObject: Boolean(rule.requireJsonObject),
          },
        ],
      ),
    ),
  };
}

const EVIDENCE_KIND_TO_FILE_KIND: Record<string, FileKind | null> = {
  image: "image",
  pdf: "pdf",
  text: "text",
  // A plain web page; its path may legitimately end in .html, .php, etc.
  link: null,
};

/** Allow-list check for one moderation evidence item of a declared kind. */
export function enforceEvidenceUrl(url: unknown, kind: string): AllowListDecision {
  const expectedKind = EVIDENCE_KIND_TO_FILE_KIND[kind];
  return enforceUrlAllowList(url, "report_evidence", {
    expectedKind: expectedKind ?? undefined,
    skipFileType: expectedKind === null,
    context: `report_evidence:${kind}`,
  });
}
