/**
 * Accessibility regression: async error recovery on production components
 * (#1134). recoveryAndMotion.test.tsx covers the generic modal pattern with a
 * harness; this file exercises the shipped error banners and retry controls:
 *
 *   - UnlockErrorBanner (PromptModal unlock flow)
 *   - TransactionFeedbackProvider live region
 *   - TransactionErrorBanner
 *   - TransactionRetryButton
 *
 * Covers the normal (announce + retry), failure (retry fails again), retry
 * (focus kept/restored), and authorization (non-retryable access errors) paths.
 */

import { useRef, useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { UnlockErrorBanner } from "@/components/UnlockErrorBanner";
import { TransactionFeedbackProvider } from "@/components/transaction-feedback/TransactionFeedbackProvider";
import { TransactionErrorBanner } from "@/components/transaction-feedback/TransactionErrorBanner";
import { TransactionRetryButton } from "@/components/transaction-feedback/TransactionRetryButton";
import { useTransactionFeedback } from "@/components/transaction-feedback/useTransactionFeedback";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

// ─── UnlockErrorBanner ───────────────────────────────────────────────────────

describe("UnlockErrorBanner", () => {
  it("announces the failure assertively as one atomic message", () => {
    render(<UnlockErrorBanner error={{ code: "TEMPORARY_FAILURE", message: "fallback" }} onRetry={vi.fn()} />);
    const alert = screen.getByRole("alert");
    // role=alert is implicitly assertive; a polite override would delay it.
    expect(alert).not.toHaveAttribute("aria-live", "polite");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toHaveTextContent("Temporary error");
  });

  it("exposes a keyboard-operable retry control described by the error", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<UnlockErrorBanner error={{ code: "RATE_LIMIT_WALLET", message: "x" }} onRetry={onRetry} />);

    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toHaveAccessibleDescription(/too many unlock attempts for this wallet/i);

    await user.tab();
    expect(retry).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("retry does not submit an enclosing form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onRetry = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <UnlockErrorBanner error={{ code: "NETWORK_ERROR", message: "offline" }} onRetry={onRetry} />
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("includes the support reference inside the announced alert", () => {
    render(
      <UnlockErrorBanner
        error={{ code: "INTERNAL_ERROR", message: "x", correlationId: "corr-123" }}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("corr-123");
  });

  it.each(["UNAUTHORIZED", "ACCESS_NOT_PURCHASED"])(
    "authorization failure %s offers support instead of a futile retry",
    (code) => {
      render(<UnlockErrorBanner error={{ code, message: "x" }} onRetry={vi.fn()} />);
      const alert = screen.getByRole("alert");
      expect(within(alert).queryByRole("button")).toBeNull();
      expect(alert).toHaveTextContent("Access denied");
      expect(alert).toHaveTextContent("Contact support");
    },
  );

  it("decorative icons are hidden from assistive technology", () => {
    const { container } = render(<UnlockErrorBanner error={{ code: "INVALID_SIGNATURE", message: "x" }} onRetry={vi.fn()} />);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("falls back to a plain message without losing alert semantics", () => {
    render(<UnlockErrorBanner message="Wallet signature was rejected" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Wallet signature was rejected");
    expect(screen.getByRole("alert")).toHaveTextContent("Wallet issue");
  });
});

// ─── Transaction feedback: provider + banner ─────────────────────────────────

function PurchaseHarness({ attempt }: { attempt: () => Promise<void> }) {
  const { setStatus, setError } = useTransactionFeedback();
  const buyRef = useRef<HTMLButtonElement>(null);

  async function buy() {
    setStatus("pending");
    try {
      await attempt();
      setStatus("success");
    } catch {
      setError("Purchase failed. Your funds were not moved.");
      setStatus("error");
    }
  }

  return (
    <>
      <TransactionErrorBanner onRetry={buy} focusAfterRetry={buyRef} />
      <button ref={buyRef} type="button" onClick={buy}>
        Buy prompt
      </button>
    </>
  );
}

const liveRegion = () => document.querySelector<HTMLElement>('[aria-live="polite"][aria-atomic="true"]')!;

describe("TransactionFeedbackProvider + TransactionErrorBanner", () => {
  it("announces pending, then the error, through a persistent polite live region", async () => {
    const user = userEvent.setup();
    let reject!: (_error: Error) => void;
    const attempt = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
    render(
      <TransactionFeedbackProvider>
        <PurchaseHarness attempt={attempt} />
      </TransactionFeedbackProvider>,
    );

    const region = liveRegion();
    expect(region).toHaveClass("sr-only");
    await user.click(screen.getByRole("button", { name: "Buy prompt" }));
    expect(region).toHaveTextContent("Transaction in progress.");

    await act(async () => reject(new Error("rpc timeout")));
    // The live region node itself persists, so screen readers keep observing it.
    expect(liveRegion()).toBe(region);
    expect(region).toHaveTextContent("Purchase failed. Your funds were not moved.");
    expect(screen.getByRole("alert")).toHaveTextContent("Purchase failed");
  });

  it("retry clears the error and moves focus to a stable control instead of <body>", async () => {
    const user = userEvent.setup();
    const attempt = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(undefined);
    render(
      <TransactionFeedbackProvider>
        <PurchaseHarness attempt={attempt} />
      </TransactionFeedbackProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Buy prompt" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    retry.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Buy prompt" })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(await screen.findByText("Transaction successful.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("a retry that fails again re-renders the alert so the new failure is announced", async () => {
    const user = userEvent.setup();
    const attempt = vi.fn().mockRejectedValue(new Error("still down"));
    render(
      <TransactionFeedbackProvider>
        <PurchaseHarness attempt={attempt} />
      </TransactionFeedbackProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Buy prompt" }));
    const firstAlert = await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    const secondAlert = await screen.findByRole("alert");
    // clear() unmounts the banner, so the retry failure inserts a fresh alert
    // node — screen readers announce insertions, not unchanged text.
    expect(secondAlert).not.toBe(firstAlert);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("renders nothing (no empty alert) when there is no error", () => {
    render(
      <TransactionFeedbackProvider>
        <TransactionErrorBanner onRetry={vi.fn()} />
      </TransactionFeedbackProvider>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ─── TransactionRetryButton ──────────────────────────────────────────────────

function RetryHarness({ onRetry }: { onRetry: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  return (
    <TransactionRetryButton
      loading={loading}
      onRetry={() => {
        setLoading(true);
        onRetry().finally(() => setLoading(false));
      }}
    />
  );
}

describe("TransactionRetryButton", () => {
  it("keeps keyboard focus while the retry is in flight and after it settles", async () => {
    const user = userEvent.setup();
    let settle!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    render(<RetryHarness onRetry={onRetry} />);

    await user.tab();
    await user.keyboard("{Enter}");

    const busy = screen.getByRole("button", { name: "Retrying..." });
    expect(busy).toHaveFocus();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveAttribute("aria-busy", "true");

    // Repeated activation while busy must not start a second attempt.
    await user.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledOnce();

    await act(async () => settle());
    const idle = screen.getByRole("button", { name: "Retry" });
    expect(idle).toHaveFocus();
    expect(idle).toHaveAttribute("aria-disabled", "false");
    expect(idle).toHaveAttribute("type", "button");
  });
});
