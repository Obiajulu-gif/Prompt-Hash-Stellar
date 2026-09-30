import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { renderWithProviders } from "@/test/render";
import { Button } from "@/components/ui/button";

describe("EmptyState", () => {
  it("renders title and description", () => {
    renderWithProviders(
      <EmptyState
        title="No items found"
        description="Try adjusting your filters"
      />,
    );
    expect(screen.getByText("No items found")).toBeInTheDocument();
    expect(screen.getByText("Try adjusting your filters")).toBeInTheDocument();
  });

  it("renders action button when provided", () => {
    renderWithProviders(
      <EmptyState
        title="Empty"
        description="Nothing here"
        action={<Button>Take Action</Button>}
      />,
    );
    expect(screen.getByRole("button", { name: /take action/i })).toBeInTheDocument();
  });

  it("does not render action area when no action provided", () => {
    const { container } = renderWithProviders(
      <EmptyState title="Empty" description="Nothing here" />,
    );
    const actionArea = container.querySelector(".mt-4");
    expect(actionArea).not.toBeInTheDocument();
  });

  it("renders with custom className on container", () => {
    const { container } = renderWithProviders(
      <EmptyState title="Title" description="Desc" />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("flex");
    expect(wrapper.className).toContain("flex-col");
  });

  it("renders title with correct heading level", () => {
    renderWithProviders(
      <EmptyState title="My Title" description="My Description" />,
    );
    const heading = screen.getByRole("heading", { name: /my title/i });
    expect(heading.tagName).toBe("H3");
  });
});
