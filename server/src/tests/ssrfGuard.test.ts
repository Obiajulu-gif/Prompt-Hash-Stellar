import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  isDisallowedIPv4,
  isDisallowedIPv6,
  isDisallowedAddress,
  postSignedWebhook,
  UnsafeWebhookUrlError,
} from "../services/ssrfGuard";

describe("ssrfGuard.isDisallowedIPv4", () => {
  it("allows just below the RFC1918 172.16/12 block", () => {
    expect(isDisallowedIPv4("172.15.0.1")).toBe(false);
  });

  it("disallows the start of the RFC1918 172.16/12 block", () => {
    expect(isDisallowedIPv4("172.16.0.1")).toBe(true);
  });

  it("disallows the end of the RFC1918 172.16/12 block", () => {
    expect(isDisallowedIPv4("172.31.255.255")).toBe(true);
  });

  it("allows just above the RFC1918 172.16/12 block", () => {
    expect(isDisallowedIPv4("172.32.0.1")).toBe(false);
  });
});

describe("ssrfGuard.isDisallowedIPv6", () => {
  it("disallows the IPv4-mapped cloud metadata address", () => {
    expect(isDisallowedIPv6("::ffff:169.254.169.254")).toBe(true);
  });

  it("disallows link-local addresses", () => {
    expect(isDisallowedIPv6("fe80::1")).toBe(true);
  });

  it("disallows unique-local addresses (fc00::/7)", () => {
    expect(isDisallowedIPv6("fc00::1")).toBe(true);
    expect(isDisallowedIPv6("fd00::1")).toBe(true);
  });

  it("disallows the fully unspecified address", () => {
    expect(isDisallowedIPv6("::")).toBe(true);
  });

  it("allows a public IPv6 address", () => {
    expect(isDisallowedIPv6("2001:4860:4860::8888")).toBe(false);
  });
});

describe("ssrfGuard.isDisallowedAddress", () => {
  it("delegates to isDisallowedIPv4 for IPv4 literals", () => {
    expect(isDisallowedAddress("127.0.0.1")).toBe(true);
    expect(isDisallowedAddress("93.184.216.34")).toBe(false);
  });

  it("delegates to isDisallowedIPv6 for IPv6 literals", () => {
    expect(isDisallowedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isDisallowedAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("fails closed for anything that isn't a recognizable IP", () => {
    expect(isDisallowedAddress("not-an-ip")).toBe(true);
  });
});

vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dns")>();
  return { ...actual, lookup: vi.fn() };
});

vi.mock("https", () => ({ request: vi.fn() }));

describe("ssrfGuard.postSignedWebhook redirect chain", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects hop 2 when its Location header resolves to a private address, even though hop 1 resolved to a public one", async () => {
    const dns = await import("dns");
    const https = await import("https");

    (dns.lookup as any).mockImplementation(
      (hostname: string, _options: unknown, callback: (...args: any[]) => void) => {
        if (hostname === "public-hop1.example.com") {
          callback(null, [{ address: "93.184.216.34", family: 4 }]);
        } else if (hostname === "internal-hop2.example.com") {
          callback(null, [{ address: "10.1.2.3", family: 4 }]);
        } else {
          callback(new Error(`unexpected lookup for ${hostname}`), []);
        }
      },
    );

    (https.request as any).mockImplementation((options: any, resCallback: (res: any) => void) => {
      const req: any = new EventEmitter();
      req.end = vi.fn();
      req.destroy = vi.fn();

      options.lookup(options.hostname, {}, (err: any, address: string, family: number) => {
        if (err) {
          process.nextTick(() => req.emit("error", err));
          return;
        }
        process.nextTick(() => {
          const res: any = new EventEmitter();
          if (options.hostname === "public-hop1.example.com") {
            res.statusCode = 302;
            res.headers = { location: "https://internal-hop2.example.com/next" };
          } else {
            res.statusCode = 200;
            res.headers = {};
          }
          resCallback(res);
          process.nextTick(() => res.emit("end"));
        });
      });

      return req;
    });

    await expect(
      postSignedWebhook("https://public-hop1.example.com/start", {}, "body", 1000),
    ).rejects.toThrow(UnsafeWebhookUrlError);

    expect(dns.lookup).toHaveBeenCalledWith(
      "internal-hop2.example.com",
      expect.anything(),
      expect.anything(),
    );
  });
});
