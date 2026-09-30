import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptCard } from "./PromptCard";
import { renderWithProviders } from "@/test/render";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";

const mockPrompt = (overrides: Partial<PromptRecord> = {}): PromptRecord => ({
  id: 1n,
  creator: "GCREATORXXXXXXXXXXXXXX",
  priceStroops: 50000000n, // 5 XLM
  title: "Test AI Prompt Generator",
  category: "Development",
  previewText: "A useful preview text",
  imageUrl: "",
  salesCount: 5,
  active: true,
  contentHash: "mockhash123",
  ...overrides,
});

describe("PromptCard Badges & Price Rendering", () => {
  const defaultProps = {
    prompt: mockPrompt(),
    hasAccess: false,
    openModal: vi.fn(),
    isSaved: false,
    isSaving: false,
    onToggleSave: vi.fn(),
  };

  it("renders price clearly in XLM format", () => {
    renderWithProviders(<PromptCard {...defaultProps} />);
    const priceLabel = screen.getByTestId("price-label");
    expect(priceLabel).toBeInTheDocument();
    expect(priceLabel.textContent).toBe("5 XLM");
  });

  it("renders active and unlockable badges when prompt is active and has no access", () => {
    renderWithProviders(<PromptCard {...defaultProps} />);
    
    expect(screen.getByTestId("badge-active")).toBeInTheDocument();
    expect(screen.getByTestId("badge-unlockable")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-inactive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-purchased")).not.toBeInTheDocument();
  });

  it("renders inactive badge when active property is false", () => {
    const prompt = mockPrompt({ active: false });
    renderWithProviders(<PromptCard {...defaultProps} prompt={prompt} />);
    
    expect(screen.getByTestId("badge-inactive")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-active")).not.toBeInTheDocument();
  });

  it("renders purchased badge when hasAccess is true", () => {
    renderWithProviders(<PromptCard {...defaultProps} hasAccess={true} />);
    
    expect(screen.getByTestId("badge-purchased")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-unlockable")).not.toBeInTheDocument();
  });

  it("renders verified badge when contentHash is present", () => {
    renderWithProviders(<PromptCard {...defaultProps} />);
    expect(screen.getByTestId("badge-verified")).toBeInTheDocument();
  });

  it("does not render verified badge when contentHash is empty", () => {
    const prompt = mockPrompt({ contentHash: "" });
    renderWithProviders(<PromptCard {...defaultProps} prompt={prompt} />);
    expect(screen.queryByTestId("badge-verified")).not.toBeInTheDocument();
  });

  it("renders Compare button when onToggleCompare is provided and triggers callback", () => {
    const onToggleCompare = vi.fn();
    renderWithProviders(<PromptCard {...defaultProps} onToggleCompare={onToggleCompare} />);
    
    const compareBtn = screen.getByRole("button", { name: /compare/i });
    expect(compareBtn).toBeInTheDocument();
    
    compareBtn.click();
    expect(onToggleCompare).toHaveBeenCalledWith(defaultProps.prompt);
  });

  it("applies highlight styles when isCompared is true", () => {
    const { container } = renderWithProviders(<PromptCard {...defaultProps} isCompared={true} />);
    const cardElement = container.querySelector(".border-emerald-500");
    expect(cardElement).toBeInTheDocument();
  });
});
