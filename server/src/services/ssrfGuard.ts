/**
 * SSRF protection for outbound webhook delivery (#536).
 *
 * Rejects subscriber URLs that aren't a plain `https://` address, and pins
 * every delivery's actual TCP connection to a DNS answer we've already
 * vetted as public (not loopback/private/link-local/multicast, including
 * the cloud metadata address 169.254.169.254) by handing `https.request` a
 * custom `lookup` that validates before resolving. Because Node opens the
 * socket to whatever `lookup` returns rather than re-resolving the hostname
 * itself, a DNS answer that changes after validation (rebinding) can't
 * redirect the connection to an internal address. TLS SNI/certificate
 * checks are unaffected — they still validate against the real hostname.
 * Redirects are followed manually, one hop at a time, so every hop gets the
 * same validation as the original URL.
 */

import { lookup as dnsLookupCb, LookupAddress } from "dns";
import { request as httpsRequest } from "https";
import * as net from "net";

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeWebhookUrlError";
  }
}

function isDisallowedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isDisallowedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (/^fe[89ab]/.test(normalized)) return true; // link-local (fe80::/10)
  if (/^f[cd]/.test(normalized)) return true; // unique local (fc00::/7)
  if (normalized.startsWith("ff")) return true; // multicast
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isDisallowedIPv4(mapped[1]);
  return false;
}

function isDisallowedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isDisallowedIPv4(address);
  if (family === 6) return isDisallowedIPv6(address);
  return true; // not a recognizable IP — fail closed
}

/** Rejects anything that isn't a plain https:// URL with no embedded credentials. */
export function assertSafeWebhookUrlShape(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError("Not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new UnsafeWebhookUrlError("Only https:// webhook URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError("Webhook URLs may not carry credentials.");
  }
  const literalFamily = net.isIP(url.hostname);
  if (literalFamily && isDisallowedAddress(url.hostname)) {
    throw new UnsafeWebhookUrlError("Webhook URL resolves to a disallowed address.");
  }
  return url;
}

/** `dns.lookup`-compatible resolver that fails closed on any private/internal answer. */
function safeLookup(
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  dnsLookupCb(hostname, { all: true, verbatim: false }, (err, addresses: LookupAddress[]) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    const safe = addresses.find((a) => !isDisallowedAddress(a.address));
    if (!safe) {
      callback(
        new UnsafeWebhookUrlError(`${hostname} did not resolve to any allowed address.`),
        "",
        0,
      );
      return;
    }
    callback(null, safe.address, safe.family);
  });
}

export interface SafeDeliveryResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MiB — enough for an error body, bounded against abuse.

/**
 * POSTs `body` to `rawUrl`, validating and re-validating on every redirect
 * hop. Throws {@link UnsafeWebhookUrlError} if the URL, any redirect
 * target, or the resolved address is unsafe.
 */
export async function postSignedWebhook(
  rawUrl: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<SafeDeliveryResult> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = assertSafeWebhookUrlShape(currentUrl);
    const result = await performRequest(url, headers, body, timeoutMs);

    const isRedirect = result.status >= 300 && result.status < 400;
    const location = result.headers.location;
    if (!isRedirect || !location || typeof location !== "string") {
      return result;
    }
    if (hop === MAX_REDIRECTS) {
      throw new UnsafeWebhookUrlError("Too many webhook redirects.");
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new UnsafeWebhookUrlError("Too many webhook redirects.");
}

function performRequest(
  url: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<SafeDeliveryResult> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(body, "utf8");
    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": String(payload.length) },
        timeout: timeoutMs,
        lookup: safeLookup,
      },
      (res) => {
        let chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("Webhook response exceeded size limit."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );

    req.on("timeout", () => req.destroy(new Error("Webhook delivery timed out.")));
    req.on("error", reject);
    req.end(payload);
  });
}
