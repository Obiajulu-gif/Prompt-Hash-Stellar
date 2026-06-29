// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IPFS_URI_PREFIX,
  isIpfsReference,
  parseIpfsCid,
  toIpfsUri,
} from "./reference";
import { fetchCiphertextFromIpfs, resolveGatewayBase } from "./gateway";

describe("ipfs reference helpers", () => {
  it("recognises ipfs references", () => {
    expect(isIpfsReference("ipfs://bafyabc")).toBe(true);
    expect(isIpfsReference("  ipfs://bafyabc")).toBe(true);
    expect(isIpfsReference("bafyabc")).toBe(false);
    expect(isIpfsReference(undefined)).toBe(false);
    expect(isIpfsReference(null)).toBe(false);
  });

  it("parses the bare cid", () => {
    expect(parseIpfsCid("ipfs://bafyabc")).toBe("bafyabc");
    expect(parseIpfsCid("ipfs:///bafyabc")).toBe("bafyabc");
    expect(parseIpfsCid("not-ipfs")).toBeNull();
    expect(parseIpfsCid("ipfs://")).toBeNull();
  });

  it("builds canonical uris", () => {
    expect(toIpfsUri("bafyabc")).toBe(`${IPFS_URI_PREFIX}bafyabc`);
    expect(toIpfsUri("ipfs://bafyabc")).toBe(`${IPFS_URI_PREFIX}bafyabc`);
    expect(() => toIpfsUri("")).toThrow();
  });
});

describe("resolveGatewayBase", () => {
  it("normalises a missing trailing slash", () => {
    expect(resolveGatewayBase("https://example.com/ipfs")).toBe(
      "https://example.com/ipfs/",
    );
  });

  it("returns a slash-terminated default when no override is given", () => {
    expect(resolveGatewayBase().endsWith("/")).toBe(true);
  });
});

describe("fetchCiphertextFromIpfs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and trims ciphertext via the gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "  CIPHERTEXT  ",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCiphertextFromIpfs("ipfs://bafyabc", {
      gatewayBase: "https://gw.test/ipfs",
    });

    expect(result).toBe("CIPHERTEXT");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gw.test/ipfs/bafyabc",
      expect.anything(),
    );
  });

  it("rejects values that are not ipfs references", async () => {
    await expect(fetchCiphertextFromIpfs("not-ipfs")).rejects.toThrow(
      /not a valid IPFS reference/,
    );
  });

  it("throws when the gateway responds with an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 504,
        statusText: "Gateway Timeout",
      }),
    );
    await expect(
      fetchCiphertextFromIpfs("ipfs://bafyabc"),
    ).rejects.toThrow(/504/);
  });
});
