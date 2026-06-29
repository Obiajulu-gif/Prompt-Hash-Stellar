import { describe, it, expect } from "vitest";
import handler from "../../api/health";

describe("Health API", () => {
  it("should return 200 and ok status", async () => {
    let statusCode = 0;
    let responseData = {};

    const req = {
      method: "GET",
      headers: {},
      url: "/api/health",
      socket: { remoteAddress: "127.0.0.1" }
    };

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        responseData = data;
        return this;
      }
    };

    // @ts-ignore
    await handler(req, res);

    expect(statusCode).toBe(200);
    // @ts-ignore
    expect(responseData.status).toBe("ok");
    // @ts-ignore
    expect(responseData.timestamp).toBeDefined();
  });
});
