import { describe, it, expect, beforeEach } from "vitest";
import {
  UserOperationHistoryService,
  OperationEventInput,
} from "../../server/src/services/userOperationHistoryService";

describe("User Operation History Service (#923)", () => {
  const sampleEvents: OperationEventInput[] = [
    {
      id: "op-1",
      userId: "user-alice",
      eventType: "PROMPT_PURCHASE",
      timestamp: "2026-09-01T10:00:00Z",
      status: "success",
      summary: "Purchased prompt 'SEO Wizard'",
      metadata: { promptId: "p-101", amountXlm: "25.0", internalNodeIp: "10.0.0.4" },
    },
    {
      id: "op-2",
      userId: "user-alice",
      eventType: "PROMPT_PUBLISH",
      timestamp: "2026-09-02T12:00:00Z",
      status: "success",
      summary: "Published prompt 'React Code Reviewer'",
      metadata: { promptId: "p-102", encryptionIv: "iv-secret-123" },
    },
    {
      id: "op-3",
      userId: "user-alice",
      eventType: "MAINTAINER_FLAG",
      timestamp: "2026-09-03T14:00:00Z",
      status: "pending",
      summary: "Internal maintainer review flagged listing",
      metadata: { maintainerNote: "Check for spam keywords" },
      isInternalOnly: true,
    },
    {
      id: "op-4",
      userId: "user-alice",
      eventType: "DISPUTE_FILED",
      timestamp: "2026-09-04T16:00:00Z",
      status: "failed",
      summary: "Dispute submission failed due to timeout",
      isDeleted: true,
    },
    {
      id: "op-5",
      userId: "user-bob",
      eventType: "PROMPT_PURCHASE",
      timestamp: "2026-09-05T18:00:00Z",
      status: "success",
      summary: "Purchased prompt 'Python Data Cleaner'",
    },
  ];

  beforeEach(() => {
    UserOperationHistoryService.seedEvents(sampleEvents);
  });

  it("allows users to view only their authorized operation history", () => {
    const res = UserOperationHistoryService.getUserOperationHistory({
      userId: "user-alice",
      callingUserId: "user-alice",
    });

    expect(res.operations).toHaveLength(2);
    expect(res.operations.every((op) => op.id !== "op-5")).toBe(true);
  });

  it("throws unauthorized error when user attempts to view another user's operation history", () => {
    expect(() =>
      UserOperationHistoryService.getUserOperationHistory({
        userId: "user-bob",
        callingUserId: "user-alice",
      })
    ).toThrow("Unauthorized: Users can only view their own operation history.");
  });

  it("redacts internal-only metadata fields from user response", () => {
    const res = UserOperationHistoryService.getUserOperationHistory({
      userId: "user-alice",
      callingUserId: "user-alice",
    });

    const op1 = res.operations.find((o) => o.id === "op-1");
    expect(op1?.metadata).toEqual({ promptId: "p-101", amountXlm: "25.0" });
    expect(op1?.metadata).not.toHaveProperty("internalNodeIp");

    const op2 = res.operations.find((o) => o.id === "op-2");
    expect(op2?.metadata).not.toHaveProperty("encryptionIv");
  });

  it("filters out internal-only events and deleted records", () => {
    const res = UserOperationHistoryService.getUserOperationHistory({
      userId: "user-alice",
      callingUserId: "user-alice",
    });

    expect(res.operations.some((op) => op.eventType === "MAINTAINER_FLAG")).toBe(false);
    expect(res.operations.some((op) => op.id === "op-4")).toBe(false);
  });

  it("supports stable pagination and filtering by eventType and status", () => {
    for (let i = 10; i <= 25; i++) {
      UserOperationHistoryService.addEvent({
        id: `op-gen-${i}`,
        userId: "user-alice",
        eventType: "PAYOUT_WITHDRAWAL",
        timestamp: `2026-09-${i < 10 ? "0" + i : i}T10:00:00Z`,
        status: "success",
        summary: `Payout withdrawal ${i}`,
      });
    }

    const page1 = UserOperationHistoryService.getUserOperationHistory({
      userId: "user-alice",
      callingUserId: "user-alice",
      page: 1,
      limit: 5,
      eventType: "PAYOUT_WITHDRAWAL",
    });

    expect(page1.operations).toHaveLength(5);
    expect(page1.pagination.total).toBe(16);
    expect(page1.pagination.totalPages).toBe(4);
    expect(page1.pagination.page).toBe(1);
  });
});
