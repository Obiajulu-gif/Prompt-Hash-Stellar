import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EntitlementStatusPanel } from "./EntitlementStatusPanel";
import { deriveEntitlementState } from "@/lib/prompts/entitlementStatus";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/stellar/browserConfig", () => ({
  browserStellarConfig: {
    networkPassphrase: "Test SDF Network ; September 2015",
  },
}));

describe("EntitlementStatusPanel — issue #490", () => {
  it("renders the active state with transaction and licence version references", () => {
    const descriptor = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "ready",
      unlockState: "success",
    });

    renderWithProviders(
      <EntitlementStatusPanel
        descriptor={descriptor}
        transactionHash="tx-hash-abcdef1234567890"
        licenceVersion={3}
      />,
    );

    const panel = screen.getByTestId("entitlement-status-panel");
    expect(panel).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("tx-hash-abcdef1234567890"),
    );
  });

  it("renders the pending state visually distinct from a failure, with no transaction available yet", () => {
    const descriptor = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "pending",
      unlockState: "idle",
    });

    renderWithProviders(
      <EntitlementStatusPanel descriptor={descriptor} onRetryReference={vi.fn()} />,
    );

    expect(screen.getByTestId("entitlement-status-panel")).toHaveAttribute(
      "data-state",
      "pending",
    );
    expect(screen.getByText("Pending indexing")).toBeInTheDocument();
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
    // Reassures the buyer this is a delay, not a failure — the panel must
    // never look like an error state while indexing is merely catching up.
    expect(screen.getByText(/not a failed purchase/i)).toBeInTheDocument();
    expect(screen.queryByText(/verification failed/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /check indexing again/i }),
    ).toBeInTheDocument();
  });

  it("renders the unavailable state for a delisted prompt", () => {
    const descriptor = deriveEntitlementState({
      listingActive: false,
      referenceStatus: "ready",
      unlockState: "idle",
    });

    renderWithProviders(<EntitlementStatusPanel descriptor={descriptor} />);

    expect(screen.getByTestId("entitlement-status-panel")).toHaveAttribute(
      "data-state",
      "unavailable",
    );
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/delisted/i)).toBeInTheDocument();
    // No retry action makes sense for a delisted listing.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the verification-needed state and wires the retry action", async () => {
    const user = userEvent.setup();
    const onRetryVerification = vi.fn();
    const descriptor = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "ready",
      unlockState: "failed",
    });

    renderWithProviders(
      <EntitlementStatusPanel
        descriptor={descriptor}
        onRetryVerification={onRetryVerification}
      />,
    );

    expect(screen.getByTestId("entitlement-status-panel")).toHaveAttribute(
      "data-state",
      "verification_needed",
    );
    expect(screen.getByText("Verification needed")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", {
      name: /retry verification/i,
    });
    await user.click(retryButton);
    expect(onRetryVerification).toHaveBeenCalledTimes(1);
  });

  it("does not show a verification retry button while signature verification is already in progress", () => {
    const descriptor = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "ready",
      unlockState: "verifying",
    });

    renderWithProviders(
      <EntitlementStatusPanel
        descriptor={descriptor}
        onRetryVerification={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /retry verification/i }),
    ).not.toBeInTheDocument();
  });
});
