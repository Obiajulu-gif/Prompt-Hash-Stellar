import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationalHealthDashboard } from "../../components/admin/OperationalHealthDashboard";

describe("issue #1146 unresolved partial-failure dashboard", () => {
  it("surfaces a safe unresolved exception and its investigation reference", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        report: {
          timestamp: "2026-11-23T00:00:00.000Z",
          status: "DEGRADED",
          summary: {
            totalUnresolvedExceptions: 1,
            staleJobsCount: 0,
            reconciliationDriftCount: 0,
            activeIncidentsCount: 0,
          },
          categories: {
            unresolvedExceptions: [
              {
                id: "partial-1146",
                source: "Webhook",
                category: "partial_failure",
                severity: "HIGH",
                message: "Delivery paused for operator review",
                occurredAt: "2026-11-23T00:00:00.000Z",
                investigationLink: "/api/admin/operations/partial-1146",
              },
            ],
            staleJobs: [],
            reconciliationDrift: {
              status: "in_sync",
              unsettledLedgerEntriesCount: 0,
              unsettledAmountSum: 0,
              discrepancyCount: 0,
              indexerLagLedgers: 0,
              lastIndexedLedger: 1,
            },
            activeIncidents: [],
          },
        },
      }),
    } as any);

    render(<OperationalHealthDashboard />);
    await waitFor(() => expect(screen.getByText("Maintainer Operational Health")).toBeDefined());
    fireEvent.click(screen.getByText("Exceptions"));

    expect(screen.getByText("Delivery paused for operator review")).toBeDefined();
    expect(screen.getByText("Ref: /api/admin/operations/partial-1146")).toBeDefined();
    expect(screen.queryByText(/private|token|secret/i)).toBeNull();
  });
});
