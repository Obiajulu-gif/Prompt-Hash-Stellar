import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a div element", () => {
    renderWithProviders(<Skeleton />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toBeInTheDocument();
  });

  it("has animate-pulse class", () => {
    renderWithProviders(<Skeleton />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass("animate-pulse");
  });

  it("has rounded-md class", () => {
    renderWithProviders(<Skeleton />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass("rounded-md");
  });

  it("applies custom className", () => {
    renderWithProviders(<Skeleton className="custom-skeleton" />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass("custom-skeleton");
  });

  it("has aria-hidden attribute", () => {
    renderWithProviders(<Skeleton />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
  });

  it("has default background classes", () => {
    renderWithProviders(<Skeleton />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass("bg-slate-800/50");
    expect(skeleton).toHaveClass("border");
    expect(skeleton).toHaveClass("border-white/5");
  });

  it("spreads additional props", () => {
    renderWithProviders(<Skeleton data-testid="custom-skeleton" />);
    const skeleton = screen.getByTestId("custom-skeleton");
    expect(skeleton).toBeInTheDocument();
  });

  it("renders with custom dimensions", () => {
    renderWithProviders(<Skeleton className="h-10 w-10" />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass("h-10", "w-10");
  });
});
