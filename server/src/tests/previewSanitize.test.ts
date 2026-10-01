import { describe, it, expect } from "vitest";
import {
  sanitizePreviewText,
  validateAndSanitizePreview,
  isSafeUrl,
  isSafeImageUrl,
  sanitizeExternalUrl,
  sanitizePlainMetadata,
} from "../services/previewSanitize";

describe("previewSanitize (server security hardening)", () => {
  describe("sanitizePreviewText", () => {
    it("strips script, iframe, and style blocks", () => {
      const out = sanitizePreviewText("<script>alert(1)</script> hello");
      expect(out).not.toContain("script");
      expect(out).not.toContain("alert");
      expect(out).toContain("hello");
    });

    it("strips svg and math XSS vectors", () => {
      const svgXss = '<svg onload="alert(1)"><circle r="10"/></svg> Content';
      const outSvg = sanitizePreviewText(svgXss);
      expect(outSvg).not.toContain("<svg");
      expect(outSvg).not.toContain("onload");
      expect(outSvg).toContain("Content");

      const mathXss = '<math><mi xlink:href="javascript:alert(1)">click</mi></math>';
      const outMath = sanitizePreviewText(mathXss);
      expect(outMath).not.toContain("<math");
      expect(outMath).not.toContain("xlink:href");
    });

    it("blocks javascript: and data: links in markdown syntax", () => {
      const linkXss = "[Click here](javascript:alert(1))";
      const out = sanitizePreviewText(linkXss);
      expect(out).not.toContain("javascript:");
      expect(out).toContain("[Click here](#)");

      const dataLink = "[Download](data:text/html,<script>alert(1)</script>)";
      const outData = sanitizePreviewText(dataLink);
      expect(outData).not.toContain("data:");
      expect(outData).toContain("[Download](#)");
    });

    it("neutralizes unsafe image protocols", () => {
      const imgHttp = "![Preview](http://example.com/bad.png)";
      const outHttp = sanitizePreviewText(imgHttp);
      expect(outHttp).toContain("https://example.invalid/blocked");

      const imgData = "![Malicious](data:image/svg+xml;base64,PHN2Zz4=)";
      const outData = sanitizePreviewText(imgData);
      expect(outData).toContain("https://example.invalid/blocked");
    });

    it("strips event handlers and inline styles", () => {
      const out = sanitizePreviewText(
        '<img src="https://example.com/x.png" onerror="alert(1)" onclick=\'alert(2)\' style="display:none">',
      );
      expect(out).not.toContain("onerror");
      expect(out).not.toContain("onclick");
      expect(out).not.toContain("style");
    });
  });

  describe("isSafeUrl & sanitizeExternalUrl", () => {
    it("allows standard https and http URLs", () => {
      expect(isSafeUrl("https://stellar.org")).toBe(true);
      expect(isSafeUrl("http://stellar.org")).toBe(true);
      expect(sanitizeExternalUrl("https://stellar.org")).toBe("https://stellar.org");
    });

    it("rejects javascript:, vbscript:, data:, file:, and blob: protocols", () => {
      expect(isSafeUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
      expect(isSafeUrl("data:text/html,evil")).toBe(false);
      expect(isSafeUrl("file:///etc/passwd")).toBe(false);
      expect(isSafeUrl("blob:https://stellar.org/uuid")).toBe(false);
      expect(sanitizeExternalUrl("javascript:alert(1)")).toBeNull();
    });

    it("detects and rejects obfuscated protocols and HTML entity evasion", () => {
      expect(isSafeUrl("jav&#x09;ascript:alert(1)")).toBe(false);
      expect(isSafeUrl("&#x6a;avascript:alert(1)")).toBe(false);
      expect(isSafeUrl("java\tscript:alert(1)")).toBe(false);
      expect(isSafeUrl("  javascript : alert(1) ")).toBe(false);
      expect(sanitizeExternalUrl("java\0script:alert(1)")).toBeNull();
    });

    it("rejects URLs with embedded credentials to prevent phishing/deception", () => {
      expect(isSafeUrl("https://admin:password@stellar.org/")).toBe(false);
      expect(isSafeUrl("https://user@phishing.com/account")).toBe(false);
      expect(sanitizeExternalUrl("https://victim.com:secret@evil.com")).toBeNull();
    });

    it("rejects relative paths and anchor references", () => {
      expect(isSafeUrl("/api/unlock")).toBe(false);
      expect(isSafeUrl("../secret")).toBe(false);
      expect(isSafeUrl("#section")).toBe(false);
    });
  });

  describe("isSafeImageUrl", () => {
    it("allows https only for images", () => {
      expect(isSafeImageUrl("https://example.com/logo.png")).toBe(true);
      expect(isSafeImageUrl("http://example.com/logo.png")).toBe(false);
      expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    });
  });

  describe("sanitizePlainMetadata", () => {
    it("escapes raw HTML tags in user-submitted metadata", () => {
      const input = '<b onmouseover="alert(1)">Prompt Title & Notes</b>';
      const sanitized = sanitizePlainMetadata(input);
      expect(sanitized).not.toContain("<b");
      expect(sanitized).toContain("&lt;b");
      expect(sanitized).toContain("&amp;");
    });

    it("truncates metadata to safe maximum length", () => {
      const longTitle = "A".repeat(5000);
      const sanitized = sanitizePlainMetadata(longTitle, 100);
      expect(sanitized.length).toBe(100);
    });
  });

  describe("validateAndSanitizePreview", () => {
    it("detects dangerous content and truncates oversized payloads", () => {
      const oversized = "a".repeat(25000);
      const res = validateAndSanitizePreview(oversized);
      expect(res.truncated).toBe(true);
      expect(res.safeText.length).toBeLessThanOrEqual(20000 + 10);

      const xss = '<script>alert(1)</script> hello';
      const res2 = validateAndSanitizePreview(xss);
      expect(res2.hadDangerousContent).toBe(true);
      expect(res2.safeText).not.toContain("script");
    });
  });
});
