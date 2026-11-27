import { afterEach, describe, expect, it } from "vitest";
import { correlationMiddleware } from "../middleware/correlation";
import { jsonCall, startHttpServer, type HttpTestServer } from "./helpers/httpApp";

describe("request correlation middleware", () => {
  let server: HttpTestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("preserves a valid client ID across success, retry, and authorization responses", async () => {
    server = await startHttpServer((app) => {
      app.use(correlationMiddleware);
      app.get("/success", (req, res) => res.json({ correlationId: req.correlationId }));
      app.post("/retry", (req, res) => res.status(202).json({ accepted: true }));
      app.get("/private", (req, res) => res.status(403).json({ error: "forbidden" }));
    });

    const success = await jsonCall(server.baseUrl, "/success", {
      headers: { "x-correlation-id": "retry-42:worker" },
    });
    expect(success.headers.get("x-correlation-id")).toBe("retry-42:worker");
    expect(success.body).toMatchObject({ correlationId: "retry-42:worker" });

    const retry = await jsonCall(server.baseUrl, "/retry", {
      method: "POST",
      headers: { "x-request-id": "retry-42:worker" },
    });
    expect(retry.headers.get("x-correlation-id")).toBe("retry-42:worker");

    const denied = await jsonCall(server.baseUrl, "/private", {
      headers: { "x-correlation-id": "retry-42:worker" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("x-correlation-id")).toBe("retry-42:worker");
    expect(denied.body.correlationId).toBe("retry-42:worker");
  });

  it("generates a UUID for missing or unsafe incoming IDs", async () => {
    server = await startHttpServer((app) => {
      app.use(correlationMiddleware);
      app.get("/failure", (_req, res) => res.status(500).json({ error: "failed" }));
    });

    const missing = await jsonCall(server.baseUrl, "/failure");
    const unsafe = await jsonCall(server.baseUrl, "/failure", {
      headers: { "x-correlation-id": "bad id / with unsafe characters" },
    });

    for (const response of [missing, unsafe]) {
      expect(response.headers.get("x-correlation-id")).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(response.body.correlationId).toBe(response.headers.get("x-correlation-id"));
    }
  });
});
