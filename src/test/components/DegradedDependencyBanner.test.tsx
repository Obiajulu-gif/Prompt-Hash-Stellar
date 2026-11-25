import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { DegradedDependencyBanner } from "../../components/DegradedDependencyBanner";
import { fallbackManager } from "../../lib/observability/degradedServiceFallback";

describe("DegradedDependencyBanner (#1144)", () => {
  beforeEach(() => {
    fallbackManager.reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normal path: renders nothing when all services are healthy", () => {
    const { container } = render(
      <MemoryRouter>
        <DegradedDependencyBanner />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("failure path: displays amber warning banner when a dependency is degraded", () => {
    fallbackManager.setServiceStatus("stellar_rpc", "degraded");

    render(
      <MemoryRouter>
        <DegradedDependencyBanner />
      </MemoryRouter>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveClass("bg-amber-500/10");
    expect(
      screen.getByText(/Stellar RPC node response times are degraded/i),
    ).toBeInTheDocument();
  });

  it("failure path: displays rose/critical alert banner when a dependency is unavailable", () => {
    fallbackManager.setServiceStatus("ipfs", "unavailable");

    render(
      <MemoryRouter>
        <DegradedDependencyBanner />
      </MemoryRouter>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveClass("bg-rose-500/10");
    expect(
      screen.getByText(/IPFS storage services are currently unavailable/i),
    ).toBeInTheDocument();
  });

  it("user action: dismiss button hides the banner for the current session", () => {
    fallbackManager.setServiceStatus("safety_scanner", "degraded");

    render(
      <MemoryRouter>
        <DegradedDependencyBanner />
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    const dismissButton = screen.getByLabelText("Dismiss dependency warning");
    fireEvent.click(dismissButton);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retry path: retry button invokes probe refresh and clears banner upon recovery", async () => {
    fallbackManager.setServiceStatus("stellar_rpc", "degraded");

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "up",
        services: [{ name: "Stellar RPC", status: "up" }],
      }),
    } as Response);

    render(
      <MemoryRouter>
        <DegradedDependencyBanner />
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("authorization / safe copy: surfaces only user-safe messages without leaking secrets or hostnames", () => {
    fallbackManager.setServiceStatus(
      "stellar_rpc",
      "degraded",
      "Internal DB connection string: mongodb://admin:secretPass@10.0.0.1",
    );

    render(
      <MemoryRouter>
        <DegradedDependencyBanner />
      </MemoryRouter>,
    );

    const alert = screen.getByRole("alert");
    // Ensure internal details or credentials are never leaked
    expect(alert.textContent).not.toContain("mongodb://");
    expect(alert.textContent).not.toContain("secretPass");
    expect(alert.textContent).not.toContain("10.0.0.1");
    // Contains sanitized safe copy
    expect(alert.textContent).toContain(
      "Stellar RPC node response times are degraded",
    );
  });
});
