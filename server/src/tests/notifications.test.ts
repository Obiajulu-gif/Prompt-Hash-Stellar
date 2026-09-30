/**
 * Tests — in-app notification center (#notification-center).
 *
 * Coverage:
 *  - createNotification: happy path, idempotency key dedup, preference suppression.
 *  - fanOutNotification: multiple recipients, per-wallet idempotency suffix.
 *  - pruneOldNotifications: batched deletion of old read docs.
 *  - notificationControllers: GetNotifications pagination/filter, GetUnreadCount,
 *    MarkAsRead (single + bulk), ClearNotifications, preferences CRUD.
 *  - Permission targeting: walletAddress scoping (cross-wallet writes rejected).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Model mocks ────────────────────────────────────────────────────────────────

vi.mock("../models/Notification", () => {
  const model = {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    countDocuments: vi.fn(),
  };
  return {
    default: model,
    NOTIFICATION_TYPES: [
      "prompt_update",
      "purchase_confirmed",
      "dispute_opened",
      "dispute_resolved",
      "payout_available",
      "moderation_action",
      "ownership_transfer",
      "system",
    ],
  };
});

vi.mock("../models/NotificationPreferences", () => ({
  default: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/structuredLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Notification from "../models/Notification";
import NotificationPreferences from "../models/NotificationPreferences";
import {
  createNotification,
  fanOutNotification,
  pruneOldNotifications,
} from "../services/notificationService";
import {
  GetNotifications,
  GetUnreadCount,
  MarkAsRead,
  ClearNotifications,
  GetNotificationPreferences,
  UpdateNotificationPreferences,
} from "../controllers/notificationControllers";

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockReqRes(
  params: Record<string, string> = {},
  query: Record<string, string> = {},
  body: Record<string, unknown> = {},
) {
  const req = { params, query, body } as any;
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  const res = { json, status } as any;
  res.json = json;
  res.status = status;
  status.mockReturnValue(res);
  return { req, res, json, status };
}

// ── notificationService ────────────────────────────────────────────────────────

describe("createNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a notification when no preferences are set", async () => {
    (NotificationPreferences.findOne as any).mockResolvedValue(null);
    const doc = { _id: "n1", type: "purchase_confirmed" };
    (Notification.create as any).mockResolvedValue(doc);

    const result = await createNotification({
      recipientWallet: "GABC",
      type: "purchase_confirmed",
      message: "Purchase confirmed",
      idempotencyKey: "event-1",
    });

    expect(result).toEqual(doc);
    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientWallet: "gabc",
        type: "purchase_confirmed",
        idempotencyKey: "event-1",
      }),
    );
  });

  it("returns null when the idempotency key already exists (duplicate-key error)", async () => {
    (NotificationPreferences.findOne as any).mockResolvedValue(null);
    const dupErr = Object.assign(new Error("dup"), { code: 11000 });
    (Notification.create as any).mockRejectedValue(dupErr);

    const result = await createNotification({
      recipientWallet: "GABC",
      type: "purchase_confirmed",
      message: "Purchase confirmed",
      idempotencyKey: "event-1",
    });

    expect(result).toBeNull();
  });

  it("returns null when the notification type is muted by user preferences", async () => {
    (NotificationPreferences.findOne as any).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ mutedTypes: ["purchase_confirmed"] }),
    });

    const result = await createNotification({
      recipientWallet: "GABC",
      type: "purchase_confirmed",
      message: "Purchase confirmed",
    });

    expect(result).toBeNull();
    expect(Notification.create).not.toHaveBeenCalled();
  });

  it("proceeds past a preference lookup failure and creates the notification", async () => {
    (NotificationPreferences.findOne as any).mockRejectedValue(
      new Error("db timeout"),
    );
    (Notification.create as any).mockResolvedValue({ _id: "n2" });

    const result = await createNotification({
      recipientWallet: "GABC",
      type: "purchase_confirmed",
      message: "Purchase confirmed",
    });

    expect(result).toEqual({ _id: "n2" });
  });

  it("rethrows non-duplicate-key errors", async () => {
    (NotificationPreferences.findOne as any).mockResolvedValue(null);
    (Notification.create as any).mockRejectedValue(new Error("disk full"));

    await expect(
      createNotification({
        recipientWallet: "GABC",
        type: "system",
        message: "test",
      }),
    ).rejects.toThrow("disk full");
  });
});

describe("fanOutNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates one notification per non-null wallet with distinct idempotency keys", async () => {
    (NotificationPreferences.findOne as any).mockResolvedValue(null);
    (Notification.create as any).mockResolvedValue({ _id: "n" });

    await fanOutNotification(["GABC", "GXYZ", null, undefined], {
      type: "dispute_opened",
      message: "Dispute opened",
      idempotencyKey: "ev-42",
    });

    expect(Notification.create).toHaveBeenCalledTimes(2);
    const keys = (Notification.create as any).mock.calls.map(
      (c: any[]) => c[0].idempotencyKey,
    );
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toContain("ev-42");
    expect(keys[1]).toContain("ev-42");
  });

  it("swallows errors for one wallet without affecting others", async () => {
    (NotificationPreferences.findOne as any).mockResolvedValue(null);
    (Notification.create as any)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ _id: "n2" });

    // Should not throw even if first wallet fails
    await expect(
      fanOutNotification(["GABC", "GXYZ"], {
        type: "dispute_resolved",
        message: "Resolved",
        idempotencyKey: "ev-99",
      }),
    ).resolves.not.toThrow();
  });
});

describe("pruneOldNotifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes read notifications older than the retention window in batches", async () => {
    // First batch returns 2 docs; second batch returns 0 → stop.
    const batch1 = [{ _id: "a" }, { _id: "b" }];
    (Notification.find as any).mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValueOnce(batch1).mockResolvedValueOnce([]),
    });
    (Notification.deleteMany as any).mockResolvedValueOnce({ deletedCount: 2 });

    const total = await pruneOldNotifications(90, 500);

    expect(total).toBe(2);
    expect(Notification.deleteMany).toHaveBeenCalledTimes(1);
    expect(Notification.deleteMany).toHaveBeenCalledWith({
      _id: { $in: ["a", "b"] },
    });
  });
});

// ── notificationControllers ────────────────────────────────────────────────────

describe("GetNotifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated notifications for the wallet", async () => {
    const { req, res, json } = mockReqRes(
      { walletAddress: "GABC" },
      { page: "1", limit: "10" },
    );
    const docs = [{ _id: "n1" }];
    (Notification.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(docs),
    });
    (Notification.countDocuments as any).mockResolvedValue(1);

    await GetNotifications(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: docs,
        page: 1,
        total: 1,
        totalPages: 1,
      }),
    );
  });

  it("filters by type when a valid type is provided", async () => {
    const { req, res } = mockReqRes(
      { walletAddress: "GABC" },
      { type: "purchase_confirmed" },
    );
    (Notification.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    (Notification.countDocuments as any).mockResolvedValue(0);

    await GetNotifications(req, res);

    expect(Notification.find).toHaveBeenCalledWith(
      expect.objectContaining({ type: "purchase_confirmed" }),
    );
  });

  it("rejects an invalid type silently (no type filter applied)", async () => {
    const { req, res } = mockReqRes(
      { walletAddress: "GABC" },
      { type: "not_a_real_type" },
    );
    (Notification.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    (Notification.countDocuments as any).mockResolvedValue(0);

    await GetNotifications(req, res);

    const filterArg = (Notification.find as any).mock.calls[0][0];
    expect(filterArg.type).toBeUndefined();
  });
});

describe("GetUnreadCount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the unread count for the wallet", async () => {
    const { req, res, json } = mockReqRes({ walletAddress: "GABC" });
    (Notification.countDocuments as any).mockResolvedValue(7);

    await GetUnreadCount(req, res);

    expect(json).toHaveBeenCalledWith({ count: 7 });
    expect(Notification.countDocuments).toHaveBeenCalledWith({
      recipientWallet: "gabc",
      read: false,
    });
  });
});

describe("MarkAsRead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks all unread for wallet when no notificationId is given", async () => {
    const { req, res, json } = mockReqRes({ walletAddress: "GABC" }, {}, {});
    (Notification.updateMany as any).mockResolvedValue({ modifiedCount: 3 });

    await MarkAsRead(req, res);

    expect(Notification.updateMany).toHaveBeenCalledWith(
      { recipientWallet: "gabc", read: false },
      { $set: { read: true } },
    );
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ updated: 3 }));
  });

  it("marks a single notification when notificationId is given", async () => {
    const { req, res, json } = mockReqRes(
      { walletAddress: "GABC" },
      {},
      { notificationId: "nid-1" },
    );
    (Notification.findOneAndUpdate as any).mockResolvedValue({
      _id: "nid-1",
      read: true,
    });

    await MarkAsRead(req, res);

    expect(Notification.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "nid-1", recipientWallet: "gabc" },
      { $set: { read: true } },
      { new: true },
    );
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ updated: 1 }));
  });

  it("returns 404 when notificationId does not belong to wallet (cross-wallet protection)", async () => {
    const { req, res, status } = mockReqRes(
      { walletAddress: "GABC" },
      {},
      { notificationId: "other-wallet-notif" },
    );
    (Notification.findOneAndUpdate as any).mockResolvedValue(null);

    await MarkAsRead(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });
});

describe("ClearNotifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes all notifications scoped to the wallet", async () => {
    const { req, res, json } = mockReqRes({ walletAddress: "GABC" });
    (Notification.deleteMany as any).mockResolvedValue({ deletedCount: 5 });

    await ClearNotifications(req, res);

    expect(Notification.deleteMany).toHaveBeenCalledWith({
      recipientWallet: "gabc",
    });
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ deleted: 5 }));
  });
});

describe("GetNotificationPreferences", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns stored preferences when they exist", async () => {
    const { req, res, json } = mockReqRes({ walletAddress: "GABC" });
    (NotificationPreferences.findOne as any).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        walletAddress: "gabc",
        mutedTypes: ["system"],
        emailEnabled: false,
      }),
    });

    await GetNotificationPreferences(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ mutedTypes: ["system"] }),
    );
  });

  it("returns safe defaults when no preferences document exists", async () => {
    const { req, res, json } = mockReqRes({ walletAddress: "GABC" });
    (NotificationPreferences.findOne as any).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });

    await GetNotificationPreferences(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ mutedTypes: [], emailEnabled: false }),
    );
  });
});

describe("UpdateNotificationPreferences", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts valid preference fields and returns the updated document", async () => {
    const { req, res, json } = mockReqRes(
      { walletAddress: "GABC" },
      {},
      { mutedTypes: ["dispute_opened", "system"], emailEnabled: true },
    );
    const updated = {
      walletAddress: "gabc",
      mutedTypes: ["dispute_opened", "system"],
      emailEnabled: true,
    };
    (NotificationPreferences.findOneAndUpdate as any).mockResolvedValue(
      updated,
    );

    await UpdateNotificationPreferences(req, res);

    expect(NotificationPreferences.findOneAndUpdate).toHaveBeenCalledWith(
      { walletAddress: "gabc" },
      {
        $set: expect.objectContaining({
          mutedTypes: ["dispute_opened", "system"],
          emailEnabled: true,
        }),
      },
      { upsert: true, new: true },
    );
    expect(json).toHaveBeenCalledWith(updated);
  });

  it("silently filters out unrecognised notification types", async () => {
    const { req, res } = mockReqRes(
      { walletAddress: "GABC" },
      {},
      { mutedTypes: ["purchase_confirmed", "not_a_type", 42] },
    );
    (NotificationPreferences.findOneAndUpdate as any).mockResolvedValue({
      mutedTypes: ["purchase_confirmed"],
    });

    await UpdateNotificationPreferences(req, res);

    const updateArg = (NotificationPreferences.findOneAndUpdate as any).mock
      .calls[0][1];
    expect(updateArg.$set.mutedTypes).toEqual(["purchase_confirmed"]);
  });

  it("returns 400 when no valid preference fields are provided", async () => {
    const { req, res, status } = mockReqRes(
      { walletAddress: "GABC" },
      {},
      { unknownField: "whatever" }, // no mutedTypes or emailEnabled at all
    );

    await UpdateNotificationPreferences(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });
});
