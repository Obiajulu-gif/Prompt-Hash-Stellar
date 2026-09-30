import { describe, it, expect } from "vitest";
import { sanitizeImageSrc, sanitizeLinkHref, truncatePreview, escapeHtml } from "./sanitize";
import { isSafeUrl, isSafeImageUrl, isDangerousAttribute } from "./markdownPolicy";

describe("preview sanitize helpers", () => {
  describe("isSafeUrl", () => {
    it("allows http/https", () => {
      expect(isSafeUrl("https://example.com")).toBe(true);
      expect(isSafeUrl("http://example.com")).toBe(true);
    });
    it("blocks javascript/data/vbscript/file/blob", () => {
      expect(isSafeUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeUrl("JaVaScRiPt:alert(1)")).toBe(false);
      expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
      expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
      expect(isSafeUrl("file:///etc/passwd")).toBe(false);
      expect(isSafeUrl("blob:https://example.com/uuid")).toBe(false);
    });
    it("blocks relative/anchor", () => {
      expect(isSafeUrl("/etc/passwd")).toBe(false);
      expect(isSafeUrl("#anchor")).toBe(false);
      expect(isSafeUrl("./local")).toBe(false);
    });
    it("blocks URLs with control chars", () => {
      expect(sanitizeLinkHref("https://example.com\x00")).toBeNull();
    });
  });

  describe("isSafeImageUrl", () => {
    it("allows https only", () => {
      expect(isSafeImageUrl("https://example.com/img.png")).toBe(true);
      expect(isSafeImageUrl("http://example.com/img.png")).toBe(false);
    });
  });

  describe("isDangerousAttribute", () => {
    it("flags on* and style", () => {
      expect(isDangerousAttribute("onclick")).toBe(true);
      expect(isDangerousAttribute("onerror")).toBe(true);
      expect(isDangerousAttribute("style")).toBe(true);
      expect(isDangerousAttribute("ONLOAD")).toBe(true);
      expect(isDangerousAttribute("href")).toBe(false);
      expect(isDangerousAttribute("alt")).toBe(false);
    });
  });

  describe("sanitizeLinkHref", () => {
    it("returns safe href", () => {
      expect(sanitizeLinkHref("https://example.com")).toBe("https://example.com");
    });
    it("blocks javascript:", () => {
      expect(sanitizeLinkHref("javascript:alert(1)")).toBeNull();
      expect(sanitizeLinkHref("  javascript:alert(1) ")).toBeNull();
    });
    it("blocks data:", () => {
      expect(sanitizeLinkHref("data:text/html,hi")).toBeNull();
    });
    it("blocks empty", () => {
      expect(sanitizeLinkHref(undefined)).toBeNull();
      expect(sanitizeLinkHref("")).toBeNull();
    });
  });

  describe("sanitizeImageSrc", () => {
    it("allows https", () => {
      expect(sanitizeImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    });
    it("blocks http for images", () => {
      expect(sanitizeImageSrc("http://example.com/a.png")).toBeNull();
    });
    it("blocks data:", () => {
      expect(sanitizeImageSrc("data:image/png;base64,xxx")).toBeNull();
    });
  });

  describe("truncatePreview", () => {
    it("truncates by length", () => {
      const long = "a".repeat(30000);
      expect(truncatePreview(long).length).toBe(20000);
    });
    it("truncates by lines", () => {
      const manyLines = Array.from({ length: 600 }, (_, i) => `line ${i}`).join("\n");
      expect(truncatePreview(manyLines).split("\n").length).toBe(500);
    });
  });

  describe("escapeHtml", () => {
    it("escapes html", () => {
      expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    });
  });
});
