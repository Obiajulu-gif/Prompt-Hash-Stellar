export function generateCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
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
