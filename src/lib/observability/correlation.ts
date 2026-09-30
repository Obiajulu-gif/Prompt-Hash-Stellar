/**
 * Generate a correlation ID for request tracing and logging.
 *
 * Uses crypto.randomUUID() where available (all modern browsers and Node.js).
 * Correlation IDs are used ONLY for non-security-sensitive tracing/logging purposes:
 * not for idempotency keys, replay protection, or any cryptographic operation.
 *
 * The fallback Math.random() path is intentionally non-cryptographic because:
 * 1. It's only reached in very old/limited runtimes (essentially unreachable in practice)
 * 2. The ID is used only for log correlation, not security operations
 * 3. Observability is not worth blocking on unavailable crypto
 *
 * If crypto.randomUUID is unavailable, we try crypto.getRandomValues as a stronger fallback
 * before falling back to Math.random().
 */
export function generateCorrelationId(): string {
  // First choice: crypto.randomUUID (available in all modern environments)
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback 1: crypto.getRandomValues + manual UUID v4 formatting (more secure than Math.random)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // Set version to 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // Set variant to RFC 4122
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } catch {
      // Fall through to Math.random fallback if getRandomValues fails
    }
  }

  // Fallback 2: Math.random (non-cryptographic, only for tracing)
  // This path is essentially unreachable in modern environments but kept for compatibility
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function initializeCorrelation() {
  if (typeof window === "undefined" || !window.fetch) return;

  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const cid = generateCorrelationId();

    let targetInput = input;
    let targetInit = { ...init };

    let hasCorrelationId = false;

    if (typeof input === "string" || input instanceof URL) {
      const headers = new Headers(targetInit.headers);
      if (headers.has("x-correlation-id") || headers.has("x-request-id")) {
        hasCorrelationId = true;
      } else {
        headers.set("X-Correlation-ID", cid);
      }
      targetInit.headers = headers;
    } else if (input instanceof Request) {
      if (input.headers.has("x-correlation-id") || input.headers.has("x-request-id")) {
        hasCorrelationId = true;
      } else {
        const clonedRequest = input.clone();
        clonedRequest.headers.set("X-Correlation-ID", cid);
        targetInput = clonedRequest;
      }
    }

    const requestCorrelationId = hasCorrelationId
      ? (typeof input === "string" || input instanceof URL
          ? new Headers(targetInit.headers).get("x-correlation-id") || new Headers(targetInit.headers).get("x-request-id")
          : (input as Request).headers.get("x-correlation-id") || (input as Request).headers.get("x-request-id"))
      : cid;

    const urlString = typeof input === "string"
      ? input
      : (input instanceof URL ? input.toString() : (input as Request).url);

    // Only log and inject correlation IDs for our own relative/absolute API paths to avoid leaking it
    const isApiRequest = urlString.startsWith("/api/") || urlString.includes("/api/prompts") || urlString.includes("/api/auth");

    if (isApiRequest) {
      console.log(`[Frontend Request] ${urlString} | Correlation ID: ${requestCorrelationId}`);
    }

    try {
      const response = await originalFetch.call(this, targetInput, targetInit);
      if (isApiRequest) {
        if (response.ok) {
          console.log(`[Frontend Response] ${urlString} | Status: ${response.status} | Correlation ID: ${requestCorrelationId}`);
        } else {
          console.error(`[Frontend Response Error] ${urlString} | Status: ${response.status} | Correlation ID: ${requestCorrelationId}`);
        }
      }
      return response;
    } catch (error) {
      if (isApiRequest) {
        console.error(`[Frontend Fetch Network Error] ${urlString} | Correlation ID: ${requestCorrelationId} | Error:`, error);
      }
      throw error;
    }
  };
}
