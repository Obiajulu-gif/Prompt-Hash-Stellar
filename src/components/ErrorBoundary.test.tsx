import { screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error message");
  }
  return <div>Child content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    renderWithProviders(
      <ErrorBoundary>
        <div>No error here</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("No error here")).toBeInTheDocument();
  });

  it("renders error UI when child throws", () => {
    renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Oops, something went wrong.")).toBeInTheDocument();
  });

  it("displays error message", () => {
    renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("renders reload button", () => {
    renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
  });

  it("calls window.location.reload when reload button is clicked", () => {
    const mockReload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload: mockReload },
      writable: true,
    });

    renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole("button", { name: /reload page/i }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("does not render error UI when no error", () => {
    renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.queryByText("Oops, something went wrong.")).not.toBeInTheDocument();
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("catches errors from deeply nested children", () => {
    renderWithProviders(
      <ErrorBoundary>
        <div>
          <div>
            <ThrowingComponent />
          </div>
        </div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Oops, something went wrong.")).toBeInTheDocument();
  });
});
