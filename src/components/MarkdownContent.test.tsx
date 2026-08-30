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
  });

  it("should strip iframes", () => {
    const { container } = render(
      <MarkdownContent>{"<iframe src=\"javascript:alert(1)\"></iframe>"}</MarkdownContent>
    );
    expect(container.innerHTML).not.toContain("iframe");
  });

  it("should render regular links with target _blank and rel noopener noreferrer", () => {
    const { container } = render(
      <MarkdownContent>{"[Google](https://google.com)"}</MarkdownContent>
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://google.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("should render images correctly", () => {
    const { container } = render(
      <MarkdownContent>{"![Alt text](https://example.com/image.png)"}</MarkdownContent>
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/image.png");
    expect(img?.getAttribute("alt")).toBe("Alt text");
  });

  it("should render long content correctly without breaking", () => {
    const longText = "a".repeat(10000);
    const { container } = render(
      <MarkdownContent>{longText}</MarkdownContent>
    );
    expect(container.textContent).toContain(longText);
  });
});
