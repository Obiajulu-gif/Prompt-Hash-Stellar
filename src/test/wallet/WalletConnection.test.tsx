import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../render";
import { WalletButton } from "@/components/WalletButton";
import type { WalletContextType } from "@/providers/WalletProvider";

describe("Wallet Connection States", () => {
  it("shows connect button when wallet is disconnected", () => {
    const mockWallet: Partial<WalletContextType> = {
      address: undefined,
      status: "idle",
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    renderWithProviders(<WalletButton />, { wallet: mockWallet });

    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.getByText(/connect/i)).toBeInTheDocument();
  });

  it("shows connecting state during wallet connection", () => {
    const mockWallet: Partial<WalletContextType> = {
      address: undefined,
      status: "connecting",
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    renderWithProviders(<WalletButton />, { wallet: mockWallet });

    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it("shows connected wallet address when wallet is connected", () => {
    const mockAddress = "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    const mockWallet: Partial<WalletContextType> = {
      address: mockAddress,
      status: "connected",
      network: "TESTNET",
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    renderWithProviders(<WalletButton />, { wallet: mockWallet });

    // Should show truncated address
    expect(screen.getByText(/GCTEST/i)).toBeInTheDocument();
  });

  it("calls connect function when connect button is clicked", async () => {
    const user = userEvent.setup();
    const mockConnect = vi.fn();
    const mockWallet: Partial<WalletContextType> = {
      address: undefined,
      status: "idle",
      connect: mockConnect,
      disconnect: vi.fn(),
    };

    renderWithProviders(<WalletButton />, { wallet: mockWallet });

    const connectButton = screen.getByRole("button");
    await user.click(connectButton);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  it("shows error state when wallet connection fails", () => {
    const mockWallet: Partial<WalletContextType> = {
      address: undefined,
      status: "error",
      error: "Failed to connect wallet",
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    renderWithProviders(<WalletButton />, { wallet: mockWallet });

    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it("shows reconnecting state when wallet is reconnecting", () => {
    const mockWallet: Partial<WalletContextType> = {
      address: undefined,
      status: "reconnecting",
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    renderWithProviders(<WalletButton />, { wallet: mockWallet });

    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });
});
