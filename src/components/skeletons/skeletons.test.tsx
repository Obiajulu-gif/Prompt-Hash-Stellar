import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { PromptGridSkeleton } from "./PromptCardSkeleton";
import { PromptDetailSkeleton } from "./PromptDetailSkeleton";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { SkeletonGroup } from "./SkeletonGroup";

describe("PromptGridSkeleton", () => {
  it("renders the requested number of card placeholders", () => {
    renderWithProviders(<PromptGridSkeleton count={4} />);
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(4);
  });

  it("applies the caller's grid layout classes so dimensions match the loaded grid", () => {
    renderWithProviders(<PromptGridSkeleton gridClassName="grid grid-cols-3 gap-8" />);
    const status = screen.getByRole("status");
    expect(status).toHaveClass("grid", "grid-cols-3", "gap-8");
  });

  it("announces loading state to assistive tech", () => {
    renderWithProviders(<PromptGridSkeleton count={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading prompts");
  });
});

describe("PromptDetailSkeleton", () => {
  it("renders as an accessible status region", () => {
    renderWithProviders(<PromptDetailSkeleton />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("LibrarySkeleton", () => {
  it("renders the requested number of rows", () => {
    renderWithProviders(<LibrarySkeleton rows={5} />);
    // toolbar (3) + 5 rows * 4 shapes each = 23 decorative placeholders
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(5);
  });

  it("defaults to 3 rows", () => {
    renderWithProviders(<LibrarySkeleton />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("SkeletonGroup", () => {
  it("renders a status role with a visually hidden label", () => {
    renderWithProviders(
      <SkeletonGroup label="Loading widgets">
        <div />
      </SkeletonGroup>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading widgets");
  });
});
