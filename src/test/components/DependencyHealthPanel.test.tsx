import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  DependencyHealthPanel,
  type DependencyHealthPanelProps,
} from "../../components/status/DependencyHealthPanel";

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

function renderPanel(fetchImpl: typeof fetch, props: Partial<DependencyHealthPanelProps> = {}) {
  return render(
    <DependencyHealthPanel
      fetchImpl={fetchImpl}
      endpoint="/api/health"
      fallbackRetryMs={60_000}
      {...props}
    />,
  );
}

describe("DependencyHealthPanel (#1179)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normal path: lists each dependency and the overall readiness", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: "ok",
        checkedAt: "2026-11-21T10:00:00.000Z",
        cached: false,
        dependencies: [
          { name: "database", status: "up", critical: true, latencyMs: 3 },
          { name: "stellar_rpc", status: "up", critical: false, latencyMs: 41 },
        ],
      }),
    ) as unknown as typeof fetch;

    renderPanel(fetchImpl);

    expect(await screen.findByText("All dependencies operational")).toBeTruthy();
    expect(screen.getByText("database")).toBeTruthy();
    expect(screen.getByText("stellar rpc")).toBeTruthy();
    expect(screen.getAllByText("Operational")).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "omit", cache: "no-store" }),
    );
  });

  it("failure path: a critical outage renders 503 status, reason, and backoff", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          status: "down",
          cached: false,
          dependencies: [
            { name: "database", status: "down", critical: true, latencyMs: 12, reason: "unreachable" },
            { name: "indexer", status: "degraded", critical: false, latencyMs: 4, reason: "unhealthy" },
          ],
        },
        503,
        { "Retry-After": "30" },
      ),
    ) as unknown as typeof fetch;

    renderPanel(fetchImpl, { fallbackRetryMs: undefined });

    expect(await screen.findByText("A critical dependency is unavailable")).toBeTruthy();
    expect(screen.getByText(/Retrying automatically in 30s/)).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Degraded")).toBeTruthy();
    expect(screen.getByText(/Critical · unreachable/)).toBeTruthy();
    expect(screen.getByText(/Non-critical · unhealthy/)).toBeTruthy();
  });

  it("failure path: a network error is recoverable", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          dependencies: [{ name: "database", status: "up", critical: true, latencyMs: 3 }],
        }),
      ) as unknown as typeof fetch;

    renderPanel(fetchImpl);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Dependency status could not be loaded.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /retry now/i }));

    expect(await screen.findByText("All dependencies operational")).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retry path: the refresh control re-reads the endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "degraded",
          dependencies: [{ name: "stellar_rpc", status: "degraded", critical: false, latencyMs: 900 }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          dependencies: [{ name: "stellar_rpc", status: "up", critical: false, latencyMs: 40 }],
        }),
      ) as unknown as typeof fetch;

    renderPanel(fetchImpl);
    expect(await screen.findByText("Some dependencies are degraded")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /refresh dependencies/i }));

    expect(await screen.findByText("All dependencies operational")).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("authorization/redaction path: raw server detail never reaches the DOM", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: "degraded",
        dependencies: [
          {
            name: "database",
            status: "down",
            critical: false,
            latencyMs: 5,
            reason: "connect ECONNREFUSED 10.1.2.3:27017",
            detail: "mongodb://admin:hunter2@mongo-primary.internal:27017",
            observed: { host: "mongo-primary.internal" },
            attempts: 2,
          },
        ],
        authorization: "Bearer super-secret-token",
      }),
    ) as unknown as typeof fetch;

    const { container } = renderPanel(fetchImpl);

    expect(await screen.findByText("database")).toBeTruthy();
    const rendered = container.textContent ?? "";
    expect(rendered).not.toContain("10.1.2.3");
    expect(rendered).not.toContain("mongo-primary");
    expect(rendered).not.toContain("hunter2");
    expect(rendered).not.toContain("super-secret-token");
    expect(rendered).not.toContain("ECONNREFUSED");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("legacy path: an older deployment without dependency detail does not claim health", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: "ok", timestamp: "2026-11-21T10:00:00.000Z", uptime: 5 }),
    ) as unknown as typeof fetch;

    renderPanel(fetchImpl);

    expect(
      await screen.findByText("This deployment does not report dependency-level health."),
    ).toBeTruthy();
  });

  it("malformed path: an unparsable body degrades instead of crashing", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    })) as unknown as typeof fetch;

    renderPanel(fetchImpl, { fallbackRetryMs: undefined });

    expect(await screen.findByText("A critical dependency is unavailable")).toBeTruthy();
    expect(
      screen.getByText("This deployment does not report dependency-level health."),
    ).toBeTruthy();
  });
});
