/**
 * Integration tests for the CreatePromptForm session guards (#680):
 * a draft bound to a different wallet or network must never be publishable
 * from the current session, and adopting it must resume editing safely.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../render";
import { CreatePromptForm } from "@/pages/sell/CreatePromptForm";
import {
  getDraftStorageKey,
  type DraftMeta,
} from "@/hooks/useDraftAutoSave";

vi.mock("@/hooks/usePayoutReadiness");
vi.mock("@/lib/env", () => ({
  unlockPublicKey: "mock-unlock-public-key",
  stellarWalletNetwork: "Public Global Stellar Network ; September 2015",
  stellarNetwork: "TESTNET",
}));
vi.mock("@/lib/stellar/browserConfig", () => ({
  browserStellarConfig: {
    promptHashContractId: "mock-contract-id",
  },
}));
vi.mock("@/lib/stellar/promptHashClient", () => ({
  PromptHashClient: { createPrompt: vi.fn() },
  findPromptByContentHash: vi.fn(),
  getPrompt: vi.fn(),
}));
vi.mock("@/lib/ipfs", () => ({
  isIpfsUploadConfigured: vi.fn(() => false),
}));
vi.mock("@/components/sell/CreatorOnboarding", () => ({
  CreatorOnboarding: () => <div data-testid="creator-onboarding" />,
}));
vi.mock("@/components/sell/ListingQualityChecklist", () => ({
  ListingQualityChecklist: () => <div data-testid="quality-checklist" />,
  buildChecklistItems: vi.fn().mockReturnValue([]),
}));
vi.mock("@/components/sell/PayoutReadinessBanner", () => ({
  PayoutReadinessBanner: ({ className }: { className?: string }) => (
    <div data-testid="payout-readiness-banner" className={className} />
  ),
}));

import { usePayoutReadiness } from "@/hooks/usePayoutReadiness";

const mockUsePayoutReadiness = vi.mocked(usePayoutReadiness);

const ADDRESS =
  "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
const OTHER_ADDRESS =
  "GOTHERWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

function seedDraft(ownerAddress: string, network: string): void {
  const meta: DraftMeta = {
    savedAt: new Date().toISOString(),
    revision: "seed-revision",
    ownerAddress,
    network,
    formData: {
      imageUrl: "",
      title: "Draft from another context",
      category: "Marketing",
      previewText: "Preview",
      description: "Description",
      fullPrompt: "content",
      priceXlm: "2",
      coCreators: [],
    },
  };
  window.localStorage.setItem(
    getDraftStorageKey(ADDRESS),
    JSON.stringify(meta),
  );
}

describe("CreatePromptForm draft session guards (#680)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
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
  });

  it("blocks publishing a draft owned by another wallet and allows adopting it", async () => {
    seedDraft(OTHER_ADDRESS, TESTNET);

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: ADDRESS, network: PUBLIC, signTransaction: vi.fn() },
    });

    // Guard banner is shown and publishing is blocked.
    expect(
      await screen.findByText(new RegExp(OTHER_ADDRESS)),
    ).toBeInTheDocument();
    expect(screen.getByText(/draft saved under another wallet/i)).toBeInTheDocument();
    const guardedSubmit = screen.getByRole("button", {
      name: /resolve the draft session warning to publish/i,
    });
    expect(guardedSubmit).toBeDisabled();

    // Adopt the draft with this wallet.
    fireEvent.click(
      screen.getByRole("button", { name: /adopt with this wallet/i }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText(/draft saved under another wallet/i),
      ).not.toBeInTheDocument();
    });
    const adoptSubmit = screen.getByRole("button", {
      name: /create prompt listing/i,
    });
    expect(adoptSubmit).toBeEnabled();

    // After typing, the autosave re-stamps the draft under this wallet.
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "My adopted draft" },
    });
    await waitFor(
      () => {
        const stored: DraftMeta = JSON.parse(
          window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
        );
        expect(stored.ownerAddress).toBe(ADDRESS);
      },
      { timeout: 3000 },
    );
  });

  it("blocks publishing a draft saved on a different network and allows continuing", async () => {
    seedDraft(ADDRESS, TESTNET);

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: ADDRESS, network: PUBLIC, signTransaction: vi.fn() },
    });

    expect(
      await screen.findByText(/draft saved on a different network/i),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(TESTNET))).toBeInTheDocument();

    const guardedSubmit = screen.getByRole("button", {
      name: /resolve the draft session warning to publish/i,
    });
    expect(guardedSubmit).toBeDisabled();

    // Continue on the current network: guard clears and publishing resumes.
    fireEvent.click(
      screen.getByRole("button", { name: /continue on this network/i }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText(/draft saved on a different network/i),
      ).not.toBeInTheDocument();
    });
    const continueSubmit = screen.getByRole("button", {
      name: /create prompt listing/i,
    });
    expect(continueSubmit).toBeEnabled();
  });

  it("discards a protected draft from the form and next-save writes to current context", async () => {
    seedDraft(OTHER_ADDRESS, TESTNET);

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: ADDRESS, network: PUBLIC, signTransaction: vi.fn() },
    });

    await screen.findByText(/draft saved under another wallet/i);

    fireEvent.click(
      screen.getByRole("button", { name: /discard draft/i }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText(/draft saved under another wallet/i),
      ).not.toBeInTheDocument();
    });
    expect(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS)),
    ).toBeNull();

    const discardSubmit = screen.getByRole("button", {
      name: /create prompt listing/i,
    });
    expect(discardSubmit).toBeEnabled();
  });
});