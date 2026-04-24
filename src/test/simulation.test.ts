import { describe, it, expect, beforeEach } from "vitest";
import challengeHandler from "../../api/auth/challenge";

// Mocking the response and request objects
const createMockRes = () => {
  let _status = 200;
  let _json = {};
  const res = {
    status(code: number) {
      _status = code;
      return this;
    },
    json(data: any) {
      _json = data;
      return this;
    },
    get statusCode() { return _status; },
    get data() { return _json; }
  };
  return res;
};

describe("Production Hardening Simulation", () => {
  const address = "GBXCC5SVXCI2XCDXCDXCDXCDXCDXCDXCDXCDXCDXCDXCDXCDXCDXCD";
  const promptId = "1";

  it("should trigger rate limiting after multiple requests from same IP", async () => {
    process.env.CHALLENGE_TOKEN_SECRET = "test-secret";
    const ip = "1.2.3.4";
    
    // First 10 requests should succeed (assuming limit is 10/min)
    for (let i = 0; i < 10; i++) {
       const req = {
         method: "POST",
         headers: { "x-forwarded-for": ip },
         body: { address, promptId },
         socket: {}
       };
       const res = createMockRes();
       // @ts-ignore
       await challengeHandler(req, res);
       expect(res.statusCode).toBe(200);
    }

    // 11th request should fail with 429
    const req = {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: { address, promptId },
      socket: {}
    };
    const res = createMockRes();
    // @ts-ignore
    await challengeHandler(req, res);
    
    expect(res.statusCode).toBe(429);
    // @ts-ignore
    expect(res.data.error).toContain("Too many requests");
    console.log("Successfully triggered rate limit (429) as expected.");
  });
});
