import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { renderWithProviders } from "@/test/render";

describe("Badge", () => {
  it("renders with default variant", () => {
    renderWithProviders(<Badge>Test Badge</Badge>);
    const badge = screen.getByText("Test Badge");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-primary");
  });

  it("renders with secondary variant", () => {
    renderWithProviders(<Badge variant="secondary">Secondary</Badge>);
    const badge = screen.getByText("Secondary");
    expect(badge.className).toContain("bg-secondary");
  });

  it("renders with destructive variant", () => {
    renderWithProviders(<Badge variant="destructive">Error</Badge>);
    const badge = screen.getByText("Error");
    expect(badge.className).toContain("bg-destructive");
  });

  it("renders with outline variant", () => {
    renderWithProviders(<Badge variant="outline">Outline</Badge>);
    const badge = screen.getByText("Outline");
    expect(badge.className).toContain("text-foreground");
  });

  it("applies custom className", () => {
    renderWithProviders(<Badge className="custom-badge">Custom</Badge>);
    const badge = screen.getByText("Custom");
    expect(badge.className).toContain("custom-badge");
  });
});
