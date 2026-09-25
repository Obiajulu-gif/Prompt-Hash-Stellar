import { describe, it, expect } from "vitest";
import {
  buildSitemapXml,
  buildProductJsonLd,
  buildRobotsTxt,
  escapeXml,
  promptSitemapEntry,
  creatorSitemapEntry,
  type SitemapPromptInput,
} from "@/lib/seo/sitemap";

const BASE = "https://prompthash.example";

function publicPrompt(overrides: Partial<SitemapPromptInput> = {}): SitemapPromptInput {
  return {
    id: 42,
    title: "A public prompt",
    creator: "GAAA1111",
    updatedAt: "2026-09-01T12:00:00Z",
    active: true,
    status: "Active",
    similarityFlag: "clean",
    integrityStatus: "ok",
    ...overrides,
  };
}

describe("promptSitemapEntry inclusion rules (#791)", () => {
  it("includes an active public prompt", () => {
    const entry = promptSitemapEntry(publicPrompt(), BASE);
    expect(entry).not.toBeNull();
    expect(entry?.loc).toBe(`${BASE}/prompts/42`);
    expect(entry?.lastmod).toBe("2026-09-01");
  });

  it("excludes inactive listings", () => {
    expect(promptSitemapEntry(publicPrompt({ active: false }), BASE)).toBeNull();
  });

  it("excludes suspended/hidden statuses", () => {
    for (const status of ["Draft", "Paused", "Retired", "Restricted", "Suspended"]) {
      expect(promptSitemapEntry(publicPrompt({ status }), BASE)).toBeNull();
    }
  });

  it("excludes plagiarized listings", () => {
    expect(
      promptSitemapEntry(publicPrompt({ similarityFlag: "highly_similar" }), BASE),
    ).toBeNull();
  });

  it("excludes failed content-integrity listings", () => {
    for (const integrityStatus of ["corrupted", "missing", "unreachable"]) {
      expect(
        promptSitemapEntry(publicPrompt({ integrityStatus }), BASE),
      ).toBeNull();
    }
  });

  it("falls back to today for a missing updatedAt", () => {
    const entry = promptSitemapEntry(publicPrompt({ updatedAt: null }), BASE);
    expect(entry?.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("creatorSitemapEntry rules (#791)", () => {
  it("includes creators with public listings", () => {
    const entry = creatorSitemapEntry(
      { walletAddress: "GAAA1111", hasPublicListings: true },
      BASE,
    );
    expect(entry?.loc).toBe(`${BASE}/sellers/GAAA1111`);
  });

  it("excludes creators without public listings", () => {
    expect(
      creatorSitemapEntry({ walletAddress: "GAAA1111", hasPublicListings: false }, BASE),
    ).toBeNull();
  });
});

describe("buildSitemapXml (#791)", () => {
  it("emits static, prompt and creator entries", () => {
    const xml = buildSitemapXml(
      [publicPrompt({ id: 1 }), publicPrompt({ id: 2 })],
      [{ walletAddress: "GAAA1111", hasPublicListings: true }],
      BASE,
      new Date("2026-09-24T00:00:00Z"),
    );

    expect(xml).toContain(`${BASE}/</loc>`);
    expect(xml).toContain(`${BASE}/browse</loc>`);
    expect(xml).toContain(`${BASE}/prompts/1</loc>`);
    expect(xml).toContain(`${BASE}/prompts/2</loc>`);
    expect(xml).toContain(`${BASE}/sellers/GAAA1111</loc>`);
  });

  it("never emits excluded listings even if the DB query missed them", () => {
    const xml = buildSitemapXml(
      [
        publicPrompt({ id: 1 }),
        publicPrompt({ id: 2, active: false }),
        publicPrompt({ id: 3, status: "Restricted" }),
        publicPrompt({ id: 4, similarityFlag: "highly_similar" }),
      ],
      [],
      BASE,
    );
    expect(xml).toContain("/prompts/1<");
    expect(xml).not.toContain("/prompts/2<");
    expect(xml).not.toContain("/prompts/3<");
    expect(xml).not.toContain("/prompts/4<");
  });

  it("XML-escapes titles and urls", () => {
    expect(escapeXml('a<&>"\'b')).toBe("a&lt;&amp;&gt;&quot;&apos;b");
    const xml = buildSitemapXml([publicPrompt({ id: "x?a&b" })], [], BASE);
    expect(xml).toContain("/prompts/x?a&amp;b");
  });
});

describe("buildProductJsonLd (#791)", () => {
  it("exposes title, price, creator, and availability", () => {
    const ld = buildProductJsonLd(
      {
        id: 42,
        title: "Master prompt",
        previewText: "Does amazing things",
        priceStroops: 15_000_000n,
        creator: "GAAA1111",
        salesCount: 7,
        active: true,
      },
      BASE,
    );

    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Master prompt");
    const offers = ld.offers as Record<string, unknown>;
    expect(offers.price).toBe("1.50");
    expect(offers.priceCurrency).toBe("XLM");
    expect(offers.availability).toBe("https://schema.org/InStock");
    expect((ld.seller as Record<string, unknown>).name).toBe("GAAA1111");
  });

  it("marks unavailable listings OutOfStock", () => {
    const ld = buildProductJsonLd(
      { id: 1, title: "t", active: false },
      BASE,
    );
    expect((ld.offers as Record<string, unknown>).availability).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("never includes hidden payload fields", () => {
    const ld = buildProductJsonLd(
      { id: 1, title: "t", previewText: "safe preview" },
      BASE,
    );
    const json = JSON.stringify(ld);
    expect(json).not.toContain("encryptedPrompt");
    expect(json).not.toContain("encryptionIv");
    expect(json).not.toContain("wrappedKey");
    expect(json).not.toContain("contentHash");
  });
});

describe("buildRobotsTxt (#791)", () => {
  it("advertises the sitemap and blocks admin/api", () => {
    const txt = buildRobotsTxt(BASE);
    expect(txt).toContain("Sitemap: https://prompthash.example/api/sitemap.xml");
    expect(txt).toContain("Disallow: /admin");
    expect(txt).toContain("Disallow: /api/");
  });
});
