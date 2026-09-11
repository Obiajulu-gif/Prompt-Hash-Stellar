// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IPFS_URI_PREFIX,
  isIpfsReference,
  parseIpfsCid,
  toIpfsUri,
} from "./reference";
import { resolveGatewayBase } from "./gateway";

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

});


