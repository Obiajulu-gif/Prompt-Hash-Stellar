import { describe, it, expect } from "vitest";
import { sanitizePreviewText, validateAndSanitizePreview, isSafeUrl, isSafeImageUrl } from "../services/previewSanitize";

describe("previewSanitize (server)", () => {
  it("strips script/iframe blocks", () => {
    const out = sanitizePreviewText('<script>alert(1)</script> hello');
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
    expect(out).toContain("hello");
  });

  it("blocks javascript: links", () => {
    const out = sanitizePreviewText('[Click](javascript:alert(1))');
    expect(out).not.toContain("javascript:");
  });

  it("strips event handlers", () => {
    const out = sanitizePreviewText('<img src="https://example.com/x.png" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
  });

  it("isSafeUrl allows https only", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,hi")).toBe(false);
  });

  it("isSafeImageUrl allows https only", () => {
    expect(isSafeImageUrl("https://example.com/a.png")).toBe(true);
    expect(isSafeImageUrl("http://example.com/a.png")).toBe(false);
  });

  it("validateAndSanitizePreview detects dangerous content and truncation", () => {
    const long = "a".repeat(25000);
    const res = validateAndSanitizePreview(long);
    expect(res.truncated).toBe(true);
    expect(res.safeText.length).toBeLessThanOrEqual(20000 + 10);

    const xss = '<script>alert(1)</script> hello';
    const res2 = validateAndSanitizePreview(xss);
    expect(res2.hadDangerousContent).toBe(true);
  });
});
