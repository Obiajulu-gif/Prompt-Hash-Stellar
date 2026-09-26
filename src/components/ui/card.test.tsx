import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";
import { renderWithProviders } from "@/test/render";

describe("Card", () => {
  it("renders a card container", () => {
    const { container } = renderWithProviders(<Card />);
    const card = container.firstChild as HTMLElement;
    expect(card.tagName).toBe("DIV");
    expect(card.className).toContain("rounded-xl");
  });

  it("applies custom className", () => {
    const { container } = renderWithProviders(<Card className="my-card" />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("my-card");
  });

  it("forwards ref correctly", () => {
    const ref = { current: null };
    renderWithProviders(<Card ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe("CardHeader", () => {
  it("renders with correct layout classes", () => {
    const { container } = renderWithProviders(<CardHeader />);
    const header = container.firstChild as HTMLElement;
    expect(header.className).toContain("flex");
    expect(header.className).toContain("flex-col");
    expect(header.className).toContain("p-6");
  });
});

describe("CardTitle", () => {
  it("renders with font-semibold", () => {
    const { container } = renderWithProviders(<CardTitle />);
    const title = container.firstChild as HTMLElement;
    expect(title.className).toContain("font-semibold");
  });

  it("renders text content", () => {
    renderWithProviders(<CardTitle>My Title</CardTitle>);
    expect(screen.getByText("My Title")).toBeInTheDocument();
  });
});

describe("CardDescription", () => {
  it("renders with text-sm class", () => {
    const { container } = renderWithProviders(<CardDescription />);
    const desc = container.firstChild as HTMLElement;
    expect(desc.className).toContain("text-sm");
  });

  it("renders text content", () => {
    renderWithProviders(<CardDescription>Description text</CardDescription>);
    expect(screen.getByText("Description text")).toBeInTheDocument();
  });
});

describe("CardContent", () => {
  it("renders with p-6 pt-0 class", () => {
    const { container } = renderWithProviders(<CardContent />);
    const content = container.firstChild as HTMLElement;
    expect(content.className).toContain("p-6");
    expect(content.className).toContain("pt-0");
  });
});

describe("CardFooter", () => {
  it("renders with flex and items-center classes", () => {
    const { container } = renderWithProviders(<CardFooter />);
    const footer = container.firstChild as HTMLElement;
    expect(footer.className).toContain("flex");
    expect(footer.className).toContain("items-center");
  });
});
