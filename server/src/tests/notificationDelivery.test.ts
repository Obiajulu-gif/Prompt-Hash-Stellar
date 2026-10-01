import { beforeEach, describe, expect, it, vi } from "vitest";
import Notification from "../models/Notification";
import {
  buildPromptUpdateDedupeKey,
  createNotificationOnce,
  notifyPromptUpdateBuyers,
} from "../services/notificationDelivery";

describe("notification delivery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds stable prompt update dedupe keys", () => {
    expect(
      buildPromptUpdateDedupeKey({
        recipientWallet: "GABC",
        promptId: "prompt-1",
        promptTitle: "Prompt",
        versionIndex: 3,
        sourceEventId: "prompt_update:prompt-1:3",
      }),
    ).toBe("prompt_update:prompt-1:gabc:3");
  });

  it("swallows duplicate key errors for already delivered notifications", async () => {
    vi.spyOn(Notification, "create").mockRejectedValueOnce({ code: 11000 });

    await expect(
      createNotificationOnce({
        recipientWallet: "GABC",
        promptId: "prompt-1",
        promptTitle: "Prompt",
        versionIndex: 2,
        sourceEventId: "prompt_update:prompt-1:2",
      }),
    ).resolves.toMatchObject({ created: false });
  });

  it("deduplicates repeated buyer wallets before delivery", async () => {
    const createSpy = vi.spyOn(Notification, "create").mockResolvedValue({} as any);

    const result = await notifyPromptUpdateBuyers(
      [{ buyerWallet: "GABC" }, { buyerWallet: "gabc" }, { buyerWallet: "GDEF" }],
      { _id: "prompt-1", title: "Prompt" },
      2,
      "Updated",
    );

    expect(result).toHaveLength(2);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientWallet: "gabc",
        dedupeKey: "prompt_update:prompt-1:gabc:2",
        sourceEventId: "prompt_update:prompt-1:2",
      }),
    );
  });
});
