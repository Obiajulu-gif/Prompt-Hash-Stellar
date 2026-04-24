import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DisplayWallet from "@/components/DisplayWallet";
import NetworkPill from "@/components/NetworkPill";
import { connectWallet } from "@/util/wallet";
import { renderWithProviders } from "@/test/render";

const { useWalletBalanceMock } = vi.hoisted(() => ({
  useWalletBalanceMock: vi.fn(),
}));

vi.mock("@/hooks/useWalletBalance", () => ({
  useWalletBalance: () => useWalletBalanceMock(),
}));

vi.mock("@stellar/design-system", () => ({
  Icon: {
    Circle: ({ color }: { color: string }) => (
      <span data-testid="network-indicator" data-color={color} />
    ),
  },
}));

vi.mock("@/lib/env", () => ({
  stellarNetwork: "TESTNET",
}));

describe("wallet integration coverage", () => {
  it("renders the disconnected wallet CTA and opens the wallet connection flow", async () => {
    useWalletBalanceMock.mockReturnValue({
      xlm: "-",
      isLoading: false,
    });

    renderWithProviders(<DisplayWallet />);

    await userEvent.click(screen.getByRole("button", { name: /connect wallet/i }));

    expect(connectWallet).toHaveBeenCalledTimes(1);
  });

  it("surfaces wrong-network handling when the connected wallet is on a different network", () => {
    useWalletBalanceMock.mockReturnValue({
      xlm: "42",
      isLoading: false,
    });

    renderWithProviders(<NetworkPill />, {
      wallet: {
        address: "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789",
        network: "PUBLIC",
      },
    });

    expect(screen.getByText("Testnet")).toHaveAttribute(
      "title",
      "Wallet is on Public, connect to Testnet instead.",
    );
  });
});
