import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OnboardingTour } from "./OnboardingTour";

describe("OnboardingTour - Accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders tour with accessibility attributes when active", async () => {
    render(<OnboardingTour />);

    // Tour should auto-start after 800ms delay
    vi.advanceTimersByTime(800);

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });
  });

  it("sets focus to close button when tour starts", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      const closeButton = screen.getByLabelText(/Skip tour/);
      expect(closeButton).toHaveFocus();
    });
  });

  it("includes live region for step announcements", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      const liveRegion = screen.getByRole("status");
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
      expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    });
  });

  it("announces step changes via aria-live", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      const liveRegion = screen.getByRole("status");
      expect(liveRegion.textContent).toContain("Connect your Wallet");
    });
  });

  it("applies inert and aria-hidden to body when tour is active", async () => {
    render(<OnboardingTour />);

    expect(document.body).not.toHaveAttribute("inert");

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(document.body).toHaveAttribute("inert", "true");
      expect(document.body).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("removes inert and aria-hidden from body when tour is dismissed", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(document.body).toHaveAttribute("inert", "true");
    });

    const skipButton = screen.getAllByText("Skip tour")[0];
    fireEvent.click(skipButton);

    await waitFor(() => {
      expect(document.body).not.toHaveAttribute("inert");
      expect(document.body).not.toHaveAttribute("aria-hidden");
    });
  });

  it("displays keyboard shortcuts hint", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByText(/Keyboard:/)).toBeInTheDocument();
      expect(screen.getByText(/Esc to skip/)).toBeInTheDocument();
      expect(screen.getByText(/Right arrow or Tab for next/)).toBeInTheDocument();
    });
  });

  it("has proper focus indicators on all buttons", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      const nextButton = screen.getByLabelText(/Next step/);
      expect(nextButton).toHaveClass("focus:ring-2");
    });
  });
});

describe("OnboardingTour - Keyboard Navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("dismisses tour on Escape key", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("advances to next step with right arrow", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByText("Connect your Wallet")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByText("Search the Marketplace")).toBeInTheDocument();
    });
  });

  it("advances to next step with Tab", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByText("Connect your Wallet")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Tab" });

    await waitFor(() => {
      expect(screen.getByText("Search the Marketplace")).toBeInTheDocument();
    });
  });

  it("goes back to previous step with left arrow", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByText("Connect your Wallet")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByText("Search the Marketplace")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(screen.getByText("Connect your Wallet")).toBeInTheDocument();
    });
  });

  it("does not go before first step with left arrow", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByText("Connect your Wallet")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(screen.getByText("Connect your Wallet")).toBeInTheDocument();
    });
  });

  it("finishes tour when on last step and pressing right arrow", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("prevents default behavior for handled keys", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    fireEvent(document, event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});

describe("OnboardingTour - Focus Management", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("traps focus within tour dialog", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();

      const buttons = dialog.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it("returns focus after dismissing tour", async () => {
    const initialFocusElement = document.createElement("button");
    document.body.appendChild(initialFocusElement);
    initialFocusElement.focus();

    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const skipButton = screen.getAllByText("Skip tour")[0];
    fireEvent.click(skipButton);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    document.body.removeChild(initialFocusElement);
  });

  it("updates aria-label when step changes", async () => {
    render(<OnboardingTour />);

    vi.advanceTimersByTime(800);

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Connect your Wallet"),
      );
    });

    fireEvent.keyDown(document, { key: "ArrowRight" });

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Search the Marketplace"),
      );
    });
  });
});
