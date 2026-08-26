import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "./input";
import { renderWithProviders } from "@/test/render";

describe("Input", () => {
  it("renders an input element", () => {
    renderWithProviders(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
  });

  it("renders with default type text", () => {
    renderWithProviders(<Input />);
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("type")).toBe("text");
  });

  it("renders with password type", () => {
    renderWithProviders(<Input type="password" />);
    const input = document.querySelector("input[type='password']");
    expect(input).toBeInTheDocument();
  });

  it("applies custom className", () => {
    renderWithProviders(<Input className="my-custom-input" />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("my-custom-input");
  });

  it("calls onChange handler", async () => {
    const handleChange = vi.fn();
    renderWithProviders(<Input onChange={handleChange} />);
    const input = screen.getByRole("textbox");
    input.focus();
    expect(handleChange).toHaveBeenCalled();
  });

  it("renders as disabled when disabled prop is set", () => {
    renderWithProviders(<Input disabled />);
    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
  });

  it("forwards ref correctly", () => {
    const ref = { current: null };
    renderWithProviders(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("passes additional HTML attributes", () => {
    renderWithProviders(<Input data-testid="test-input" maxLength={100} />);
    const input = screen.getByTestId("test-input");
    expect(input.getAttribute("maxlength")).toBe("100");
  });
});
