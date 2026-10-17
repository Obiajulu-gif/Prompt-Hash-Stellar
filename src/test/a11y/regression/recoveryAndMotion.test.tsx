/**
 * Accessibility regression: modal error-recovery flows, live-region error
 * announcements, and reduced-motion behaviour.
 */

import { useState } from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibleModal } from "@/components/accessibility/AccessibleModal";
import { AccessibleButton } from "@/components/accessibility/AccessibleButton";
import { LiveRegion, useLiveRegion } from "@/components/accessibility/LiveRegion";
import { PageTransition } from "@/components/animations/PageTransition";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { installLayoutShim, mockReducedMotion } from "./helpers";

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = installLayoutShim();
});
afterEach(() => restoreLayout());

// ─── Modal ───────────────────────────────────────────────────────────────────

function ModalHarness({ onSubmit }: { onSubmit: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const { message, priority, announce, clear } = useLiveRegion();

  async function submit() {
    setBusy(true);
    setFailure("");
    try {
      await onSubmit(reason);
      announce("Dispute submitted", "polite");
      setOpen(false);
    } catch {
      setFailure("Could not submit. Check your connection and try again.");
      announce("Submission failed", "assertive");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}>Open dispute</button>
      {/* Inline onClose + per-keystroke parent re-render mirrors real usage. */}
      <AccessibleModal isOpen={open} onClose={() => setOpen(false)} title="Open a dispute">
        <label htmlFor="reason">Reason</label>
        <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        {failure && (
          <p role="alert" id="reason-failure">
            {failure}
          </p>
        )}
        <AccessibleButton isLoading={busy} loadingLabel="Submitting…" onClick={submit}>
          Submit
        </AccessibleButton>
      </AccessibleModal>
      <LiveRegion message={message} priority={priority} onClear={clear} delay={10_000} />
    </>
  );
}

describe("modal focus management", () => {
  it("exposes dialog semantics with a unique accessible name", async () => {
    const user = userEvent.setup();
    render(<ModalHarness onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open dispute" }));
    const dialog = screen.getByRole("dialog", { name: "Open a dispute" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.getAttribute("aria-labelledby")).not.toBe("modal-title");
  });

  it("moves focus into the dialog on open and restores it to the trigger on Escape", async () => {
    const user = userEvent.setup();
    render(<ModalHarness onSubmit={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Open dispute" });
    await user.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Open a dispute" })).toHaveFocus(),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("traps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<ModalHarness onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open dispute" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Open a dispute" })).toHaveFocus());
    const close = screen.getByRole("button", { name: "Close dialog" });
    const submit = screen.getByRole("button", { name: "Submit" });

    submit.focus();
    await user.tab();
    expect(close).toHaveFocus(); // wrapped from last to first

    await user.tab({ shift: true });
    expect(submit).toHaveFocus(); // wrapped from first to last
  });

  it("keeps focus in the field while the user types (parent re-renders each keystroke)", async () => {
    const user = userEvent.setup();
    render(<ModalHarness onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open dispute" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Open a dispute" })).toHaveFocus());
    const input = screen.getByLabelText("Reason");
    await user.click(input);
    await user.keyboard("not as described");
    // Give any stray focus-reset timers a chance to fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("not as described");
  });
});

describe("error recovery inside a modal", () => {
  it("announces a failure assertively, keeps the dialog open, and allows retry", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(reason: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    render(<ModalHarness onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Open dispute" }));
    await user.type(screen.getByLabelText("Reason"), "broken");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText(/could not submit/i)).toBeInTheDocument();
    // role=alert inline error AND an assertive live announcement, dialog still open.
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The retry control is enabled again and reachable.
    const retry = screen.getByRole("button", { name: "Submit" });
    expect(retry).toBeEnabled();
    expect(retry).toHaveAttribute("aria-busy", "false");

    await user.click(retry);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Dispute submitted");
  });

  it("disables the submit button and flags it busy while in flight", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    render(<ModalHarness onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Open dispute" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    const busy = screen.getByRole("button", { name: "Submitting…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    await act(async () => release());
  });
});

// ─── Live region ─────────────────────────────────────────────────────────────

describe("LiveRegion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces errors with role=alert and status updates with role=status", () => {
    const { rerender } = render(<LiveRegion message="Payment failed" priority="assertive" />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-atomic", "true");
    rerender(<LiveRegion message="Saved" priority="polite" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is visually hidden but present for assistive technology", () => {
    render(<LiveRegion message="Saved" />);
    expect(screen.getByRole("status")).toHaveClass("sr-only");
  });

  it("clears itself after the delay and notifies the owner", () => {
    const onClear = vi.fn();
    render(<LiveRegion message="Saved" delay={500} onClear={onClear} />);
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("renders nothing for an empty message", () => {
    const { container } = render(<LiveRegion message="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("useLiveRegion tracks the priority of the latest announcement", () => {
    const { result } = renderHook(() => useLiveRegion());
    act(() => result.current.announce("Boom", "assertive"));
    expect(result.current.priority).toBe("assertive");
    expect(result.current.message).toBe("Boom");
    act(() => result.current.announce("Fine"));
    expect(result.current.priority).toBe("polite");
    act(() => result.current.clear());
    expect(result.current.message).toBe("");
  });
});

// ─── Reduced motion ──────────────────────────────────────────────────────────

describe("reduced motion", () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("useReducedMotion reflects the media query at mount", () => {
    mockReducedMotion(true);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
    mockReducedMotion(false);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });

  it("useReducedMotion reacts when the user flips the OS setting at runtime", () => {
    const media = mockReducedMotion(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => media.set(true));
    expect(result.current).toBe(true);
    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it("useReducedMotion removes its listener on unmount", () => {
    const media = mockReducedMotion(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("PageTransition renders children with no animated wrapper when reduced motion is on", () => {
    mockReducedMotion(true);
    const { container } = render(
      <MemoryRouter>
        <PageTransition>
          <p data-testid="page">Page</p>
        </PageTransition>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("page").parentElement).toBe(container);
  });

  it("PageTransition animates (wraps children) when reduced motion is off", () => {
    mockReducedMotion(false);
    const { container } = render(
      <MemoryRouter>
        <PageTransition>
          <p data-testid="page">Page</p>
        </PageTransition>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("page").parentElement).not.toBe(container);
  });

  it("ships a global prefers-reduced-motion rule that neutralises CSS animation", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation-duration: 0.01ms !important");
    expect(block).toContain("transition-duration: 0.01ms !important");
    expect(block).toContain("scroll-behavior: auto !important");
  });
});
