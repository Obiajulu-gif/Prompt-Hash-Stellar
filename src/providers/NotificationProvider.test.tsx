import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useNotification } from "../hooks/useNotification";
import { NotificationProvider } from "./NotificationProvider";

function Trigger() {
  const { addNotification } = useNotification();
  return (
    <button onClick={() => addNotification("Saved successfully", "success")}>
      fire
    </button>
  );
}

describe("NotificationProvider (issue #1044)", () => {
  it("announces notifications to screen readers via a live region", () => {
    render(
      <NotificationProvider>
        <Trigger />
      </NotificationProvider>,
    );

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");

    act(() => {
      screen.getByText("fire").click();
    });

    expect(region).toHaveTextContent("Saved successfully");
  });
});
