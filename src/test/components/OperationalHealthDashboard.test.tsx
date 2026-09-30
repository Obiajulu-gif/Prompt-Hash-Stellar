import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { OperationalHealthDashboard } from "../../components/admin/OperationalHealthDashboard";

describe("OperationalHealthDashboard Component (Issue #814)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders maintainer dashboard header and KPIs", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        report: {
          timestamp: new Date().toISOString(),
          status: "HEALTHY",
          summary: {
            totalUnresolvedExceptions: 2,
            staleJobsCount: 1,
            reconciliationDriftCount: 0,
            activeIncidentsCount: 3,
          },
          categories: {
            unresolvedExceptions: [
              {
                id: "exc-1",
                source: "Webhook",
                category: "webhook_failure",
                severity: "HIGH",
                message: "Signature check failed",
                occurredAt: new Date().toISOString(),
                investigationLink: "/api/webhooks/events/1",
              },
            ],
            staleJobs: [
              {
                id: "job-1",
                type: "retention_cleanup",
                status: "processing",
                attempts: 1,
                stuckDurationMinutes: 20,
                lastError: null,
                investigationLink: "/api/jobs/1",
              },
            ],
            reconciliationDrift: {
              status: "in_sync",
              unsettledLedgerEntriesCount: 0,
              unsettledAmountSum: 0,
              discrepancyCount: 0,
              indexerLagLedgers: 0,
              lastIndexedLedger: 2000,
            },
            activeIncidents: [
              {
                id: "inc-1",
                type: "user_report",
                title: "Report on Prompt #4",
                status: "pending",
                priority: "MEDIUM",
                createdAt: new Date().toISOString(),
                investigationLink: "/api/admin/reports/1",
              },
            ],
          },
        },
      }),
    } as any);

    render(<OperationalHealthDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Maintainer Operational Health")).toBeDefined();
    });

    expect(screen.getByText("Unresolved Exceptions")).toBeDefined();
    expect(screen.getByText("Stale Jobs (>15m)")).toBeDefined();
    expect(screen.getByText("Reconciliation Drift")).toBeDefined();
    expect(screen.getByText("Active Incidents / Cases")).toBeDefined();
  });
});
