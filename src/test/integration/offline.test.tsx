import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineBanner } from "../../components/OfflineBanner";

describe("Offline mode behavior", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not show offline banner when online", () => {
    render(<OfflineBanner />);
    expect(screen.queryByText(/You are currently offline/i)).not.toBeInTheDocument();
  });

  it("shows offline banner when network drops and recovers", async () => {
    render(<OfflineBanner />);
    
    // Simulate going offline
    act(() => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    
    expect(screen.getByText(/You are currently offline/i)).toBeInTheDocument();
    
    // Simulate recovery
    act(() => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    
    expect(screen.queryByText(/You are currently offline/i)).not.toBeInTheDocument();
  });
});
