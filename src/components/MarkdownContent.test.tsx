import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent Security", () => {
  it("should strip script tags", () => {
    const { container } = render(
      <MarkdownContent>{"<script>alert(1)</script>"}</MarkdownContent>
    );
    expect(container.innerHTML).not.toContain("script");
    expect(container.innerHTML).not.toContain("alert(1)");
  });

  it("should strip javascript URLs", () => {
    const { container } = render(
      <MarkdownContent>{"[Click me](javascript:alert('xss'))"}</MarkdownContent>
    );
    const link = container.querySelector("a");
    expect(link).toBeNull();
    // unsafe link should degrade to plain text, not clickable
    expect(container.textContent).toContain("Click me");
  });

  it("should strip iframes", () => {
    const { container } = render(
      <MarkdownContent>{"<iframe src=\"javascript:alert(1)\"></iframe>"}</MarkdownContent>
    );
    expect(container.innerHTML).not.toContain("iframe");
  });

  it("should strip event handlers and style attributes", () => {
    const { container } = render(
      <MarkdownContent>{'<img src="https://example.com/x.png" onerror="alert(1)" style="position:fixed;top:0"/>'}</MarkdownContent>
    );
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.innerHTML).not.toContain("style");
    // for raw HTML img with https src, event handler should be stripped but img stays if safe
    // our sanitize downgrades to safe img without handlers
  });

  it("should strip svg and object tags", () => {
    const { container } = render(
      <MarkdownContent>{"<svg onload=\"alert(1)\"><circle r=\"10\"/></svg> <object data=\"javascript:alert(1)\"></object>"}</MarkdownContent>
    );
    expect(container.innerHTML).not.toContain("<svg");
    expect(container.innerHTML).not.toContain("<object");
    expect(container.innerHTML).not.toContain("onload");
  });

  it("should block data: image URLs", () => {
    const { container } = render(
      <MarkdownContent>{"![x](data:image/png;base64,abc)"}</MarkdownContent>
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("image removed");
  });

  it("should block http images (https-only policy)", () => {
    const { container } = render(
      <MarkdownContent>{"![x](http://example.com/img.png)"}</MarkdownContent>
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("should render regular links with target _blank and rel noopener noreferrer and external indicator", () => {
    const { container } = render(
      <MarkdownContent>{"[Google](https://google.com)"}</MarkdownContent>
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://google.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("title")).toContain("opens in new tab");
    expect(link?.innerHTML).toContain("↗");
  });

  it("should render images correctly with lazy loading and constraint", () => {
    const { container } = render(
      <MarkdownContent>{"![Alt text](https://example.com/image.png)"}</MarkdownContent>
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/image.png");
    expect(img?.getAttribute("alt")).toBe("Alt text");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("should render long content correctly without breaking (word-break & truncation)", () => {
    const longText = "a".repeat(25000); // exceeds 20k truncate
    const { container } = render(
      <MarkdownContent>{longText}</MarkdownContent>
    );
    // should be truncated to MAX_PREVIEW_LENGTH
    expect(container.textContent!.length).toBeLessThanOrEqual(20000 + 100); // allow small wrapper
    expect(container.querySelector('[data-testid="markdown-content"]')?.className).toContain("break-words");
  });

  it("should render GFM tables without layout breakage (overflow wrapper)", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const { container } = render(<MarkdownContent>{md}</MarkdownContent>);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector('[data-testid="markdown-content"]')?.className).toContain("overflow-x-auto");
  });

  it("should escape phishing-like link with encoded javascript", () => {
    const { container } = render(
      <MarkdownContent>{"[Click](javascript&#58;alert(1))"}</MarkdownContent>
    );
    expect(container.querySelector("a")).toBeNull();
  });

  it("should downgrade h4-h6 for layout stability", () => {
    const { container } = render(<MarkdownContent>{"#### H4\n##### H5\n###### H6"}</MarkdownContent>);
    // h4-h6 are either stripped (allowlist h1-h3 only) or downgraded to h3 — either way no raw h4-6 in DOM
    expect(container.querySelector("h4")).toBeNull();
    expect(container.querySelector("h5")).toBeNull();
    expect(container.querySelector("h6")).toBeNull();
    // content should still be present as text
    expect(container.textContent).toContain("H4");
    expect(container.textContent).toContain("H5");
    expect(container.textContent).toContain("H6");
  });
});
