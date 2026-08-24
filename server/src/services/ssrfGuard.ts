import { isIP } from "net";

/**
 * Blocked IP ranges for SSRF protection. These cover loopback, link-local,
 * cloud metadata endpoints, and common private ranges.
 */
const BLOCKED_RANGES: Array<{ start: string; end: string; label: string }> = [
  // Loopback
  { start: "127.0.0.0", end: "127.255.255.255", label: "loopback" },
  // IPv6 loopback
  { start: "::1", end: "::1", label: "ipv6-loopback" },
  // Link-local (169.254.x.x)
  { start: "169.254.0.0", end: "169.254.255.255", label: "link-local" },
  // Private Class A (10.x.x.x)
  { start: "10.0.0.0", end: "10.255.255.255", label: "private-a" },
  // Private Class B (172.16-31.x.x)
  { start: "172.16.0.0", end: "172.31.255.255", label: "private-b" },
  // Private Class C (192.168.x.x)
  { start: "192.168.0.0", end: "192.168.255.255", label: "private-c" },
  // Cloud metadata (169.254.169.254)
  { start: "169.254.169.254", end: "169.254.169.254", label: "metadata" },
  // Carrier-grade NAT (100.64-127.x.x)
  { start: "100.64.0.0", end: "100.127.255.255", label: "carrier-nat" },
];

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function ipInRange(ip: string, start: string, end: string): boolean {
  // Handle IPv6 by comparing as strings for exact matches
  if (ip.includes(":") || start.includes(":")) {
    return ip === start && start === end;
  }
  const ipNum = ipToNumber(ip);
  const startNum = ipToNumber(start);
  const endNum = ipToNumber(end);
  if (ipNum === null || startNum === null || endNum === null) return false;
  return ipNum >= startNum && ipNum <= endNum;
}

/**
 * Check whether a hostname resolves to a blocked address.
 * Uses DNS lookup via `dns.resolve4` for hostname validation.
 *
 * Returns `null` if safe, or a reason string if blocked.
 */
export async function validateWebhookUrl(urlString: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return "Invalid URL format";
  }

  // Only allow HTTPS in production; allow HTTP for localhost dev
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Only HTTP(S) URLs are allowed";
  }

  const hostname = parsed.hostname;

  // Block exact metadata hostname
  if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
    return "Cloud metadata endpoint blocked";
  }

  // If hostname is an IP, check directly
  const directIp = isIP(hostname);
  if (directIp !== 0) {
    for (const range of BLOCKED_RANGES) {
      if (ipInRange(hostname, range.start, range.end)) {
        return `IP address in blocked range: ${range.label}`;
      }
    }
    return null; // Public IP, allowed
  }

  // Hostname is a domain – resolve it and check each IP
  try {
    const { resolve4 } = await import("dns/promises");
    const addresses = await resolve4(hostname, { ttl: true });
    for (const addr of addresses) {
      for (const range of BLOCKED_RANGES) {
        if (ipInRange(addr.ip, range.start, range.end)) {
          return `Hostname ${hostname} resolves to blocked range: ${range.label} (${addr.ip})`;
        }
      }
    }
  } catch {
    // DNS resolution failure – reject to be safe
    return `Could not resolve hostname: ${hostname}`;
  }

  return null; // All checks passed
}
