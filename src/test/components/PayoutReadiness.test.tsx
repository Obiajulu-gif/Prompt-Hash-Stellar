/**
 * Tests for PayoutReadiness components
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../render";
import { PayoutReadinessBanner } from "@/components/sell/PayoutReadinessBanner";
import { PayoutReadinessChecklist } from "@/components/sell/PayoutReadinessChecklist";
import type { PayoutReadinessResult } from "@/lib/validation/payoutReadiness";

// Mock the usePayoutReadiness hook
vi.mock("@/hooks/usePayoutReadiness");
import { usePayoutReadiness } from "@/hooks/usePayoutReadiness";
const mockUsePayoutReadiness = vi.mocked(usePayoutReadiness);

// Mock React Router
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    Link: ({ to, children, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

describe("PayoutReadinessBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not render when loading", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: null,
      isLoading: true,
      isReady: false,
      shouldBlock: true,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessBanner />);
    
    expect(screen.queryByText(/payout setup/i)).not.toBeInTheDocument();
  });

  it("should not render when readiness check fails", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: null,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessBanner />);
    
    expect(screen.queryByText(/payout setup/i)).not.toBeInTheDocument();
  });

  it("should not render when ready and showWhenReady is false", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: true,
        checks: [],
        blockers: [],
        warnings: [],
      },
      isLoading: false,
      isReady: true,
      shouldBlock: false,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessBanner showWhenReady={false} />);
    
    expect(screen.queryByText(/payout setup/i)).not.toBeInTheDocument();
  });

  it("should render success state when ready", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: true,
        checks: [],
        blockers: [],
        warnings: [],
      },
      isLoading: false,
      isReady: true,
      shouldBlock: false,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessBanner showWhenReady={true} />);
    
    expect(screen.getByText(/payout setup complete/i)).toBeInTheDocument();
    expect(screen.getByText(/you can now publish paid prompts/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create prompt/i })).toBeInTheDocument();
  });

  it("should render blocking state when not ready", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: false,
        checks: [],
        blockers: ["Complete your profile", "Set up payout address"],
        warnings: [],
      },
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: ["Complete your profile", "Set up payout address"],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessBanner />);
    
    expect(screen.getByText(/payout setup required/i)).toBeInTheDocument();
    expect(screen.getByText(/2 issues blocking paid publication/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fix setup/i })).toBeInTheDocument();
  });

  it("should render warning state when ready with warnings", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: true,
        checks: [],
        blockers: [],
        warnings: ["Consider adding avatar"],
      },
      isLoading: false,
      isReady: true,
      shouldBlock: false,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessBanner />);
    
    expect(screen.getByText(/payout setup needs attention/i)).toBeInTheDocument();
    expect(screen.getByText(/1 recommendation for better setup/i)).toBeInTheDocument();
  });

  it("should show blocking issues when there are few blockers", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: false,
        checks: [],
        blockers: ["Complete your profile"],
        warnings: [],
      },
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: ["Complete your profile"],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessBanner />);
    
    expect(screen.getByText("Complete your profile")).toBeInTheDocument();
  });
});

describe("PayoutReadinessChecklist", () => {
  const mockReadinessResult: PayoutReadinessResult = {
    isReady: false,
    checks: [
      {
        id: "wallet-connection",
        name: "Wallet Connection",
        description: "Valid Stellar wallet must be connected",
        status: "pass",
        message: "Wallet connected successfully",
      },
      {
        id: "payout-destination",
        name: "Payout Destination",
        description: "Configured address where earnings will be sent",
        status: "fail",
        message: "Set up your payout address to receive earnings",
        actionUrl: "/profile/payout-settings",
        actionText: "Configure Payout",
      },
      {
        id: "creator-profile",
        name: "Creator Profile",
        description: "Complete profile builds buyer trust",
        status: "warn",
        message: "Consider adding profile picture and social links",
      },
    ],
    blockers: ["Set up your payout address to receive earnings"],
    warnings: ["Consider adding profile picture and social links"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render loading state", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: null,
      isLoading: true,
      isReady: false,
      shouldBlock: true,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    expect(screen.getByText(/checking payout readiness/i)).toBeInTheDocument();
  });

  it("should render error state when readiness is null", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: null,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    expect(screen.getByText(/unable to check payout readiness/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("should render checklist with all check statuses", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    // Check that all checks are rendered
    expect(screen.getByText("Wallet Connection")).toBeInTheDocument();
    expect(screen.getByText("Payout Destination")).toBeInTheDocument();
    expect(screen.getByText("Creator Profile")).toBeInTheDocument();

    // Check status indicators
    expect(screen.getByText("Complete")).toBeInTheDocument(); // Wallet connection
    expect(screen.getByText("Required")).toBeInTheDocument(); // Payout destination
    expect(screen.getByText("Attention")).toBeInTheDocument(); // Creator profile

    // Check messages
    expect(screen.getByText("Wallet connected successfully")).toBeInTheDocument();
    expect(screen.getByText("Set up your payout address to receive earnings")).toBeInTheDocument();
    expect(screen.getByText("Consider adding profile picture and social links")).toBeInTheDocument();
  });

  it("should show progress bar with correct percentage", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    // 1 out of 3 checks passed = 33%
    expect(screen.getByText("1 of 3 checks complete")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
  });

  it("should show blocking issues status", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    expect(screen.getByText("1 issue blocking publication")).toBeInTheDocument();
  });

  it("should show ready state when all checks pass", () => {
    const readyResult: PayoutReadinessResult = {
      isReady: true,
      checks: [
        {
          id: "wallet-connection",
          name: "Wallet Connection",
          description: "Valid Stellar wallet must be connected",
          status: "pass",
          message: "Wallet connected successfully",
        },
      ],
      blockers: [],
      warnings: [],
    };

    mockUsePayoutReadiness.mockReturnValue({
      readiness: readyResult,
      isLoading: false,
      isReady: true,
      shouldBlock: false,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    expect(screen.getByText("Ready to publish paid prompts!")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("should expand check details when clicked", async () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    // Find expandable check (one with description)
    const expandButton = screen.getAllByRole("button", { name: /expand details/i })[0];
    fireEvent.click(expandButton);
    
    // Should show description
    expect(screen.getByText("Valid Stellar wallet must be connected")).toBeInTheDocument();
  });

  it("should render action links for checks with actions", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    // Expand the payout destination check to see action
    const expandButtons = screen.getAllByRole("button", { name: /expand details/i });
    fireEvent.click(expandButtons[1]); // Payout destination check
    
    expect(screen.getByRole("link", { name: /configure payout/i })).toBeInTheDocument();
  });

  it("should call refresh when refresh button is clicked", async () => {
    const mockRefresh = vi.fn();
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: mockRefresh,
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refreshButton);
    
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("should show help links when not ready", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist />);
    
    expect(screen.getByRole("link", { name: /manage profile/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /payout settings/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /get xlm/i })).toBeInTheDocument();
  });

  it("should hide title when showTitle is false", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<PayoutReadinessChecklist showTitle={false} />);
    
    expect(screen.queryByText("Payout Readiness")).not.toBeInTheDocument();
  });

  it("should call onRefresh when provided", () => {
    const mockOnRefresh = vi.fn();
    const mockRefresh = vi.fn();
    
    mockUsePayoutReadiness.mockReturnValue({
      readiness: mockReadinessResult,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: mockReadinessResult.blockers,
      refreshReadiness: mockRefresh,
    });

    renderWithProviders(<PayoutReadinessChecklist onRefresh={mockOnRefresh} />);
    
    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refreshButton);
    
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockOnRefresh).toHaveBeenCalledTimes(1);
  });
});